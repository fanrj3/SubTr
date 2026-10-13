import type { ApiError, LlmConfig } from "@/lib/types";

/**
 * Shared helpers for the server-side LLM proxy routes.
 *
 * All providers are OpenAI-compatible chat-completions endpoints. The base URL
 * is supplied by the user (local tool, no server-side allowlist): this is by
 * design so local/keyless servers and any provider work without code changes.
 */

const encoder = new TextEncoder();

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Build the error body shared by every SubTr API route. */
export function errorResponse(error: string, status: number): Response {
  const body: ApiError = { error, status };
  return Response.json(body, { status });
}

/** Truncate long upstream text so error bodies stay readable. */
export function truncate(text: string, max = 300): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/**
 * Resolve a user-supplied base URL to a chat-completions endpoint.
 * Trailing slashes are stripped; URLs already ending in `/chat/completions`
 * are used as-is, everything else gets the suffix appended.
 */
export function resolveChatCompletionsUrl(
  baseURL: string,
): { ok: true; url: string } | { ok: false; error: string } {
  const trimmed = baseURL.trim();
  if (!/^https?:\/\//i.test(trimmed)) {
    return { ok: false, error: "Base URL must start with http:// or https://" };
  }
  const base = trimmed.replace(/\/+$/, "");
  const url = base.endsWith("/chat/completions")
    ? base
    : `${base}/chat/completions`;
  return { ok: true, url };
}

/** System prompt used by /api/translate. */
export function buildSystemPrompt(targetLang: string): string {
  return (
    `You are a translation engine. Translate the user's text into ${targetLang}. ` +
    `Output only the translation, with no quotes, notes, explanations, or romanization. ` +
    `Preserve the original tone, meaning, and formatting. ` +
    `If the text is already in ${targetLang}, return it unchanged.`
  );
}

/**
 * Headers for the upstream request. `Content-Type: application/json` always;
 * `Authorization: Bearer <apiKey>` only when a key is present (local keyless
 * servers); then `extraHeaders` are merged last so they may override either.
 */
export function buildUpstreamHeaders(
  apiKey: string,
  extraHeaders?: Record<string, string>,
): Headers {
  const headers = new Headers();
  headers.set("Content-Type", "application/json");
  const key = apiKey.trim();
  if (key) {
    headers.set("Authorization", `Bearer ${key}`);
  }
  if (extraHeaders) {
    for (const [name, value] of Object.entries(extraHeaders)) {
      headers.set(name, value);
    }
  }
  return headers;
}

/** Validate an untrusted value into a typed LlmConfig. */
export function parseLlmConfig(
  value: unknown,
): { ok: true; config: LlmConfig } | { ok: false; error: string } {
  if (!isRecord(value)) {
    return { ok: false, error: "config must be an object" };
  }
  const { baseURL, apiKey, model, maxTokens, extraHeaders } = value;
  if (typeof baseURL !== "string") {
    return { ok: false, error: "config.baseURL must be a string" };
  }
  if (typeof apiKey !== "string") {
    return { ok: false, error: "config.apiKey must be a string" };
  }
  if (typeof model !== "string" || model.trim() === "") {
    return { ok: false, error: "config.model must be a non-empty string" };
  }

  let parsedMaxTokens: number | undefined;
  if (maxTokens !== undefined) {
    if (typeof maxTokens !== "number" || !Number.isFinite(maxTokens)) {
      return { ok: false, error: "config.maxTokens must be a number" };
    }
    parsedMaxTokens = maxTokens;
  }

  let parsedExtraHeaders: Record<string, string> | undefined;
  if (extraHeaders !== undefined) {
    if (!isRecord(extraHeaders)) {
      return { ok: false, error: "config.extraHeaders must be an object" };
    }
    parsedExtraHeaders = {};
    for (const [name, headerValue] of Object.entries(extraHeaders)) {
      if (typeof headerValue !== "string") {
        return { ok: false, error: "config.extraHeaders values must be strings" };
      }
      parsedExtraHeaders[name] = headerValue;
    }
  }

  const config: LlmConfig = {
    baseURL,
    apiKey,
    model: model.trim(),
    ...(parsedMaxTokens !== undefined ? { maxTokens: parsedMaxTokens } : {}),
    ...(parsedExtraHeaders ? { extraHeaders: parsedExtraHeaders } : {}),
  };
  return { ok: true, config };
}

