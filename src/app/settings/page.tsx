"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { Tabs } from "@base-ui/react/tabs";
import { APP_VERSION } from "@/lib/version";
import { PageFade } from "@/components/page-fade";
import { PROVIDER_PRESETS } from "@/lib/presets";
import type {
  SettingsStore,
  StoredProfile,
  SubtitleStyle,
  SubtitleTiming,
} from "@/lib/client";
import {
  applyPreset,
  paceFromScale,
  DEFAULT_SETTINGS_STORE,
  DEFAULT_SUBTITLE_STYLE,
  DEFAULT_SUBTITLE_TIMING,
  toLlmConfig,
  testConnection,
  READING_PACE_SCALE,
  useLocalStorage,
  useT,
  SETTINGS_KEY,
  SUBTITLE_TIMING_KEY,
  SUBTITLE_STYLE_KEY,
  notifySubtitleStyleChanged,
  DEFAULT_THEME,
  applyTheme,
  readTheme,
  writeTheme,
  subscribeTheme,
  readSettingsStore,
  DEFAULT_UI_LANG,
  applyUILang,
  readUILang,
  writeUILang,
  subscribeUILang,
  isDarkTheme,
  effectiveUILang,
  usePlugins,
  mergeProviderPresets,
  checkForUpdate,
  type Theme,
  type UILang,
} from "@/lib/client";
import { ArrowLeftIcon, CheckIcon, AlertIcon, LoaderIcon } from "@/components/icons";
import { HelpTooltip } from "@/components/tooltip";
import { PositionPlayer } from "@/components/position-player";
import { HotkeyRecorder } from "@/components/hotkey-recorder";
import { ConfigTransfer } from "@/components/config-transfer";
import { PluginsSection } from "@/components/plugins-section";
import { VoiceSettings } from "@/components/voice-settings";
import { UpdateBanner } from "@/components/update-banner";
import {
  Advanced,
  SettingsRow,
  SettingsRowFull,
  SettingsSelect,
  SettingsSlider,
  SettingsSurface,
} from "@/components/settings-ui";

type TestStatus =
  | { kind: "idle" }
  | { kind: "testing" }
  | { kind: "success"; latencyMs: number; reply?: string }
  | { kind: "error"; message: string };

const PACE_MIN = 0.2;
const PACE_MAX = 5;

function paceToPos(scale: number): number {
  return (
    (Math.log(Math.max(PACE_MIN, scale)) - Math.log(PACE_MIN)) /
    (Math.log(PACE_MAX) - Math.log(PACE_MIN))
  );
}

function posToPace(pos: number): number {
  const raw = Math.exp(
    Math.log(PACE_MIN) + pos * (Math.log(PACE_MAX) - Math.log(PACE_MIN))
  );
  return Math.round(raw * 100) / 100;
}

function PaceSlider({
  value,
  onChange,
  ariaLabel,
}: {
  value: number;
  onChange: (value: number) => void;
  ariaLabel: string;
}) {
  const pct = paceToPos(value) * 100;
  return (
    <div className="w-full">
      <input
        type="range"
        min={0}
        max={100}
        step={0.5}
        value={pct}
        onChange={(e) => onChange(posToPace(parseFloat(e.target.value) / 100))}
        aria-label={ariaLabel}
        className="w-full accent-accent"
      />
      <div className="relative mt-0.5 h-3">
        {[0.2, 0.5, 1, 2, 5].map((tick) => (
          <span
            key={tick}
            className="absolute -translate-x-1/2 text-[10px] tabular-nums text-muted"
            style={{ left: `${paceToPos(tick) * 100}%` }}
          >
            {tick}
          </span>
        ))}
      </div>
    </div>
  );
}

function RailIcon({ name }: { name: string }) {
  const common = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    className: "h-4 w-4 shrink-0",
    "aria-hidden": true,
  };
  switch (name) {
    case "cloud":
      return (
        <svg {...common}>
          <path d="M17.5 19a4.5 4.5 0 0 0 .5-8.97A6 6 0 0 0 6.2 9.5 4 4 0 0 0 7 19Z" />
        </svg>
      );
    case "user":
      return (
        <svg {...common}>
          <circle cx="12" cy="8" r="4" />
          <path d="M4 21a8 8 0 0 1 16 0" />
        </svg>
      );
    case "captions":
      return (
        <svg {...common}>
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <path d="M7 12h4m3 0h3M7 15h2m3 0h5" />
        </svg>
      );
    case "puzzle":
      return (
        <svg {...common}>
          <path d="M9 4a2 2 0 0 1 4 0v1h2a2 2 0 0 1 2 2v2h1a2 2 0 0 1 0 4h-1v2a2 2 0 0 1-2 2h-2v1a2 2 0 0 1-4 0v-1H7a2 2 0 0 1-2-2v-2H4a2 2 0 0 1 0-4h1V7a2 2 0 0 1 2-2h2Z" />
        </svg>
      );
    case "info":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 11v5" />
          <path d="M12 8h.01" />
        </svg>
      );
    case "mic":
      return (
        <svg {...common}>
          <rect x="9" y="3" width="6" height="11" rx="3" />
          <path d="M5 11a7 7 0 0 0 14 0" />
          <path d="M12 18v3" />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
        </svg>
      );
  }
}

