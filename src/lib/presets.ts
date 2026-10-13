import type { ProviderPreset } from "./types";

/**
 * Built-in provider presets (all OpenAI-compatible endpoints).
 * Users can override base URL / model after picking a preset.
 * Model ids verified against provider docs (Oct 2026).
 */
export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: "openai",
    label: "OpenAI",
    baseURL: "https://api.openai.com/v1",
    defaultModel: "gpt-5-mini",
    fastModeParams: { reasoning_effort: "low" },
  },
  {
    id: "opencode-go",
    label: "OpenCode Go",
    baseURL: "https://opencode.ai/inference/go/v1",
    defaultModel: "deepseek-v4.1-flash",
    fastModeParams: { reasoning_effort: "low" },
    extraHeaders: {
      "x-opencode-session": "subtr",
      "User-Agent": "SubTr/0.1",
    },
    note: "OpenCode Go key · required session header added automatically",
  },
  {
    id: "anthropic",
    label: "Anthropic (Claude)",
    baseURL: "https://api.anthropic.com/v1",
    defaultModel: "claude-haiku-4-5",
    maxTokens: 1024,
  },
  {
    id: "google",
    label: "Google Gemini",
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
    defaultModel: "gemini-3.8-flash",
    fastModeParams: { reasoning_effort: "low" },
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    baseURL: "https://api.deepseek.com",
    defaultModel: "deepseek-flash",
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    baseURL: "https://openrouter.ai/api/v1",
    defaultModel: "openai/gpt-4.1-mini",
  },
  {
    id: "groq",
    label: "Groq",
    baseURL: "https://api.groq.com/openai/v1",
    defaultModel: "openai/gpt-oss-20b",
    fastModeParams: { reasoning_effort: "low" },
  },
  {
    id: "xai",
    label: "xAI (Grok)",
    baseURL: "https://api.x.ai/v1",
    defaultModel: "grok-4-fast",
  },
  {
    id: "mistral",
    label: "Mistral",
    baseURL: "https://api.mistral.ai/v1",
    defaultModel: "mistral-small-latest",
  },
  {
    id: "moonshot",
    label: "Moonshot (Kimi)",
    baseURL: "https://api.moonshot.cn/v1",
    defaultModel: "kimi-latest",
    note: "CN keys use api.moonshot.cn · intl keys use api.moonshot.ai",
  },
  {
    id: "zhipu",
    label: "Zhipu (GLM)",
    baseURL: "https://open.bigmodel.cn/api/paas/v4",
    defaultModel: "glm-5.3-flash",
    fastModeParams: { reasoning_effort: "low" },
  },
  {
    id: "dashscope",
    label: "Alibaba Qwen (DashScope)",
    baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    defaultModel: "qwen-flash",
    note: "Intl keys use dashscope-intl.aliyuncs.com",
  },
  {
    id: "siliconflow",
    label: "SiliconFlow",
    baseURL: "https://api.siliconflow.cn/v1",
    defaultModel: "Qwen/Qwen3-8B",
  },
  {
    id: "ollama",
    label: "Ollama (local)",
    baseURL: "http://localhost:11434/v1",
    defaultModel: "qwen3:8b",
    keyless: true,
    note: "Runs locally · pull the model first",
  },
  {
    id: "lmstudio",
    label: "LM Studio (local)",
    baseURL: "http://localhost:1234/v1",
    defaultModel: "local-model",
    keyless: true,
    note: "Runs locally · any model id maps to the loaded model",
  },
  {
    id: "custom",
    label: "Custom",
    baseURL: "",
    defaultModel: "",
    note: "Any OpenAI-compatible endpoint",
  },
];