/** Read a response body as text without throwing. */
export async function readTextSafe(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "";
  }
}

/** JSON.parse without throwing; returns null on malformed input. */
export function parseJsonSafe(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Extract a human-readable message from an upstream error body.
 * Tries JSON `error.message`, then a string `error`, then raw text.
 */
export function extractUpstreamError(bodyText: string, status?: number): string {
  const trimmed = bodyText.trim();
  if (trimmed) {
    const parsed = parseJsonSafe(trimmed);
    if (isRecord(parsed)) {
      const error = parsed.error;
      if (isRecord(error) && typeof error.message === "string" && error.message.trim()) {
        return truncate(error.message.trim());
      }
      if (typeof error === "string" && error.trim()) {
        return truncate(error.trim());
      }
    }
    return truncate(trimmed);
  }
  return status !== undefined
    ? `Upstream request failed with status ${status}`
    : "Upstream request failed";
}

/** True when a fetch error came from an abort/timeout signal. */
export function isTimeoutError(error: unknown): boolean {
  return (
    isRecord(error) &&
    ("name" in error) &&
    (error as { name?: unknown }).name === "TimeoutError"
  );
}

/** Message for a fetch/abort failure. */
export function requestErrorMessage(error: unknown): string {
  if (isTimeoutError(error)) {
    return "Request timed out";
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return "Request timed out";
}

/** Extract `choices[0].message.content` from a non-streaming chat response. */
export function extractMessageContent(value: unknown): string | null {
  if (!isRecord(value)) return null;
  const { choices } = value;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const first = choices[0];
  if (!isRecord(first)) return null;
  const { message } = first;
  if (!isRecord(message)) return null;
  const { content } = message;
  return typeof content === "string" ? content : null;
}

/**
 * Parse one SSE line into incremental text, or null if it carries nothing.
 * Malformed mid-stream lines are skipped so streaming continues.
 */
function parseSseLine(rawLine: string): string | null {
  const line = rawLine.trim();
  if (!line.startsWith("data:")) return null;
  const data = line.slice("data:".length).trim();
  if (!data || data === "[DONE]") return null;
  const parsed = parseJsonSafe(data);
  if (!isRecord(parsed)) return null;
  const { choices } = parsed;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const first = choices[0];
  if (!isRecord(first)) return null;
  const { delta } = first;
  if (!isRecord(delta)) return null;
  const { content } = delta;
  // Only delta.content is forwarded; reasoning_content is intentionally ignored.
  return typeof content === "string" && content.length > 0 ? content : null;
}

/**
 * Convert an upstream SSE byte stream into a plain-text stream of translation
 * chunks. A line buffer is kept because TCP chunks can split lines anywhere
 * (including mid-JSON). Stops when the composed signal aborts (client gone or
 * timeout); malformed lines are skipped rather than failing the stream.
 */
export function createSseTextStream(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  return new ReadableStream<Uint8Array>({
    start(controller) {
      void (async () => {
        try {
          for (;;) {
            if (signal.aborted) break;
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            let newlineIndex = buffer.indexOf("\n");
            while (newlineIndex !== -1) {
              const line = buffer.slice(0, newlineIndex).replace(/\r$/, "");
              buffer = buffer.slice(newlineIndex + 1);
              const text = parseSseLine(line);
              if (text) controller.enqueue(encoder.encode(text));
              newlineIndex = buffer.indexOf("\n");
            }
          }
          // Flush a trailing line that never got its newline.
          const tail = buffer.replace(/\r$/, "");
          if (tail) {
            const text = parseSseLine(tail);
            if (text) controller.enqueue(encoder.encode(text));
          }
        } catch {
          // Upstream/abort error: end quietly with whatever was emitted.
        } finally {
          try {
            controller.close();
          } catch {
            // Already closed (consumer cancelled).
          }
        }
      })();
    },
    cancel() {
      void reader.cancel();
    },
  });
}

/** Streaming response headers for a plain-text translation body. */
export function textStreamHeaders(): HeadersInit {
  return {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Accel-Buffering": "no",
  };
}