function useThemeSetting(): [Theme, (theme: Theme) => void] {
  const theme = useSyncExternalStore(
    subscribeTheme,
    () => readTheme(),
    () => DEFAULT_THEME
  );

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  // Re-apply (and re-notify the desktop bridge) when the OS preference changes
  // while the app is in Follow-system mode.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => applyTheme(theme);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [theme]);

  const setTheme = useCallback((next: Theme) => {
    writeTheme(next);
    applyTheme(next);
  }, []);
  return [theme, setTheme];
}

function useUILangSetting(): [UILang, (lang: UILang) => void] {
  const lang = useSyncExternalStore(
    subscribeUILang,
    () => readUILang(),
    () => DEFAULT_UI_LANG
  );

  useEffect(() => {
    applyUILang(lang);
  }, [lang]);

  const setLang = useCallback((next: UILang) => {
    writeUILang(next);
    applyUILang(next);
  }, []);
  return [lang, setLang];
}

function mergeTiming(raw: Partial<SubtitleTiming>): SubtitleTiming {
  return { ...DEFAULT_SUBTITLE_TIMING, ...raw };
}

function mergeStyle(raw: Partial<SubtitleStyle>): SubtitleStyle {
  return { ...DEFAULT_SUBTITLE_STYLE, ...raw };
}

function normalizeStore(raw: SettingsStore | null): SettingsStore {
  if (!raw || !Array.isArray(raw.profiles) || raw.profiles.length === 0) {
    return DEFAULT_SETTINGS_STORE;
  }
  return raw;
}

