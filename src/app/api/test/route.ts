import type { LlmConfig, TestResult } from "@/lib/types";
import {
  buildUpstreamHeaders,
  errorResponse,
  extractMessageContent,
  extractUpstreamError,
  isRecord,
  parseJsonSafe,
  parseLlmConfig,
  readTextSafe,
  requestErrorMessage,
  resolveChatCompletionsUrl,
} from "@/lib/server/llm";

const TEST_TIMEOUT_MS = 20000;

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

  const parsedConfig = parseLlmConfig(rawBody.config);
  if (!parsedConfig.ok) {
    return errorResponse(parsedConfig.error, 400);
  }

  const result = await runTest(parsedConfig.config, req.signal);
  return Response.json(result);
}

/** Always resolves to a TestResult; never throws. */
async function runTest(
  config: LlmConfig,
  clientSignal: AbortSignal,
): Promise<TestResult> {
  const urlResult = resolveChatCompletionsUrl(config.baseURL);
  if (!urlResult.ok) {
    return { ok: false, status: 0, latencyMs: 0, error: urlResult.error };
  }

  const body: Record<string, unknown> = {
    model: config.model,
    stream: false,
    messages: [{ role: "user", content: "ping" }],
  };
  if (config.maxTokens != null) {
    body.max_tokens = config.maxTokens;
  }

  const signal = AbortSignal.any([
    clientSignal,
    AbortSignal.timeout(TEST_TIMEOUT_MS),
  ]);

  const start = Date.now();
  let upstream: Response;
  try {
    upstream = await fetch(urlResult.url, {
      method: "POST",
      headers: buildUpstreamHeaders(config.apiKey, config.extraHeaders),
      body: JSON.stringify(body),
      signal,
    });
  } catch (error) {
    return {
      ok: false,
      status: 0,
      latencyMs: Date.now() - start,
      error: requestErrorMessage(error),
    };
  }
  const latencyMs = Date.now() - start;

  if (!upstream.ok) {
    const bodyText = await readTextSafe(upstream);
    return {
      ok: false,
      status: upstream.status,
      latencyMs,
      error: extractUpstreamError(bodyText, upstream.status),
    };
  }

  const bodyText = await readTextSafe(upstream);
  const content = extractMessageContent(parseJsonSafe(bodyText)) ?? "";
  return {
    ok: true,
    status: upstream.status,
    latencyMs,
    reply: content.trim().slice(0, 60),
  };
}
