import type { ApiError, LlmConfig, TranslateRequest } from "@/lib/types";

export type TranslateCallbacks = {
  onChunk: (text: string) => void;
  onDone: () => void;
  onError: (message: string) => void;
};

export async function streamTranslate(
  text: string,
  targetLang: string,
  config: LlmConfig,
  signal: AbortSignal,
  callbacks: TranslateCallbacks
): Promise<void> {
  const body: TranslateRequest = {
    text,
    targetLang,
    config,
    stream: true,
  };

  let res: Response;
  try {
    res = await fetch("/api/translate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if (signal.aborted) return;
    callbacks.onError(err instanceof Error ? err.message : "Network error");
    return;
  }

  if (!res.ok) {
    let message = `Server error ${res.status}`;
    try {
      const data = (await res.json()) as ApiError;
      if (data.error) message = data.error;
    } catch {
      // Leave the status-based message.
    }
    callbacks.onError(message);
    return;
  }

  if (!res.body) {
    callbacks.onError("No response body");
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (signal.aborted) {
        await reader.cancel();
        return;
      }
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      callbacks.onChunk(buffer);
    }
    // Flush any remaining bytes.
    buffer += decoder.decode();
    callbacks.onChunk(buffer);
    callbacks.onDone();
  } catch (err) {
    if (signal.aborted) return;
    callbacks.onError(err instanceof Error ? err.message : "Stream error");
  }
}
