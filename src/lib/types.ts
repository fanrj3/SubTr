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
  /**
   * Extra JSON fields merged into the upstream request body (e.g. reasoning-effort
   * controls for short-text fast mode). Cannot override model/messages/stream.
   */
  bodyOverrides?: Record<string, unknown>;
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
  /**
   * Params merged into EVERY request body for this preset (e.g. {"thinking":{"type":"disabled"}}).
   * Client-composed into TranslateRequest.bodyOverrides; unknown params are protected by
   * the server-side retry-without-overrides fallback.
   */
  defaultParams?: Record<string, unknown>;
  /**
   * Params merged into the request body when short-text fast mode is used
   * (e.g. { reasoning_effort: "low" }). Ignored when an explicit thinking mode is chosen.
   */
  fastModeParams?: Record<string, unknown>;
  /**
   * Per-mode thinking/reasoning control parameters (populated after provider research).
   * null = the mode is unsupported for this preset (UI falls back to defaults + shows `note`).
   */
  thinking?: {
    off?: Record<string, unknown> | null;
    low?: Record<string, unknown> | null;
    medium?: Record<string, unknown> | null;
    high?: Record<string, unknown> | null;
    /** UI hint, e.g. "GLM 5.3 cannot disable thinking — uses low effort". */
    note?: string;
  };
};
