import { APP_VERSION } from "@/lib/version";
import { readStorage, writeStorage } from "./storage";
import { notifyStorageKey } from "./use-local-storage";
import {
  readSettingsStore,
  writeSettingsStore,
  type SettingsStore,
  type StoredProfile,
} from "./settings";
import {
  SUBTITLE_TIMING_KEY,
  type SubtitleTiming,
} from "./subtitle-timing";
import {
  SUBTITLE_STYLE_KEY,
  writeSubtitleStyle,
  type SubtitleStyle,
} from "./subtitle-style";
import { readTheme, writeTheme, applyTheme, type Theme } from "./theme";
import {
  readUILang,
  writeUILang,
  applyUILang,
  type UILang,
} from "./i18n";
import { readHotkey, writeHotkey, registerHotkey } from "./hotkey";

export const TARGET_LANG_KEY = "subtr.targetLang.v1";
export const DEFAULT_TARGET_LANG = "auto";

export const CONFIG_VERSION = 1 as const;
export const PBKDF2_ITERATIONS = 310000;

export type EncryptedValue = {
  enc: {
    alg: "AES-GCM";
    kdf: "PBKDF2-SHA256";
    iterations: number;
    salt: string;
    iv: string;
    data: string;
  };
};

export type ExportedProfile = Omit<StoredProfile, "apiKey"> & {
  apiKey: EncryptedValue;
};

export type ConfigPayload = {
  version: typeof CONFIG_VERSION;
  exportedAt: string;
  appVersion: string;
  settings: {
    profiles: ExportedProfile[];
    subtitleTiming: Partial<SubtitleTiming>;
    subtitleStyle: Partial<SubtitleStyle>;
    theme: Theme;
    uiLang: UILang;
    hotkey: string;
    targetLang: string;
  };
};

export type ImportBundle = {
  profiles: StoredProfile[];
  subtitleTiming: Partial<SubtitleTiming>;
  subtitleStyle: Partial<SubtitleStyle>;
  theme: Theme;
  uiLang: UILang;
  hotkey: string;
  targetLang: string;
};

const encoder = new TextEncoder();

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function deriveKey(
  passphrase: string,
  salt: Uint8Array,
  iterations: number
): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: salt as BufferSource, iterations, hash: "SHA-256" },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

async function encryptString(plain: string, passphrase: string): Promise<EncryptedValue["enc"]> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt, PBKDF2_ITERATIONS);
  const data = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    key,
    encoder.encode(plain)
  );
  return {
    alg: "AES-GCM",
    kdf: "PBKDF2-SHA256",
    iterations: PBKDF2_ITERATIONS,
    salt: toBase64(salt),
    iv: toBase64(iv),
    data: toBase64(new Uint8Array(data)),
  };
}

async function decryptString(
  enc: EncryptedValue["enc"],
  passphrase: string
): Promise<string> {
  const salt = fromBase64(enc.salt);
  const iv = fromBase64(enc.iv);
  const key = await deriveKey(passphrase, salt, enc.iterations);
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    key,
    fromBase64(enc.data) as BufferSource
  );
  return new TextDecoder().decode(plain);
}

export async function buildConfigPayload(passphrase: string): Promise<ConfigPayload> {
  const store = readSettingsStore();
  const profiles: ExportedProfile[] = [];
  for (const profile of store.profiles) {
    const { apiKey, ...rest } = profile;
    profiles.push({
      ...rest,
      apiKey: { enc: await encryptString(apiKey, passphrase) },
    });
  }

  return {
    version: CONFIG_VERSION,
    exportedAt: new Date().toISOString(),
    appVersion: APP_VERSION,
    settings: {
      profiles,
      subtitleTiming: readStorage<Partial<SubtitleTiming>>(SUBTITLE_TIMING_KEY, {}),
      subtitleStyle: readStorage<Partial<SubtitleStyle>>(SUBTITLE_STYLE_KEY, {}),
      theme: readTheme(),
      uiLang: readUILang(),
      hotkey: readHotkey(),
      targetLang: readStorage<string>(TARGET_LANG_KEY, DEFAULT_TARGET_LANG),
    },
  };
}

export function isConfigPayload(value: unknown): value is ConfigPayload {
  if (!value || typeof value !== "object") return false;
  const payload = value as Partial<ConfigPayload>;
  return (
    payload.version === CONFIG_VERSION &&
    !!payload.settings &&
    Array.isArray(payload.settings.profiles)
  );
}

function unwrapEncrypted(value: unknown): EncryptedValue["enc"] | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  const inner =
    candidate.enc && typeof candidate.enc === "object" ? candidate.enc : candidate;
  const enc = inner as Record<string, unknown>;
  if (
    typeof enc.alg === "string" &&
    typeof enc.kdf === "string" &&
    typeof enc.iterations === "number" &&
    typeof enc.salt === "string" &&
    typeof enc.iv === "string" &&
    typeof enc.data === "string"
  ) {
    return enc as EncryptedValue["enc"];
  }
  return null;
}

export async function decryptPayload(
  payload: ConfigPayload,
  passphrase: string
): Promise<ImportBundle> {
  const profiles: StoredProfile[] = [];
  for (const profile of payload.settings.profiles) {
    const enc = unwrapEncrypted(profile.apiKey);
    if (!enc) throw new Error("Invalid encrypted key");
    const apiKey = await decryptString(enc, passphrase);
    profiles.push({ ...profile, apiKey });
  }
  return {
    profiles,
    subtitleTiming: payload.settings.subtitleTiming ?? {},
    subtitleStyle: payload.settings.subtitleStyle ?? {},
    theme: payload.settings.theme,
    uiLang: payload.settings.uiLang,
    hotkey: payload.settings.hotkey,
    targetLang: payload.settings.targetLang,
  };
}

export async function applyImportBundle(bundle: ImportBundle): Promise<void> {
  const store: SettingsStore = {
    version: 2,
    profiles: bundle.profiles,
    activeProfileId: bundle.profiles[0]?.id ?? "default",
  };
  writeSettingsStore(store);
  writeStorage(SUBTITLE_TIMING_KEY, bundle.subtitleTiming);
  notifyStorageKey(SUBTITLE_TIMING_KEY);
  writeSubtitleStyle({ ...bundle.subtitleStyle } as SubtitleStyle);
  writeTheme(bundle.theme);
  applyTheme(bundle.theme);
  writeUILang(bundle.uiLang);
  applyUILang(bundle.uiLang);
  writeHotkey(bundle.hotkey);
  await registerHotkey(bundle.hotkey);
  writeStorage(TARGET_LANG_KEY, bundle.targetLang);
  notifyStorageKey(TARGET_LANG_KEY);
}

export function downloadConfigFile(payload: ConfigPayload): void {
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const date = new Date();
  const stamp = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(
    date.getDate()
  ).padStart(2, "0")}`;
  const link = document.createElement("a");
  link.href = url;
  link.download = `subtr-config-${stamp}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
