import { MAX_TEXT_CHARS } from "@/lib/types";
import type { TranslateSuccess } from "@/lib/types";
import {
  applyBodyOverrides,
  buildSystemPrompt,
  buildUpstreamHeaders,
  createSseTextStream,
  errorResponse,
  extractMessageContent,
  extractUpstreamError,
  isRecord,
  isTimeoutError,
  parseBodyOverrides,
  parseJsonSafe,
  parseLlmConfig,
  readTextSafe,
  resolveChatCompletionsUrl,
  textStreamHeaders,
} from "@/lib/server/llm";

const MAX_TARGET_LANG_CHARS = 50;

export async function POST(req: Request): Promise<Response> {
  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return errorResponse("Invalid JSON body", 400);
  }
  if (!isRecord(rawBody)) {
    return errorResponse("Invalid request body", 400);
  }

  const { text, targetLang, config: rawConfig, stream, bodyOverrides } = rawBody;

  if (typeof text !== "string") {
    return errorResponse("text must be a string", 400);
  }
  const trimmedText = text.trim();
  if (!trimmedText) {
    return errorResponse("text must not be empty", 400);
  }
  if (trimmedText.length > MAX_TEXT_CHARS) {
    return errorResponse(
      `text must be at most ${MAX_TEXT_CHARS} characters`,
      400,
    );
  }

  if (typeof targetLang !== "string") {
    return errorResponse("targetLang must be a string", 400);
  }
  const lang = targetLang.trim();
  if (!lang) {
    return errorResponse("targetLang must not be empty", 400);
  }
  if (lang.length > MAX_TARGET_LANG_CHARS) {
    return errorResponse(
      `targetLang must be at most ${MAX_TARGET_LANG_CHARS} characters`,
      400,
    );
  }

  const parsedOverrides = parseBodyOverrides(bodyOverrides);
  if (!parsedOverrides.ok) {
    return errorResponse(parsedOverrides.error, 400);
  }

  const parsedConfig = parseLlmConfig(rawConfig);
  if (!parsedConfig.ok) {
    return errorResponse(parsedConfig.error, 400);
  }
  const config = parsedConfig.config;

  const urlResult = resolveChatCompletionsUrl(config.baseURL);
  if (!urlResult.ok) {
    return errorResponse(urlResult.error, 400);
  }

  const wantStream = stream !== false;

  const baseBody: Record<string, unknown> = {
    model: config.model,
    stream: wantStream,
    messages: [
      { role: "system", content: buildSystemPrompt(lang) },
      { role: "user", content: trimmedText },
    ],
  };
  // Only sent when set: some providers require max_tokens, newer OpenAI models reject it.
  if (config.maxTokens != null) {
    baseBody.max_tokens = config.maxTokens;
  }
  // bodyOverrides can add provider-specific fields, but never model/messages/stream.
  const overrides = parsedOverrides.value;
  const upstreamBody = applyBodyOverrides(baseBody, overrides);

  // Compose the client disconnect signal with a 60s timeout.
  const signal = AbortSignal.any([req.signal, AbortSignal.timeout(60000)]);

  const sendUpstream = (body: Record<string, unknown>): Promise<Response> =>
    fetch(urlResult.url, {
      method: "POST",
      headers: buildUpstreamHeaders(config.apiKey, config.extraHeaders),
      body: JSON.stringify(body),
      signal,
    });

  const fetchErrorResponse = (error: unknown): Response =>
    req.signal.aborted
      ? errorResponse("Client disconnected", 499)
      : errorResponse(
          isTimeoutError(error) ? "Request timed out" : "Upstream request failed",
          isTimeoutError(error) ? 504 : 502,
        );

  let upstream: Response;
  try {
    upstream = await sendUpstream(upstreamBody);
  } catch (error) {
    return fetchErrorResponse(error);
  }

  // A preset's fast-mode params (bodyOverrides) may be rejected by a user-chosen
  // model that doesn't support them. Retry once without the overrides.
  if (overrides !== undefined && (upstream.status === 400 || upstream.status === 422)) {
    console.warn(
      `[translate] upstream ${upstream.status} with bodyOverrides; retrying once without overrides`,
    );
    // Drain the rejected response so the connection can be reused.
    await readTextSafe(upstream);
    try {
      upstream = await sendUpstream(baseBody);
    } catch (error) {
      return fetchErrorResponse(error);
    }
  }

  if (!upstream.ok) {
    const bodyText = await readTextSafe(upstream);
    return errorResponse(
      extractUpstreamError(bodyText, upstream.status),
      upstream.status,
    );
  }

  const contentType = upstream.headers.get("content-type") ?? "";

  if (wantStream) {
    if (contentType.includes("text/event-stream") && upstream.body) {
      const streamBody = createSseTextStream(upstream.body, signal);
      return new Response(streamBody, {
        status: 200,
        headers: textStreamHeaders(),
      });
    }

    // Provider ignored stream:true and returned a normal JSON completion.
    const bodyText = await readTextSafe(upstream);
    const content = extractMessageContent(parseJsonSafe(bodyText));
    if (content === null || content.trim() === "") {
      return errorResponse("Upstream returned an empty translation", 502);
    }
    return new Response(content, {
      status: 200,
      headers: textStreamHeaders(),
    });
  }

  // Non-streaming: return the whole translation as JSON.
  const bodyText = await readTextSafe(upstream);
  const content = extractMessageContent(parseJsonSafe(bodyText));
  if (content === null || content.trim() === "") {
    return errorResponse("Upstream returned an empty translation", 502);
  }
  const success: TranslateSuccess = { translation: content.trim() };
  return Response.json(success);
}
