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
export function buildSystemPrompt(
  targetLang: string,
  options?: { forceTranslate?: boolean },
): string {
  const base =
    `You are a professional translation engine. Translate the user's text into ${targetLang}. ` +
    `Output only the translation — no quotes, notes, explanations, or romanization. ` +
    `Preserve the original meaning, tone and formatting (including Markdown lists, bold and code). ` +
    `Translate every sentence. Words that are already in ${targetLang} may stay as they are, ` +
    `but never return the whole input unchanged just because part of it already matches ${targetLang}.`;
  if (options?.forceTranslate) {
    return (
      `${base} The source text is not ${targetLang}. You MUST translate it into ${targetLang}; ` +
      `returning the source text unchanged is an error.`
    );
  }
  return base;
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

/** Keys that user-supplied bodyOverrides may never replace. */
const PROTECTED_BODY_KEYS = ["model", "messages", "stream"] as const;

/**
 * Validate optional `bodyOverrides` from the request. Must be a plain object
 * when present (arrays, primitives and null are rejected).
 */
export function parseBodyOverrides(
  value: unknown,
): { ok: true; value: Record<string, unknown> | undefined } | { ok: false; error: string } {
  if (value === undefined) {
    return { ok: true, value: undefined };
  }
  if (!isRecord(value) || Array.isArray(value)) {
    return { ok: false, error: "bodyOverrides must be an object" };
  }
  return { ok: true, value };
}

/**
 * Merge `bodyOverrides` into the upstream body. Protected keys
 * (`model`, `messages`, `stream`) are always taken from the base body and can
 * never be overridden by the client.
 */
export function applyBodyOverrides(
  base: Record<string, unknown>,
  overrides?: Record<string, unknown>,
): Record<string, unknown> {
  if (!overrides) return base;
  const merged: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(overrides)) {
    if ((PROTECTED_BODY_KEYS as readonly string[]).includes(key)) continue;
    merged[key] = value;
  }
  // Defensive re-apply in case future protected keys are added.
  for (const key of PROTECTED_BODY_KEYS) {
    if (key in base) merged[key] = base[key];
  }
  return merged;
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

/** Token usage reported by an OpenAI-compatible upstream. */
export type UpstreamUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
};

/** Extract `usage.prompt_tokens` / `usage.completion_tokens` when present. */
export function extractUsage(value: unknown): UpstreamUsage | null {
  if (!isRecord(value)) return null;
  const usage = value.usage;
  if (!isRecord(usage)) return null;
  const prompt = usage.prompt_tokens;
  const completion = usage.completion_tokens;
  const result: UpstreamUsage = {};
  if (typeof prompt === "number" && Number.isFinite(prompt)) {
    result.prompt_tokens = prompt;
  }
  if (typeof completion === "number" && Number.isFinite(completion)) {
    result.completion_tokens = completion;
  }
  return result.prompt_tokens === undefined && result.completion_tokens === undefined
    ? null
    : result;
}

/** Estimate tokens from a character count (chars/4). */
export function estimateTokens(chars: number): number {
  return Math.max(0, Math.ceil(chars / 4));
}

/**
 * Parse one SSE line into incremental text and/or usage. A final chunk may carry
 * `usage` with an empty/absent `choices` array, so usage is checked first.
 */
function parseSseLine(rawLine: string): {
  text: string | null;
  usage: UpstreamUsage | null;
} {
  const line = rawLine.trim();
  if (!line.startsWith("data:")) return { text: null, usage: null };
  const data = line.slice("data:".length).trim();
  if (!data || data === "[DONE]") return { text: null, usage: null };
  const parsed = parseJsonSafe(data);
  if (!isRecord(parsed)) return { text: null, usage: null };

  const usage = extractUsage(parsed);
  const { choices } = parsed;
  if (!Array.isArray(choices) || choices.length === 0) return { text: null, usage };
  const first = choices[0];
  if (!isRecord(first)) return { text: null, usage };
  const { delta } = first;
  if (!isRecord(delta)) return { text: null, usage };
  const { content } = delta;
  // Only delta.content is forwarded; reasoning_content is intentionally ignored.
  return {
    text: typeof content === "string" && content.length > 0 ? content : null,
    usage,
  };
}

/** Hooks for observing an in-progress SSE translation stream. */
export type SseStreamHooks = {
  /** Called for the last usage block seen in the stream. */
  onUsage?: (usage: UpstreamUsage) => void;
  /**
   * Optional per-chunk output transform. Receives the decoded chunk text and
   * returns the text to forward. Errors leave the chunk unchanged.
   */
  transformChunk?: (text: string) => string | Promise<string>;
  /** Called once the stream ends with the full (untransformed) composed text. */
  onComplete?: (text: string) => void | Promise<void>;
};

/**
 * Convert an upstream SSE byte stream into a plain-text stream of translation
 * chunks. A line buffer is kept because TCP chunks can split lines anywhere
 * (including mid-JSON). Stops when the composed signal aborts (client gone or
 * timeout); malformed lines are skipped rather than failing the stream.
 */
export function createSseTextStream(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
  hooks?: SseStreamHooks,
): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let composed = "";

  const emit = async (controller: ReadableStreamDefaultController<Uint8Array>, text: string) => {
    composed += text;
    let out = text;
    if (hooks?.transformChunk) {
      try {
        out = await hooks.transformChunk(text);
      } catch {
        out = text;
      }
    }
    if (out) controller.enqueue(encoder.encode(out));
  };

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
              const { text, usage } = parseSseLine(line);
              if (usage) hooks?.onUsage?.(usage);
              if (text) await emit(controller, text);
              newlineIndex = buffer.indexOf("\n");
            }
          }
          // Flush a trailing line that never got its newline.
          const tail = buffer.replace(/\r$/, "");
          if (tail) {
            const { text, usage } = parseSseLine(tail);
            if (usage) hooks?.onUsage?.(usage);
            if (text) await emit(controller, text);
          }
        } catch {
          // Upstream/abort error: end quietly with whatever was emitted.
        } finally {
          try {
            await hooks?.onComplete?.(composed);
          } catch {
            // Never let a hook failure break the stream teardown.
          }
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
