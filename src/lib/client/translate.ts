import type { ApiError, LlmConfig, TranslateRequest } from "@/lib/types";
import { shouldRetryEcho } from "./translation-utils";

export type TranslateCallbacks = {
  onChunk: (text: string) => void;
  onDone: () => void;
  onError: (message: string) => void;
};

export type StreamTranslateOptions = {
  /**
   * When a model echoes a CJK source instead of translating it to the target
   * language, retry once with an explicit "you must translate" prompt.
   * Default true.
   */
  retryOnEcho?: boolean;
};

type AttemptResult =
  | { kind: "ok"; text: string }
  | { kind: "error"; message: string }
  | { kind: "aborted" };

export async function streamTranslate(
  text: string,
  targetLang: string,
  config: LlmConfig,
  signal: AbortSignal,
  callbacks: TranslateCallbacks,
  bodyOverrides?: Record<string, unknown>,
  options?: StreamTranslateOptions
): Promise<void> {
  async function attempt(
    forceTranslate: boolean,
    reportErrors: boolean
  ): Promise<AttemptResult> {
    const body: TranslateRequest = {
      text,
      targetLang,
      config,
      stream: true,
    };
    if (bodyOverrides) body.bodyOverrides = bodyOverrides;
    if (forceTranslate) body.forceTranslate = true;

    function fail(message: string): AttemptResult {
      if (reportErrors) callbacks.onError(message);
      return { kind: "error", message };
    }

    let res: Response;
    try {
      res = await fetch("/api/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal,
      });
    } catch (err) {
      if (signal.aborted) return { kind: "aborted" };
      return fail(err instanceof Error ? err.message : "Network error");
    }

    if (!res.ok) {
      let message = `Server error ${res.status}`;
      try {
        const data = (await res.json()) as ApiError;
        if (data.error) message = data.error;
      } catch {
        // Leave the status-based message.
      }
      return fail(message);
    }

    if (!res.body) return fail("No response body");

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (signal.aborted) {
          await reader.cancel();
          return { kind: "aborted" };
        }
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        callbacks.onChunk(buffer);
      }
      buffer += decoder.decode();
      callbacks.onChunk(buffer);
      return { kind: "ok", text: buffer };
    } catch (err) {
      if (signal.aborted) return { kind: "aborted" };
      return fail(err instanceof Error ? err.message : "Stream error");
    }
  }

  const first = await attempt(false, true);
  if (first.kind !== "ok") return;

  let finalText = first.text;
  const retryOnEcho = options?.retryOnEcho !== false;
  if (retryOnEcho && shouldRetryEcho(text, targetLang, first.text)) {
    // The retry replaces the streamed text as chunks arrive. If it fails we keep
    // the first response instead of surfacing a second error.
    const second = await attempt(true, false);
    if (second.kind === "ok") {
      finalText = second.text;
    } else if (second.kind === "aborted") {
      return;
    }
  }

  // Keep the final text in the transcript even when a provider sent no chunks.
  if (!finalText) callbacks.onChunk("");
  callbacks.onDone();
}
