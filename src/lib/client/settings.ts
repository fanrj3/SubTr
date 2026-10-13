import type { LlmConfig } from "@/lib/types";
import { PROVIDER_PRESETS } from "@/lib/presets";
import { readStorage, writeStorage } from "./storage";

export const LEGACY_SETTINGS_KEY = "subtr.settings.v1";
export const SETTINGS_KEY = "subtr.settings.v2";

export type StoredProfile = {
  id: string;
  name: string;
  presetId: string;
  baseURL: string;
  apiKey: string;
  model: string;
  maxTokens?: number;
  extraHeaders?: Record<string, string>;
  /**
   * Thinking/reasoning control.
   * - 'preset': follow the preset's defaultParams + fastModeParams.
   * - other values: use preset.thinking?.[mode] if available.
   */
  thinkingMode?: "preset" | "off" | "low" | "medium" | "high";
};

export type SettingsStore = {
  version: 2;
  profiles: StoredProfile[];
  activeProfileId: string;
};

export type PersistedSettings = StoredProfile;

function createDefaultProfile(name = "Default", id = "default"): StoredProfile {
  const preset = PROVIDER_PRESETS.find((p) => p.id === "openai") ?? PROVIDER_PRESETS[0];
  return {
    id,
    name,
    presetId: preset.id,
    baseURL: preset.baseURL,
    apiKey: "",
    model: preset.defaultModel,
    maxTokens: preset.maxTokens,
    extraHeaders: preset.extraHeaders,
    thinkingMode: "preset",
  };
}

export const DEFAULT_SETTINGS_STORE: SettingsStore = (() => {
  const profile = createDefaultProfile();
  return {
    version: 2,
    profiles: [profile],
    activeProfileId: profile.id,
  };
})();

function migrateLegacySettings(): SettingsStore | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(LEGACY_SETTINGS_KEY);
    if (!raw) return null;
    const legacy = JSON.parse(raw) as {
      presetId?: string;
      baseURL?: string;
      apiKey?: string;
      model?: string;
      maxTokens?: number;
      extraHeaders?: Record<string, string>;
    };
    const preset = PROVIDER_PRESETS.find((p) => p.id === legacy.presetId) ??
      PROVIDER_PRESETS.find((p) => p.id === "openai") ??
      PROVIDER_PRESETS[0];
    const profile: StoredProfile = {
      id: "default",
      name: "Default",
      presetId: legacy.presetId ?? preset.id,
      baseURL: legacy.baseURL ?? preset.baseURL,
      apiKey: legacy.apiKey ?? "",
      model: legacy.model ?? preset.defaultModel,
      maxTokens: legacy.maxTokens ?? preset.maxTokens,
      extraHeaders: legacy.extraHeaders ?? preset.extraHeaders,
      thinkingMode: "preset",
    };
    const store: SettingsStore = {
      version: 2,
      profiles: [profile],
      activeProfileId: profile.id,
    };
    writeStorage(SETTINGS_KEY, store);
    return store;
  } catch {
    return null;
  }
}

export function readSettingsStore(): SettingsStore {
  if (typeof window === "undefined") {
    return DEFAULT_SETTINGS_STORE;
  }

  const stored = readStorage<SettingsStore | null>(SETTINGS_KEY, null);
  if (stored && stored.version === 2 && stored.profiles.length > 0) {
    return stored;
  }

  const migrated = migrateLegacySettings();
  if (migrated) return migrated;

  writeStorage(SETTINGS_KEY, DEFAULT_SETTINGS_STORE);
  return DEFAULT_SETTINGS_STORE;
}

export function writeSettingsStore(store: SettingsStore): void {
  writeStorage(SETTINGS_KEY, store);
}

export function getActiveProfile(store: SettingsStore): StoredProfile {
  const active = store.profiles.find((p) => p.id === store.activeProfileId);
  if (active) return active;
  return store.profiles[0];
}

export function readSettings(): PersistedSettings {
  return getActiveProfile(readSettingsStore());
}

export function applyPreset(
  presetId: string,
  current: StoredProfile
): StoredProfile {
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

export function toLlmConfig(profile: StoredProfile): LlmConfig {
  const config: LlmConfig = {
    baseURL: profile.baseURL.trim(),
    apiKey: profile.apiKey.trim(),
    model: profile.model.trim(),
  };
  if (profile.maxTokens !== undefined && profile.maxTokens > 0) {
    config.maxTokens = profile.maxTokens;
  }
  if (profile.extraHeaders && Object.keys(profile.extraHeaders).length > 0) {
    config.extraHeaders = profile.extraHeaders;
  }
  return config;
}
