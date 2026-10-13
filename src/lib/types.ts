/**
 * Shared contracts for SubTr.
 * Owner: orchestrator. Do not edit while parallel implementation lanes are running.
 */

/** Client-side cap; longer selections show a friendly message instead of translating. */
export const MAX_SELECTION_CHARS = 1500;

/** Hard server-side cap; /api/translate rejects longer text with 400. */
export const MAX_TEXT_CHARS = 2000;

/** OpenAI-compatible connection settings, stored locally by the client. */
export type LlmConfig = {
  /** OpenAI-compatible base URL, e.g. "https://api.openai.com/v1". A full ".../chat/completions" URL is also accepted. */
  baseURL: string;
  apiKey: string;
  model: string;
  /** Sent as `max_tokens` only when set (some providers require it, others reject it). */
  maxTokens?: number;
  /** Extra headers merged into upstream requests (provider-specific auth, etc.). */
  extraHeaders?: Record<string, string>;
};

/** POST /api/translate request body. */
export type TranslateRequest = {
  text: string;
  /** Target language label, e.g. "English", "中文（简体）". Sent inside the system prompt. */
  targetLang: string;
  config: LlmConfig;
  /** Default true → 200 body is a plain-text stream of the translation. false → 200 JSON {translation}. */
  stream?: boolean;
};

/** 200 response body for stream=false. */
export type TranslateSuccess = { translation: string };

/** Error body for non-2xx responses from any SubTr API route. */
export type ApiError = { error: string; status?: number };

/** POST /api/test request body. */
export type TestRequest = { config: LlmConfig };

/** POST /api/test always responds 200 with this shape (except 400 for malformed bodies). */
export type TestResult = {
  ok: boolean;
  /** Upstream HTTP status; 0 for network/timeout failures. */
  status: number;
  latencyMs: number;
  /** Short reply text when ok. */
  reply?: string;
  /** Human-readable failure message when !ok. */
  error?: string;
};

/** One entry of the built-in provider list (see src/lib/presets.ts). */
export type ProviderPreset = {
  id: string;
  label: string;
  baseURL: string;
  defaultModel: string;
  maxTokens?: number;
  extraHeaders?: Record<string, string>;
  /** Short hint shown under the picker, e.g. "Runs locally · no key needed". */
  note?: string;
  /** True for local servers that need no API key. */
  keyless?: boolean;
};
