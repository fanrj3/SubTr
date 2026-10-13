import type { LlmConfig } from "@/lib/types";
import { PROVIDER_PRESETS } from "@/lib/presets";
import { readStorage, writeStorage } from "./storage";

export const SETTINGS_KEY = "subtr.settings.v1";

export type PersistedSettings = {
  presetId: string;
  baseURL: string;
  apiKey: string;
  model: string;
  maxTokens?: number;
  extraHeaders?: Record<string, string>;
  /** Use provider-specific fast-mode params for short text translations. */
  fastModeEnabled?: boolean;
  /** Word-count threshold for short-text fast mode. */
  fastModeWordLimit?: number;
};

const DEFAULT_PRESET = PROVIDER_PRESETS.find((p) => p.id === "openai") ?? PROVIDER_PRESETS[0];

export const DEFAULT_SETTINGS: PersistedSettings = {
  presetId: DEFAULT_PRESET.id,
  baseURL: DEFAULT_PRESET.baseURL,
  apiKey: "",
  model: DEFAULT_PRESET.defaultModel,
  maxTokens: DEFAULT_PRESET.maxTokens,
  extraHeaders: DEFAULT_PRESET.extraHeaders,
  fastModeEnabled: true,
  fastModeWordLimit: 20,
};

export function readSettings(): PersistedSettings {
  const stored = readStorage<PersistedSettings>(SETTINGS_KEY, DEFAULT_SETTINGS);
  // Ensure every field from the default exists in case the stored shape is older.
  return { ...DEFAULT_SETTINGS, ...stored };
}

export function writeSettings(settings: PersistedSettings): void {
  writeStorage(SETTINGS_KEY, settings);
}

export function applyPreset(
  presetId: string,
  current: PersistedSettings
): PersistedSettings {
  const preset = PROVIDER_PRESETS.find((p) => p.id === presetId);
  if (!preset) return { ...current, presetId };
  return {
    ...current,
    presetId: preset.id,
    baseURL: preset.baseURL,
    model: preset.defaultModel,
    maxTokens: preset.maxTokens,
    extraHeaders: preset.extraHeaders,
  };
}

export function toLlmConfig(settings: PersistedSettings): LlmConfig {
  const config: LlmConfig = {
    baseURL: settings.baseURL.trim(),
    apiKey: settings.apiKey.trim(),
    model: settings.model.trim(),
  };
  if (settings.maxTokens !== undefined && settings.maxTokens > 0) {
    config.maxTokens = settings.maxTokens;
  }
  if (settings.extraHeaders && Object.keys(settings.extraHeaders).length > 0) {
    config.extraHeaders = settings.extraHeaders;
  }
  return config;
}
