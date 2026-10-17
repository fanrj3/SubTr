import { MAX_TEXT_CHARS } from "@/lib/types";
import type { TranslateSuccess } from "@/lib/types";
import {
  applyBodyOverrides,
  buildSystemPrompt,
  buildUpstreamHeaders,
  createSseTextStream,
  errorResponse,
  estimateTokens,
  extractMessageContent,
  extractUpstreamError,
  extractUsage,
  isRecord,
  isTimeoutError,
  parseBodyOverrides,
  parseJsonSafe,
  parseLlmConfig,
  readTextSafe,
  resolveChatCompletionsUrl,
  textStreamHeaders,
  type UpstreamUsage,
} from "@/lib/server/llm";
import { computeCostUsd, resolvePricing } from "@/lib/server/pricing";
import { recordUsage, type StatsRecord } from "@/lib/server/stats";
import {
  applyInputTransforms,
  applyOutputTransforms,
  hasBufferedOutput,
  type OutputTransformContext,
} from "@/lib/server/plugins";

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

  const { text, targetLang, config: rawConfig, stream, bodyOverrides, presetId, profileId, forceTranslate } = rawBody;

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
  const preset = typeof presetId === "string" && presetId.trim() ? presetId.trim() : undefined;
  const profile = typeof profileId === "string" ? profileId : "";

  const urlResult = resolveChatCompletionsUrl(config.baseURL);
  if (!urlResult.ok) {
    return errorResponse(urlResult.error, 400);
  }

  // Plugin input transforms run right after validation, before the upstream body.
  // ctx never carries the apiKey or baseURL.
  let effectiveText = trimmedText;
  try {
    effectiveText = await applyInputTransforms(trimmedText, {
      targetLang: lang,
      profile: { id: profile, presetId: preset ?? "", model: config.model },
    });
  } catch (error) {
    console.warn("[translate] input transforms failed:", error instanceof Error ? error.message : error);
  }

  const wantStream = stream !== false;

  const baseBody: Record<string, unknown> = {
    model: config.model,
    stream: wantStream,
    messages: [
      {
        role: "system",
        content: buildSystemPrompt(lang, { forceTranslate: forceTranslate === true }),
      },
      { role: "user", content: effectiveText },
    ],
  };
  // Only sent when set: some providers require max_tokens, newer OpenAI models reject it.
  if (config.maxTokens != null) {
    baseBody.max_tokens = config.maxTokens;
  }
  // Ask streaming providers to include a final usage block. Some reject it, so a
  // retry without it is attempted below (retry #2).
  if (wantStream) {
    baseBody.stream_options = { include_usage: true };
  }
  const baseBodyNoUsage: Record<string, unknown> = { ...baseBody };
  delete baseBodyNoUsage.stream_options;

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

  /** Persist one usage record (never throws into the response path). */
  const meter = async (args: {
    usage: UpstreamUsage | null;
    resultText: string;
    translated: boolean;
    usageRequested: boolean;
  }): Promise<void> => {
    let inTok = 0;
    let outTok = 0;
    let estimated = false;
    if (args.usage && (args.usage.prompt_tokens !== undefined || args.usage.completion_tokens !== undefined)) {
      inTok = Math.max(0, Math.round(args.usage.prompt_tokens ?? 0));
      outTok = Math.max(0, Math.round(args.usage.completion_tokens ?? 0));
    } else if (args.translated) {
      // Provider emitted no usage → estimate from characters (chars/4).
      inTok = estimateTokens(effectiveText.length);
      outTok = estimateTokens(args.resultText.length);
      estimated = true;
    }
    const pricing = resolvePricing(config.model, preset);
    const costUsd = pricing ? computeCostUsd(inTok, outTok, pricing) : null;
    const record: StatsRecord = {
      ts: new Date().toISOString(),
      model: config.model,
      ...(preset ? { presetId: preset } : {}),
      inTok,
      outTok,
      costUsd,
      estimated,
    };
    try {
      await recordUsage(record, { translated: args.translated });
    } catch (error) {
      console.warn(
        "[translate] failed to record usage:",
        error instanceof Error ? error.message : error,
      );
    }
  };

  const isRetryable = (status: number): boolean => status === 400 || status === 422;

  let upstream: Response;
  try {
    upstream = await sendUpstream(upstreamBody);
  } catch (error) {
    return fetchErrorResponse(error);
  }

  // A preset's fast-mode params (bodyOverrides) may be rejected by a user-chosen
  // model that doesn't support them. Retry once without the overrides.
  if (overrides !== undefined && isRetryable(upstream.status)) {
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

  // Retry #2: some providers reject `stream_options`; drop it and retry once.
  if (wantStream && isRetryable(upstream.status)) {
    console.warn(
      `[translate] upstream ${upstream.status} with stream_options; retrying once without it`,
    );
    await readTextSafe(upstream);
    try {
      upstream = await sendUpstream(baseBodyNoUsage);
    } catch (error) {
      return fetchErrorResponse(error);
    }
  }

  if (!upstream.ok) {
    const bodyText = await readTextSafe(upstream);
    // The request reached the upstream: count the call even though it failed.
    await meter({ usage: null, resultText: "", translated: false, usageRequested: wantStream });
    return errorResponse(
      extractUpstreamError(bodyText, upstream.status),
      upstream.status,
    );
  }

  const contentType = upstream.headers.get("content-type") ?? "";

  const outputCtx = (streamed: boolean): Omit<OutputTransformContext, "text"> => ({
    targetLang: lang,
    stream: streamed,
  });

  if (wantStream) {
    if (contentType.includes("text/event-stream") && upstream.body) {
      // Buffered streaming: when any enabled output plugin declares "buffered",
      // collect the whole upstream text, transform once, emit a single chunk.
      if (await hasBufferedOutput()) {
        let usage: UpstreamUsage | null = null;
        let composed = "";
        const collected = createSseTextStream(upstream.body, signal, {
          onUsage: (value) => {
            usage = value;
          },
          onComplete: (text) => {
            composed = text;
          },
        });
        const reader = collected.getReader();
        try {
          for (;;) {
            const { done } = await reader.read();
            if (done) break;
          }
        } catch {
          // Fall through with whatever was collected.
        }
        const transformed = await applyOutputTransforms(composed, outputCtx(true));
        await meter({
          usage,
          resultText: transformed.trim(),
          translated: transformed.trim().length > 0,
          usageRequested: true,
        });
        return new Response(transformed, {
          status: 200,
          headers: textStreamHeaders(),
        });
      }

      let usage: UpstreamUsage | null = null;
      const streamBody = createSseTextStream(upstream.body, signal, {
        onUsage: (value) => {
          usage = value;
        },
        transformChunk: (chunk) => applyOutputTransforms(chunk, outputCtx(true)),
        onComplete: async (text) => {
          const produced = text.trim();
          await meter({
            usage,
            resultText: produced,
            translated: produced.length > 0,
            usageRequested: wantStream,
          });
        },
      });
      return new Response(streamBody, {
        status: 200,
        headers: textStreamHeaders(),
      });
    }

    // Provider ignored stream:true and returned a normal JSON completion.
    const bodyText = await readTextSafe(upstream);
    const parsed = parseJsonSafe(bodyText);
    const content = extractMessageContent(parsed);
    if (content === null || content.trim() === "") {
      await meter({ usage: extractUsage(parsed), resultText: "", translated: false, usageRequested: wantStream });
      return errorResponse("Upstream returned an empty translation", 502);
    }
    const transformed = await applyOutputTransforms(content.trim(), outputCtx(true));
    await meter({
      usage: extractUsage(parsed),
      resultText: transformed.trim(),
      translated: transformed.trim().length > 0,
      usageRequested: wantStream,
    });
    return new Response(transformed, {
      status: 200,
      headers: textStreamHeaders(),
    });
  }

  // Non-streaming: return the whole translation as JSON.
  const bodyText = await readTextSafe(upstream);
  const parsed = parseJsonSafe(bodyText);
  const content = extractMessageContent(parsed);
  if (content === null || content.trim() === "") {
    await meter({ usage: extractUsage(parsed), resultText: "", translated: false, usageRequested: wantStream });
    return errorResponse("Upstream returned an empty translation", 502);
  }
  const transformed = await applyOutputTransforms(content.trim(), outputCtx(false));
  await meter({
    usage: extractUsage(parsed),
    resultText: transformed.trim(),
    translated: transformed.trim().length > 0,
    usageRequested: wantStream,
  });
  const success: TranslateSuccess = { translation: transformed.trim() };
  return Response.json(success);
}