function useSettings() {
  const [rawStore, setStore] = useLocalStorage<SettingsStore>(SETTINGS_KEY, DEFAULT_SETTINGS_STORE);
  const [rawTiming, setTiming] = useLocalStorage<Partial<SubtitleTiming>>(SUBTITLE_TIMING_KEY, {});
  const [rawStyle, setStyle] = useLocalStorage<Partial<SubtitleStyle>>(SUBTITLE_STYLE_KEY, {});
  const [theme, setTheme] = useThemeSetting();
  const [uiLang, setUiLang] = useUILangSetting();

  const store = useMemo(() => normalizeStore(rawStore), [rawStore]);
  const timing = useMemo(() => mergeTiming(rawTiming), [rawTiming]);
  const style = useMemo(() => mergeStyle(rawStyle), [rawStyle]);

  useEffect(() => {
    notifySubtitleStyleChanged();
  }, [style]);

  useEffect(() => {
    // Trigger v1 -> v2 migration when a legacy user lands directly on /settings,
    // and sync the migrated store into state if it differs from the cached fallback.
    const current = readSettingsStore();
    if (JSON.stringify(current) !== JSON.stringify(store)) {
      setStore(current);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    store,
    timing,
    style,
    theme,
    uiLang,
    updateStore: setStore,
    updateTiming: setTiming,
    updateStyle: setStyle,
    updateTheme: setTheme,
    updateUiLang: setUiLang,
  };
}

function updateActiveProfile(
  store: SettingsStore,
  patch: Partial<StoredProfile>
): SettingsStore {
  return {
    ...store,
    profiles: store.profiles.map((p) =>
      p.id === store.activeProfileId ? { ...p, ...patch } : p
    ),
  };
}

function activeProfile(store: SettingsStore): StoredProfile {
  const active = store.profiles.find((p) => p.id === store.activeProfileId);
  if (active) return active;
  if (store.profiles[0]) return store.profiles[0];
  return DEFAULT_SETTINGS_STORE.profiles[0];
}

export default function SettingsPage() {
  const { t } = useT();
  const { store, timing, style, theme, uiLang, updateStore, updateTiming, updateStyle, updateTheme, updateUiLang } = useSettings();
  const plugins = usePlugins();
  const profile = activeProfile(store);
  const providers = useMemo(
    () => mergeProviderPresets(PROVIDER_PRESETS, plugins.data),
    [plugins.data]
  );
  const panelTheme = isDarkTheme(theme) ? "dark" : "light";
  const panelLang = effectiveUILang(uiLang);

  const [test, setTest] = useState<TestStatus>({ kind: "idle" });
  const [showKey, setShowKey] = useState(false);
  const [editingName, setEditingName] = useState<string | null>(null);
  const [section, setSection] = useLocalStorage<string>(
    "subtr.settings.section.v1",
    "provider"
  );
  const mounted = useIsMounted();

  const aboutPlatform =
    mounted && typeof window !== "undefined" && window.subtrDesktop
      ? t("settings.about.desktop")
      : t("settings.about.web");
  const aboutRuntime =
    mounted && typeof navigator !== "undefined" ? navigator.userAgent : "—";
  const aboutDataDir = (() => {
    if (!mounted || typeof navigator === "undefined") return "—";
    const p = navigator.platform.toLowerCase();
    if (p.includes("mac")) return "~/Library/Application Support/subtr";
    if (p.includes("win")) return "%APPDATA%/subtr";
    return "~/.config/subtr";
  })();

  const [voicePaths, setVoicePaths] = useState<{ server: string; model: string } | null>(
    null
  );
  useEffect(() => {
    if (typeof window === "undefined") return;
    const b = window.subtrDesktop;
    if (!b?.voiceSetup) return;
    void b
      .voiceSetup()
      .then((s) => setVoicePaths({ server: s.server, model: s.model }))
      .catch(() => setVoicePaths(null));
  }, []);

  type UpdateStatus =
    | { kind: "idle" }
    | { kind: "checking" }
    | { kind: "upToDate" }
    | { kind: "available"; version: string; url: string }
    | { kind: "error" };
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>({ kind: "idle" });

  async function checkForUpdates() {
    setUpdateStatus({ kind: "checking" });
    const result = await checkForUpdate();
    if (result.status === "available") {
      setUpdateStatus({ kind: "available", version: result.version, url: result.url });
    } else if (result.status === "upToDate") {
      setUpdateStatus({ kind: "upToDate" });
    } else {
      setUpdateStatus({ kind: "error" });
    }
  }

  const handleProfileChange = useCallback(
    (patch: Partial<StoredProfile>) => {
      updateStore(updateActiveProfile(store, patch));
      setTest({ kind: "idle" });
    },
    [store, updateStore]
  );

  const handlePresetChange = useCallback(
    (presetId: string) => {
      updateStore(updateActiveProfile(store, applyPreset(presetId, profile, providers)));
    },
    [profile, store, updateStore, providers]
  );

  const handleCreateProfile = useCallback(() => {
    const preset = PROVIDER_PRESETS.find((p) => p.id === "openai") ?? PROVIDER_PRESETS[0];
    const newProfile: StoredProfile = {
      id: crypto.randomUUID(),
      name: t("settings.profiles.defaultName", { n: store.profiles.length + 1 }),
      presetId: preset.id,
      baseURL: preset.baseURL,
      apiKey: "",
      model: preset.defaultModel,
      maxTokens: preset.maxTokens,
      extraHeaders: preset.extraHeaders,
      thinkingMode: "preset",
    };
    const next: SettingsStore = {
      ...store,
      profiles: [...store.profiles, newProfile],
      activeProfileId: newProfile.id,
    };
    updateStore(next);
  }, [store, updateStore, t]);

  const handleDuplicateProfile = useCallback(() => {
    const newProfile: StoredProfile = {
      ...profile,
      id: crypto.randomUUID(),
      name: `${profile.name} copy`,
    };
    const next: SettingsStore = {
      ...store,
      profiles: [...store.profiles, newProfile],
      activeProfileId: newProfile.id,
    };
    updateStore(next);
  }, [profile, store, updateStore]);

  const handleSwitchProfile = useCallback(
    (id: string) => {
      updateStore({ ...store, activeProfileId: id });
      setTest({ kind: "idle" });
    },
    [store, updateStore]
  );

  const handleRenameProfile = useCallback(
    (id: string, name: string) => {
      updateStore({
        ...store,
        profiles: store.profiles.map((p) => (p.id === id ? { ...p, name } : p)),
      });
      setEditingName(null);
    },
    [store, updateStore]
  );

  const handleDeleteProfile = useCallback(
    (id: string) => {
      if (store.profiles.length <= 1) return;
      const remaining = store.profiles.filter((p) => p.id !== id);
      const nextActive =
        store.activeProfileId === id ? remaining[0].id : store.activeProfileId;
      updateStore({ ...store, profiles: remaining, activeProfileId: nextActive });
    },
    [store, updateStore]
  );

  async function handleTest() {
    setTest({ kind: "testing" });
    const result = await testConnection(toLlmConfig(profile));
    if (result.ok) {
      setTest({ kind: "success", latencyMs: result.latencyMs, reply: result.reply });
    } else {
      setTest({ kind: "error", message: result.error ?? t("error.connectionFailed") });
    }
  }

  function latencyFlavor(ms: number): string {
    if (ms < 500) return t("settings.provider.latency.fast");
    if (ms <= 1000) return t("settings.provider.latency.medium");
    return t("settings.provider.latency.slow");
  }

  const selectedPreset = providers.find((p) => p.id === profile.presetId);

  const railItems = [
    { group: t("settings.nav.group.translate"), value: "provider", label: t("settings.provider.title"), icon: "cloud" },
    { group: null, value: "profiles", label: t("settings.profiles.title"), icon: "user" },
    { group: t("settings.nav.group.subtitle"), value: "subtitle", label: t("settings.subtitle.title"), icon: "captions" },
    { group: t("settings.nav.group.plugins"), value: "plugins", label: t("settings.plugins.title"), icon: "puzzle" },
    { group: t("settings.nav.group.app"), value: "app", label: t("settings.app.title"), icon: "gear" },
    { group: null, value: "voice", label: t("settings.voice.title"), icon: "mic" },
    { group: null, value: "about", label: t("settings.about.title"), icon: "info" },
  ] as const;
  const paneTitle =
    railItems.find((item) => item.value === section)?.label ?? t("settings.title");

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-background text-foreground">
      <header className="z-30 shrink-0 border-b border-card-border bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex h-14 min-w-0 max-w-6xl items-center gap-3 px-4 sm:px-6">
          <Link
            href="/"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-medium text-muted transition-colors hover:bg-black/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent dark:hover:bg-white/5"
          >
            <ArrowLeftIcon className="h-4 w-4" />
            {t("settings.back")}
          </Link>
          <h1 className="truncate text-sm font-semibold tracking-tight">{t("settings.title")}</h1>
        </div>
      </header>

      <UpdateBanner />

      <PageFade>
      <Tabs.Root
        value={section}
        onValueChange={(value) => setSection(value as string)}
        orientation="vertical"
        className="mx-auto flex w-full max-w-6xl flex-1 min-h-0 items-stretch gap-4 overflow-hidden overflow-x-hidden px-2 py-4 sm:gap-6 sm:px-6 sm:py-6"
      >
        <Tabs.List
          aria-label={t("settings.title")}
          className="flex h-full w-12 shrink-0 flex-col gap-0.5 overflow-y-auto overflow-x-hidden overscroll-contain [scrollbar-gutter:stable] min-[700px]:w-52"
        >
          {railItems.map((item, index) => (
            <div key={item.value} className="contents">
              {item.group && (
                <div className="hidden px-2.5 pb-1 pt-3 text-[11px] font-medium uppercase tracking-wide text-muted min-[700px]:block">
                  {item.group}
                </div>
              )}
              <Tabs.Tab
                value={item.value}
                title={item.label}
                aria-label={item.label}
                className="flex h-9 items-center gap-2.5 rounded-[10px] px-2.5 text-left text-[13px] font-medium text-muted outline-none transition-colors hover:bg-black/5 focus-visible:ring-2 focus-visible:ring-accent data-[selected]:bg-accent-dim data-[selected]:text-foreground dark:hover:bg-white/5"
              >
                <RailIcon name={item.icon} />
                <span className="hidden truncate min-[700px]:inline">{item.label}</span>
              </Tabs.Tab>
              {index === railItems.length - 1 && (
                <div className="mt-auto hidden border-t border-card-border pt-3 min-[700px]:block">
                  <p className="px-2.5 text-[11px] text-muted">SubTr</p>
                  <p className="px-2.5 text-[11px] tabular-nums text-muted">v{APP_VERSION}</p>
                </div>
              )}
            </div>
          ))}
        </Tabs.List>

        <main className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain [scrollbar-gutter:stable]">
          <div className="pointer-events-none sticky top-0 z-10 bg-gradient-to-b from-background via-background to-transparent pb-3 pt-1">
            <h2 className="text-base font-semibold tracking-tight">{paneTitle}</h2>
          </div>

          <div className="space-y-4">
            <Tabs.Panel value="profiles">
          <SettingsSurface>
            {store.profiles.map((p) => {
              const isActive = p.id === store.activeProfileId;
              const isEditing = editingName === p.id;
              return (
                <SettingsRow
                  key={p.id}
                  className={isActive ? "bg-accent-dim" : ""}
                  title={
                    isEditing ? (
                      <input
                        autoFocus
                        defaultValue={p.name}
                        onBlur={(e) => handleRenameProfile(p.id, e.target.value || p.name)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            handleRenameProfile(p.id, e.currentTarget.value || p.name);
                          }
                          if (e.key === "Escape") setEditingName(null);
                        }}
                        className="w-full rounded-lg border border-card-border bg-background px-2 py-1 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-accent"
                      />
                    ) : (
                      <span className="truncate">{p.name}</span>
                    )
                  }
                  description={isActive ? t("settings.profiles.active") : undefined}
                >
                  {!isEditing && (
                    <div className="flex items-center gap-1">
                      {!isActive && (
                        <button
                          type="button"
                          onClick={() => handleSwitchProfile(p.id)}
                          className="rounded-md px-2 py-1 text-xs text-muted transition-colors hover:bg-black/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent dark:hover:bg-white/5"
                        >
                          {t("settings.profiles.setActive")}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setEditingName(p.id)}
                        className="rounded-md px-2 py-1 text-xs text-muted transition-colors hover:bg-black/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent dark:hover:bg-white/5"
                      >
                        {t("settings.profiles.rename")}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteProfile(p.id)}
                        disabled={store.profiles.length <= 1}
                        className="rounded-md px-2 py-1 text-xs text-danger transition-colors hover:bg-danger-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-40"
                      >
                        {t("settings.profiles.delete")}
                      </button>
                    </div>
                  )}
                </SettingsRow>
              );
            })}

            <SettingsRow title={t("settings.profiles.new")}>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={handleDuplicateProfile}
                  className="rounded-lg border border-card-border bg-background px-2.5 py-1.5 text-xs font-medium transition-colors hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent dark:hover:bg-white/5"
                >
                  {t("settings.profiles.duplicate")}
                </button>
                <button
                  type="button"
                  onClick={handleCreateProfile}
                  className="rounded-lg border border-card-border bg-background px-2.5 py-1.5 text-xs font-medium transition-colors hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent dark:hover:bg-white/5"
                >
                  {t("settings.profiles.new")}
                </button>
              </div>
            </SettingsRow>

            <SettingsRow
              title={t("settings.profiles.config")}
              description={t("settings.app.config.encryptNote")}
            >
              <ConfigTransfer />
            </SettingsRow>
          </SettingsSurface>
            </Tabs.Panel>

            <Tabs.Panel value="provider">
          {/* Provider */}
          <SettingsSurface>
            <SettingsRow
              title={t("settings.provider.provider")}
              description={selectedPreset?.note}
            >
              <SettingsSelect
                value={profile.presetId}
                onChange={handlePresetChange}
                options={providers.map((preset) => ({
                  value: preset.id,
                  label: preset.label,
                }))}
                ariaLabel={t("settings.provider.provider")}
              />
            </SettingsRow>

            <SettingsRowFull
              title={t("settings.provider.baseUrl")}
              description={t("settings.provider.securityNote")}
            >
              <input
                id="baseURL"
                type="url"
                value={profile.baseURL}
                onChange={(e) => handleProfileChange({ baseURL: e.target.value })}
                placeholder="https://api.openai.com/v1"
                className="w-full rounded-lg border border-card-border bg-background px-2.5 py-2 text-[13px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent"
              />
            </SettingsRowFull>

            <SettingsRowFull title={t("settings.provider.apiKey")}>
              <div className="relative">
                <input
                  id="apiKey"
                  type={showKey ? "text" : "password"}
                  value={profile.apiKey}
                  onChange={(e) => handleProfileChange({ apiKey: e.target.value })}
                  placeholder="sk-..."
                  className="w-full rounded-lg border border-card-border bg-background px-2.5 py-2 pr-16 text-[13px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent"
                />
                <button
                  type="button"
                  onClick={() => setShowKey((s) => !s)}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-md px-2 py-1 text-xs text-muted transition-colors hover:bg-black/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent dark:hover:bg-white/5"
                  aria-label={showKey ? t("settings.provider.hide") : t("settings.provider.show")}
                >
                  {showKey ? t("settings.provider.hide") : t("settings.provider.show")}
                </button>
              </div>
            </SettingsRowFull>

            <SettingsRowFull title={t("settings.provider.model")}>
              <input
                id="model"
                type="text"
                value={profile.model}
                onChange={(e) => handleProfileChange({ model: e.target.value })}
                placeholder="gpt-5-mini"
                className="w-full rounded-lg border border-card-border bg-background px-2.5 py-2 text-[13px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent"
              />
            </SettingsRowFull>

            <SettingsRow
              title={
                <span className="inline-flex items-center gap-1">
                  {t("settings.provider.thinking")}
                  <HelpTooltip>{t("settings.provider.thinking.help")}</HelpTooltip>
                </span>
              }
              description={t("settings.provider.thinking.help")}
            >
              <div className="flex flex-col items-end gap-1">
                <SettingsSelect
                  value={profile.thinkingMode ?? "preset"}
                  onChange={(value) =>
                    handleProfileChange({
                      thinkingMode: value as StoredProfile["thinkingMode"],
                    })
                  }
                  options={[
                    { value: "preset", label: t("settings.provider.thinking.preset") },
                    { value: "off", label: t("settings.provider.thinking.off") },
                    { value: "low", label: t("settings.provider.thinking.low") },
                    { value: "medium", label: t("settings.provider.thinking.medium") },
                    { value: "high", label: t("settings.provider.thinking.high") },
                  ]}
                  ariaLabel={t("settings.provider.thinking")}
                />
                <ThinkingNote preset={selectedPreset} mode={profile.thinkingMode} />
              </div>
            </SettingsRow>

            <SettingsRow
              title={t("settings.provider.testConnection")}
              below={
                test.kind === "success" ? (
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="inline-flex items-center gap-1.5 text-success">
                      <CheckIcon className="h-3.5 w-3.5" />
                      {test.reply
                        ? t("settings.provider.reply", { n: test.latencyMs, reply: test.reply })
                        : t("settings.provider.valid", { n: test.latencyMs })}
                    </span>
                    <span className="text-muted">{latencyFlavor(test.latencyMs)}</span>
                  </div>
                ) : test.kind === "error" ? (
                  <span className="inline-flex items-center gap-1.5 text-danger">
                    <AlertIcon className="h-3.5 w-3.5" />
                    {test.message}
                  </span>
                ) : undefined
              }
            >
              <button
                type="button"
                onClick={handleTest}
                disabled={test.kind === "testing"}
                className="inline-flex items-center gap-2 rounded-lg border border-card-border bg-background px-3 py-1.5 text-xs font-medium transition-colors hover:bg-black/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-60 dark:hover:bg-white/[0.03]"
              >
                {test.kind === "testing" && <LoaderIcon className="h-3.5 w-3.5" />}
                {t("settings.provider.testConnection")}
              </button>
            </SettingsRow>
          </SettingsSurface>
            </Tabs.Panel>

            <Tabs.Panel value="app">
          {/* App */}
          <SettingsSurface>
            <SettingsRow title={t("settings.app.appearance")}>
              <div className="flex min-w-0 flex-wrap gap-1 rounded-lg border border-card-border bg-background p-0.5">
                {([
                  { value: "system", label: t("settings.app.theme.system") },
                  { value: "light", label: t("settings.app.theme.light") },
                  { value: "dark", label: t("settings.app.theme.dark") },
                ] as { value: Theme; label: string }[]).map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => updateTheme(option.value)}
                    className={`min-w-0 rounded-md px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                      theme === option.value
                        ? "bg-accent text-white"
                        : "text-muted hover:bg-black/5 dark:hover:bg-white/5"
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </SettingsRow>

            <SettingsRow title={t("settings.app.language")}>
              <div className="flex min-w-0 flex-wrap gap-1 rounded-lg border border-card-border bg-background p-0.5">
                {([
                  { value: "system", label: t("settings.app.language.system") },
                  { value: "zh-CN", label: t("settings.app.language.zhCN") },
                  { value: "en", label: t("settings.app.language.en") },
                ] as { value: UILang; label: string }[]).map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => updateUiLang(option.value)}
                    className={`min-w-0 rounded-md px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                      uiLang === option.value
                        ? "bg-accent text-white"
                        : "text-muted hover:bg-black/5 dark:hover:bg-white/5"
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </SettingsRow>

            <Advanced label={t("settings.app.advanced")}>
              <HotkeyRecorder />
            </Advanced>
          </SettingsSurface>
            </Tabs.Panel>

            <Tabs.Panel value="voice">
              <VoiceSettings />
            </Tabs.Panel>

            <Tabs.Panel value="about">
              <SettingsSurface>
                <SettingsRow title={t("settings.about.version")} description="SubTr">
                  <span className="text-[13px] tabular-nums text-muted">
                    v{APP_VERSION}
                  </span>
                </SettingsRow>
                <SettingsRow
                  title={t("settings.about.platform")}
                  description={t("settings.about.runtime")}
                >
                  <span className="text-[13px] text-muted">{aboutPlatform}</span>
                </SettingsRow>
                <SettingsRowFull title={t("settings.about.runtime")}>
                  <code className="block break-words rounded-lg border border-card-border bg-background px-2.5 py-2 font-mono text-[11px] text-muted">
                    {aboutRuntime}
                  </code>
                </SettingsRowFull>
                <SettingsRow
                  title={t("settings.about.checkUpdates")}
                  below={
                    updateStatus.kind === "upToDate" ? (
                      <span className="text-muted">{t("settings.about.upToDate")}</span>
                    ) : updateStatus.kind === "available" ? (
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="text-success">
                          {t("settings.about.updateAvailable", {
                            version: updateStatus.version,
                          })}
                        </span>
                        <a
                          href={updateStatus.url}
                          target="_blank"
                          rel="noreferrer"
                          className="underline underline-offset-2 hover:text-foreground"
                        >
                          {t("settings.about.openDownload")}
                        </a>
                      </span>
                    ) : updateStatus.kind === "error" ? (
                      <span className="text-muted">{t("settings.about.updateFailed")}</span>
                    ) : undefined
                  }
                >
                  <button
                    type="button"
                    onClick={() => void checkForUpdates()}
                    disabled={updateStatus.kind === "checking"}
                    className="rounded-lg border border-card-border bg-background px-2.5 py-1.5 text-xs font-medium transition-colors hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50 dark:hover:bg-white/5"
                  >
                    {updateStatus.kind === "checking"
                      ? t("settings.about.checking")
                      : t("settings.about.checkUpdates")}
                  </button>
                </SettingsRow>
                <SettingsRowFull title={t("settings.about.dataLocations")}>
                  <div className="space-y-1 font-mono text-[11px] text-muted">
                    <p className="break-words">
                      <span className="text-foreground">{t("settings.about.pluginsDir")}</span>
                      {": "}
                      {plugins.data?.dir ?? "—"}
                    </p>
                    <p className="break-words">
                      <span className="text-foreground">{t("settings.about.whisperDir")}</span>
                      {": "}
                      {voicePaths ? voicePaths.server : `${aboutDataDir}/whisper`}
                      {!voicePaths && (
                        <span className="italic"> ({t("settings.about.pathDefault")})</span>
                      )}
                    </p>
                    {voicePaths && (
                      <p className="break-words">
                        <span className="text-foreground">
                          {t("settings.voice.setupModel")}
                        </span>
                        {": "}
                        {voicePaths.model}
                      </p>
                    )}
                    <p className="break-words">
                      <span className="text-foreground">{t("settings.about.statsFile")}</span>
                      {": "}
                      ~/.subtr/stats.json
                    </p>
                  </div>
                </SettingsRowFull>
                <SettingsRowFull title={t("settings.about.licenses")}>
                  <ul className="list-disc space-y-0.5 pl-4 text-xs text-muted">
                    <li>{t("settings.about.license.ecdict")}</li>
                    <li>{t("settings.about.license.whisper")}</li>
                    <li>{t("settings.about.license.baseui")}</li>
                    <li>{t("settings.about.license.paddle")}</li>
                  </ul>
                </SettingsRowFull>
                <SettingsRowFull title={t("settings.about.links")}>
                  <ul className="space-y-0.5 text-xs">
                    <li>
                      <a
                        href="https://github.com/skywind3000/ECDICT"
                        target="_blank"
                        rel="noreferrer"
                        className="underline underline-offset-2 hover:text-foreground"
                      >
                        ECDICT
                      </a>
                    </li>
                    <li>
                      <a
                        href="https://github.com/ggml-org/whisper.cpp"
                        target="_blank"
                        rel="noreferrer"
                        className="underline underline-offset-2 hover:text-foreground"
                      >
                        whisper.cpp
                      </a>
                    </li>
                    <li>
                      <a
                        href="https://base-ui.com"
                        target="_blank"
                        rel="noreferrer"
                        className="underline underline-offset-2 hover:text-foreground"
                      >
                        Base UI
                      </a>
                    </li>
                    <li>
                      <a
                        href="https://github.com/PaddlePaddle/PaddleOCR"
                        target="_blank"
                        rel="noreferrer"
                        className="underline underline-offset-2 hover:text-foreground"
                      >
                        PaddleOCR
                      </a>
                    </li>
                  </ul>
                </SettingsRowFull>
              </SettingsSurface>
            </Tabs.Panel>

            <Tabs.Panel value="plugins">
          <PluginsSection
            data={plugins.data}
            loading={plugins.loading}
            theme={panelTheme}
            lang={panelLang}
            onToggle={plugins.toggle}
            onRefresh={plugins.refresh}
          />
            </Tabs.Panel>

            <Tabs.Panel value="subtitle">
          {/* Subtitle */}
          <SettingsSurface>
            <SettingsRow
              title={
                <span className="inline-flex items-center gap-1">
                  {t("settings.subtitle.readingPace")}
                  <HelpTooltip>{t("settings.subtitle.readingPace.help")}</HelpTooltip>
                </span>
              }
              description={t("settings.subtitle.readingPace.description")}
            >
              <div className="flex min-w-[15rem] flex-col items-end gap-1.5">
                <div className="flex w-full items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <PaceSlider
                      value={timing.textScale}
                      ariaLabel={t("settings.subtitle.readingPace")}
                      onChange={(v) => updateTiming({ ...timing, textScale: v })}
                    />
                  </div>
                  <span className="w-12 text-right text-xs font-medium tabular-nums">
                    {timing.textScale.toFixed(2)}×
                  </span>
                </div>
                <div className="flex gap-1">
                  {(["slow", "normal", "fast"] as const).map((pace) => (
                    <button
                      key={pace}
                      type="button"
                      onClick={() =>
                        updateTiming({ ...timing, textScale: READING_PACE_SCALE[pace] })
                      }
                      className={`rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                        paceFromScale(timing.textScale) === pace
                          ? "bg-accent text-white"
                          : "text-muted hover:bg-black/5 dark:hover:bg-white/5"
                      }`}
                    >
                      {t(`settings.subtitle.pace.${pace}`)}
                    </button>
                  ))}
                </div>
              </div>
            </SettingsRow>

            <SettingsRow
              title={t("settings.subtitle.initialHold")}
              description={t("settings.subtitle.initialHold.help")}
            >
              <div className="flex items-center gap-1.5">
                <input
                  type="number"
                  min={0}
                  max={30000}
                  step={500}
                  value={timing.initialHoldMs}
                  onChange={(e) => {
                    const n = parseInt(e.target.value, 10);
                    if (!Number.isNaN(n)) {
                      updateTiming({
                        ...timing,
                        initialHoldMs: Math.max(0, Math.min(30000, n)),
                      });
                    }
                  }}
                  className="w-20 rounded-lg border border-card-border bg-background px-2 py-1.5 text-[13px] tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-accent"
                />
                <span className="text-xs text-muted">ms</span>
              </div>
            </SettingsRow>

            <SettingsRow
              title={t("settings.subtitle.minimumDisplay")}
              description={t("settings.subtitle.minimumDisplay.help")}
            >
              <div className="flex items-center gap-1.5">
                <input
                  type="number"
                  min={1000}
                  max={60000}
                  step={1000}
                  value={timing.minDisplayMs}
                  onChange={(e) => {
                    const n = parseInt(e.target.value, 10);
                    if (!Number.isNaN(n)) {
                      updateTiming({
                        ...timing,
                        minDisplayMs: Math.max(1000, Math.min(60000, n)),
                      });
                    }
                  }}
                  className="w-20 rounded-lg border border-card-border bg-background px-2 py-1.5 text-[13px] tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-accent"
                />
                <span className="text-xs text-muted">ms</span>
              </div>
            </SettingsRow>

            <SettingsRow
              title={t("settings.subtitle.finalHold")}
              description={t("settings.subtitle.finalHold.help")}
            >
              <div className="flex items-center gap-1.5">
                <input
                  type="number"
                  min={0}
                  max={10000}
                  step={200}
                  value={timing.finalHoldMs}
                  onChange={(e) => {
                    const n = parseInt(e.target.value, 10);
                    if (!Number.isNaN(n)) {
                      updateTiming({
                        ...timing,
                        finalHoldMs: Math.max(0, Math.min(10000, n)),
                      });
                    }
                  }}
                  className="w-20 rounded-lg border border-card-border bg-background px-2 py-1.5 text-[13px] tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-accent"
                />
                <span className="text-xs text-muted">ms</span>
              </div>
            </SettingsRow>

            <SettingsRow title={t("settings.appearance.font")}>
              <SettingsSelect
                value={style.fontFamily}
                onChange={(value) =>
                  updateStyle({
                    ...style,
                    fontFamily: value as SubtitleStyle["fontFamily"],
                  })
                }
                options={[
                  { value: "system", label: t("settings.appearance.font.system") },
                  { value: "serif", label: t("settings.appearance.font.serif") },
                  { value: "mono", label: t("settings.appearance.font.mono") },
                  { value: "geist", label: t("settings.appearance.font.geist") },
                ]}
                ariaLabel={t("settings.appearance.font")}
              />
            </SettingsRow>

            <SettingsRow title={t("settings.appearance.size")}>
              <div className="flex min-w-[10rem] items-center gap-2">
                <div className="min-w-0 flex-1">
                  <SettingsSlider
                    value={style.fontSizePx}
                    min={12}
                    max={32}
                    aria-label={t("settings.appearance.size")}
                    onChange={(v) => updateStyle({ ...style, fontSizePx: v })}
                  />
                </div>
                <span className="w-10 text-right text-xs text-muted tabular-nums">
                  {style.fontSizePx}px
                </span>
              </div>
            </SettingsRow>

            <SettingsRow title={t("settings.appearance.textColor")}>
              <div className="flex min-w-0 items-center gap-2">
                <input
                  type="color"
                  value={style.textColor}
                  onChange={(e) => updateStyle({ ...style, textColor: e.target.value })}
                  className="h-7 w-7 shrink-0 rounded-md border border-card-border bg-transparent p-0.5"
                />
                <input
                  type="text"
                  value={style.textColor}
                  onChange={(e) => updateStyle({ ...style, textColor: e.target.value })}
                  className="w-24 rounded-lg border border-card-border bg-background px-2 py-1 text-xs outline-none focus-visible:ring-2 focus-visible:ring-accent"
                />
              </div>
            </SettingsRow>

            <SettingsRow title={t("settings.appearance.background")}>
              <div className="flex min-w-0 items-center gap-2">
                <input
                  type="color"
                  value={style.bgColor}
                  onChange={(e) => updateStyle({ ...style, bgColor: e.target.value })}
                  className="h-7 w-7 shrink-0 rounded-md border border-card-border bg-transparent p-0.5"
                />
                <input
                  type="text"
                  value={style.bgColor}
                  onChange={(e) => updateStyle({ ...style, bgColor: e.target.value })}
                  className="w-24 rounded-lg border border-card-border bg-background px-2 py-1 text-xs outline-none focus-visible:ring-2 focus-visible:ring-accent"
                />
              </div>
            </SettingsRow>

            <SettingsRow title={t("settings.appearance.backgroundOpacity")}>
              <div className="flex min-w-[10rem] items-center gap-2">
                <div className="min-w-0 flex-1">
                  <SettingsSlider
                    value={style.bgOpacity}
                    min={0}
                    max={100}
                    aria-label={t("settings.appearance.backgroundOpacity")}
                    onChange={(v) => updateStyle({ ...style, bgOpacity: v })}
                  />
                </div>
                <span className="w-10 text-right text-xs text-muted tabular-nums">
                  {style.bgOpacity}%
                </span>
              </div>
            </SettingsRow>

            <SettingsRowFull title={t("settings.subtitle.position")}>
              <PositionPlayer style={style} timing={timing} onChange={updateStyle} />
            </SettingsRowFull>
          </SettingsSurface>
            </Tabs.Panel>
          </div>
        </main>
      </Tabs.Root>
      </PageFade>
    </div>
  );
}

const noopSubscribe = () => () => {};

function useIsMounted(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false
  );
}

function ThinkingNote({
  preset,
  mode,
}: {
  preset: (typeof PROVIDER_PRESETS)[number] | undefined;
  mode: StoredProfile["thinkingMode"];
}) {
  const mounted = useIsMounted();
  if (!mounted) return null;
  if ((mode ?? "preset") === "preset" || !preset) return null;
  const thinking = (preset as Record<string, unknown>).thinking;
  if (!thinking || typeof thinking !== "object" || thinking === null) return null;
  const note = (thinking as Record<string, unknown>).note;
  if (typeof note !== "string") return null;
  return <p className="text-xs text-muted">{note}</p>;
}
