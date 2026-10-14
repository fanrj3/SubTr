"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
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
  type Theme,
  type UILang,
} from "@/lib/client";
import { ArrowLeftIcon, CheckIcon, AlertIcon, LoaderIcon } from "@/components/icons";
import { HelpTooltip } from "@/components/tooltip";
import { PositionPlayer } from "@/components/position-player";

type TestStatus =
  | { kind: "idle" }
  | { kind: "testing" }
  | { kind: "success"; latencyMs: number; reply?: string }
  | { kind: "error"; message: string };

function useThemeSetting(): [Theme, (theme: Theme) => void] {
  const theme = useSyncExternalStore(
    subscribeTheme,
    () => readTheme(),
    () => DEFAULT_THEME
  );

  useEffect(() => {
    applyTheme(theme);
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
  const profile = activeProfile(store);

  const [test, setTest] = useState<TestStatus>({ kind: "idle" });
  const [showKey, setShowKey] = useState(false);
  const [editingName, setEditingName] = useState<string | null>(null);

  const handleProfileChange = useCallback(
    (patch: Partial<StoredProfile>) => {
      updateStore(updateActiveProfile(store, patch));
      setTest({ kind: "idle" });
    },
    [store, updateStore]
  );

  const handlePresetChange = useCallback(
    (presetId: string) => {
      updateStore(updateActiveProfile(store, applyPreset(presetId, profile)));
    },
    [profile, store, updateStore]
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

  const selectedPreset = PROVIDER_PRESETS.find((p) => p.id === profile.presetId);

  return (
    <div className="min-h-full bg-background text-foreground">
      <header className="sticky top-0 z-30 border-b border-card-border bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-[75rem] items-center gap-3 px-4 sm:px-6">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-medium text-muted transition-colors hover:bg-black/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent dark:hover:bg-white/5"
          >
            <ArrowLeftIcon className="h-4 w-4" />
            {t("settings.back")}
          </Link>
          <h1 className="text-lg font-semibold tracking-tight">{t("settings.title")}</h1>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-10">
        <div className="space-y-6">
          {/* Profiles */}
          <section className="rounded-2xl border border-card-border bg-card p-5 shadow-sm">
            <h2 className="mb-4 text-base font-semibold tracking-tight">{t("settings.profiles.title")}</h2>
            <div className="space-y-2">
              {store.profiles.map((p) => {
                const isActive = p.id === store.activeProfileId;
                const isEditing = editingName === p.id;
                return (
                  <div
                    key={p.id}
                    className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 transition-colors ${
                      isActive
                        ? "border-accent/40 bg-accent-dim"
                        : "border-card-border bg-background"
                    }`}
                  >
                    {isEditing ? (
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
                        className="flex-1 rounded-lg border border-card-border bg-background px-2 py-1 text-sm outline-none focus-visible:ring-2 focus-visible:ring-accent"
                      />
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => handleSwitchProfile(p.id)}
                          className="flex-1 text-left text-sm font-medium"
                        >
                          {p.name}
                          {isActive && (
                            <span className="ml-2 text-xs text-accent">{t("settings.profiles.active")}</span>
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingName(p.id)}
                          className="rounded-md px-2 py-1 text-xs text-muted transition-colors hover:bg-black/5 hover:text-foreground dark:hover:bg-white/5"
                        >
                          {t("settings.profiles.rename")}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteProfile(p.id)}
                          disabled={store.profiles.length <= 1}
                          className="rounded-md px-2 py-1 text-xs text-danger transition-colors hover:bg-danger-soft disabled:opacity-40"
                        >
                          {t("settings.profiles.delete")}
                        </button>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={handleDuplicateProfile}
                className="rounded-xl border border-card-border bg-background px-3 py-2 text-sm font-medium transition-colors hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent dark:hover:bg-white/5"
              >
                {t("settings.profiles.duplicate")}
              </button>
              <button
                type="button"
                onClick={handleCreateProfile}
                className="rounded-xl border border-card-border bg-background px-3 py-2 text-sm font-medium transition-colors hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent dark:hover:bg-white/5"
              >
                {t("settings.profiles.new")}
              </button>
            </div>
          </section>

          {/* Provider */}
          <section className="rounded-2xl border border-card-border bg-card p-5 shadow-sm">
            <h2 className="mb-4 text-base font-semibold tracking-tight">{t("settings.provider.title")}</h2>
            <div className="space-y-4">
              <div className="space-y-2">
                <label htmlFor="preset" className="block text-sm font-medium">
                  {t("settings.provider.provider")}
                </label>
                <select
                  id="preset"
                  value={profile.presetId}
                  onChange={(e) => handlePresetChange(e.target.value)}
                  className="w-full rounded-xl border border-card-border bg-background px-3 py-2.5 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent"
                >
                  {PROVIDER_PRESETS.map((preset) => (
                    <option key={preset.id} value={preset.id}>
                      {preset.label}
                    </option>
                  ))}
                </select>
                {selectedPreset?.note && (
                  <p className="text-xs text-muted">{selectedPreset.note}</p>
                )}
              </div>

              <div className="space-y-2">
                <label htmlFor="apiKey" className="block text-sm font-medium">
                  {t("settings.provider.apiKey")}
                </label>
                <div className="relative">
                  <input
                    id="apiKey"
                    type={showKey ? "text" : "password"}
                    value={profile.apiKey}
                    onChange={(e) => handleProfileChange({ apiKey: e.target.value })}
                    placeholder="sk-..."
                    className="w-full rounded-xl border border-card-border bg-background px-3 py-2.5 pr-10 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent"
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey((s) => !s)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-muted transition-colors hover:bg-black/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent dark:hover:bg-white/5"
                    aria-label={showKey ? t("settings.provider.hide") : t("settings.provider.show")}
                  >
                    {showKey ? t("settings.provider.hide") : t("settings.provider.show")}
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <label htmlFor="baseURL" className="block text-sm font-medium">
                  {t("settings.provider.baseUrl")}
                </label>
                <input
                  id="baseURL"
                  type="url"
                  value={profile.baseURL}
                  onChange={(e) => handleProfileChange({ baseURL: e.target.value })}
                  placeholder="https://api.openai.com/v1"
                  className="w-full rounded-xl border border-card-border bg-background px-3 py-2.5 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent"
                />
              </div>

              <div className="space-y-2">
                <label htmlFor="model" className="block text-sm font-medium">
                  {t("settings.provider.model")}
                </label>
                <input
                  id="model"
                  type="text"
                  value={profile.model}
                  onChange={(e) => handleProfileChange({ model: e.target.value })}
                  placeholder="gpt-5-mini"
                  className="w-full rounded-xl border border-card-border bg-background px-3 py-2.5 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent"
                />
              </div>

              <div className="space-y-2">
                <label htmlFor="thinking" className="block text-sm font-medium">
                  {t("settings.provider.thinking")}
                  <HelpTooltip>{t("settings.provider.thinking.help")}</HelpTooltip>
                </label>
                <select
                  id="thinking"
                  value={profile.thinkingMode ?? "preset"}
                  onChange={(e) =>
                    handleProfileChange({
                      thinkingMode: e.target.value as StoredProfile["thinkingMode"],
                    })
                  }
                  className="w-full rounded-xl border border-card-border bg-background px-3 py-2.5 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent"
                >
                  <option value="preset">{t("settings.provider.thinking.preset")}</option>
                  <option value="off">{t("settings.provider.thinking.off")}</option>
                  <option value="low">{t("settings.provider.thinking.low")}</option>
                  <option value="medium">{t("settings.provider.thinking.medium")}</option>
                  <option value="high">{t("settings.provider.thinking.high")}</option>
                </select>
                <p className="text-xs text-muted">
                  {t("settings.provider.thinking.help")}
                </p>
                <ThinkingNote preset={selectedPreset} mode={profile.thinkingMode} />
              </div>

              <div className="flex flex-wrap items-center gap-3 pt-1">
                <button
                  type="button"
                  onClick={handleTest}
                  disabled={test.kind === "testing"}
                  className="inline-flex items-center gap-2 rounded-xl border border-card-border bg-background px-4 py-2 text-sm font-medium transition-colors hover:bg-black/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-60 dark:hover:bg-white/[0.03]"
                >
                  {test.kind === "testing" && <LoaderIcon className="h-4 w-4" />}
                  {t("settings.provider.testConnection")}
                </button>
                {test.kind === "success" && (
                  <span className="inline-flex items-center gap-1.5 text-sm text-success">
                    <CheckIcon className="h-4 w-4" />
                    {test.reply
                      ? t("settings.provider.reply", { n: test.latencyMs, reply: test.reply })
                      : t("settings.provider.valid", { n: test.latencyMs })}
                  </span>
                )}
                {test.kind === "error" && (
                  <span className="inline-flex items-center gap-1.5 text-sm text-danger">
                    <AlertIcon className="h-4 w-4" />
                    {test.message}
                  </span>
                )}
              </div>

              <p className="text-xs leading-relaxed text-muted">
                {t("settings.provider.securityNote")}
              </p>
            </div>
          </section>

          {/* App */}
          <section className="rounded-2xl border border-card-border bg-card p-5 shadow-sm">
            <h2 className="mb-4 text-base font-semibold tracking-tight">{t("settings.app.title")}</h2>
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="block text-sm font-medium">{t("settings.app.appearance")}</label>
                <div className="flex flex-wrap gap-2 rounded-xl border border-card-border bg-background p-1">
                  {([
                    { value: "system", label: t("settings.app.theme.system") },
                    { value: "light", label: t("settings.app.theme.light") },
                    { value: "dark", label: t("settings.app.theme.dark") },
                  ] as { value: Theme; label: string }[]).map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => updateTheme(option.value)}
                      className={`flex-1 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                        theme === option.value
                          ? "bg-accent text-white"
                          : "hover:bg-black/5 dark:hover:bg-white/5"
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <label className="block text-sm font-medium">{t("settings.app.language")}</label>
                <div className="flex flex-wrap gap-2 rounded-xl border border-card-border bg-background p-1">
                  {([
                    { value: "system", label: t("settings.app.language.system") },
                    { value: "zh-CN", label: t("settings.app.language.zhCN") },
                    { value: "en", label: t("settings.app.language.en") },
                  ] as { value: UILang; label: string }[]).map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => updateUiLang(option.value)}
                      className={`flex-1 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                        uiLang === option.value
                          ? "bg-accent text-white"
                          : "hover:bg-black/5 dark:hover:bg-white/5"
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </section>

          {/* Subtitle */}
          <section className="rounded-2xl border border-card-border bg-card p-5 shadow-sm">
            <h2 className="mb-4 text-base font-semibold tracking-tight">{t("settings.subtitle.title")}</h2>

            <div className="space-y-5">
              <div className="space-y-4">
                <h3 className="text-sm font-medium">{t("settings.subtitle.timing")}</h3>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <NumberField
                    label={t("settings.subtitle.initialHold")}
                    hint={t("settings.subtitle.initialHold.help")}
                    value={timing.initialHoldMs}
                    onChange={(v) => updateTiming({ ...timing, initialHoldMs: v })}
                    min={0}
                    max={30000}
                    step={500}
                    unit="ms"
                  />
                  <NumberField
                    label={t("settings.subtitle.minimumDisplay")}
                    hint={t("settings.subtitle.minimumDisplay.help")}
                    value={timing.minDisplayMs}
                    onChange={(v) => updateTiming({ ...timing, minDisplayMs: v })}
                    min={1000}
                    max={60000}
                    step={1000}
                    unit="ms"
                  />
                  <NumberField
                    label={t("settings.subtitle.finalHold")}
                    hint={t("settings.subtitle.finalHold.help")}
                    value={timing.finalHoldMs}
                    onChange={(v) => updateTiming({ ...timing, finalHoldMs: v })}
                    min={0}
                    max={10000}
                    step={200}
                    unit="ms"
                  />
                </div>
                <div className="space-y-2">
                  <label className="block text-sm font-medium">
                    {t("settings.subtitle.readingPace")}
                    <HelpTooltip>{t("settings.subtitle.readingPace.help")}</HelpTooltip>
                  </label>
                  <div className="flex flex-col gap-3 rounded-xl border border-card-border bg-background p-3 sm:flex-row sm:items-center">
                    <input
                      type="range"
                      min={0.2}
                      max={5}
                      step={0.05}
                      value={timing.textScale}
                      onChange={(e) =>
                        updateTiming({ ...timing, textScale: parseFloat(e.target.value) })
                      }
                      className="flex-1 accent-accent"
                    />
                    <span className="w-16 text-center text-sm font-medium tabular-nums">
                      {timing.textScale.toFixed(2)}×
                    </span>
                    <div className="flex gap-2">
                      {(["slow", "normal", "fast"] as const).map((pace) => (
                        <button
                          key={pace}
                          type="button"
                          onClick={() =>
                            updateTiming({ ...timing, textScale: READING_PACE_SCALE[pace] })
                          }
                          className={`rounded-lg px-2.5 py-1 text-xs font-medium capitalize transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                            paceFromScale(timing.textScale) === pace
                              ? "bg-accent text-white"
                              : "border border-card-border bg-background hover:bg-black/5 dark:hover:bg-white/5"
                          }`}
                        >
                          {t(`settings.subtitle.pace.${pace}`)}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <h3 className="text-sm font-medium">{t("settings.subtitle.position")}</h3>
                <PositionPlayer style={style} timing={timing} onChange={updateStyle} />
              </div>

              <div className="space-y-3">
                <h3 className="text-sm font-medium">{t("settings.appearance.title")}</h3>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div className="min-w-0 space-y-2">
                    <label htmlFor="fontFamily" className="block text-sm font-medium">
                      {t("settings.appearance.font")}
                    </label>
                    <select
                      id="fontFamily"
                      value={style.fontFamily}
                      onChange={(e) =>
                        updateStyle({
                          ...style,
                          fontFamily: e.target.value as SubtitleStyle["fontFamily"],
                        })
                      }
                      className="w-full rounded-xl border border-card-border bg-background px-3 py-2.5 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent"
                    >
                      <option value="system">{t("settings.appearance.font.system")}</option>
                      <option value="serif">{t("settings.appearance.font.serif")}</option>
                      <option value="mono">{t("settings.appearance.font.mono")}</option>
                      <option value="geist">{t("settings.appearance.font.geist")}</option>
                    </select>
                  </div>
                  <RangeField
                    label={t("settings.appearance.size")}
                    value={style.fontSizePx}
                    onChange={(v) => updateStyle({ ...style, fontSizePx: v })}
                    min={12}
                    max={32}
                    unit="px"
                  />
                </div>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                  <div className="min-w-0">
                    <ColorField
                      label={t("settings.appearance.textColor")}
                      value={style.textColor}
                      onChange={(v) => updateStyle({ ...style, textColor: v })}
                    />
                  </div>
                  <div className="min-w-0">
                    <ColorField
                      label={t("settings.appearance.background")}
                      value={style.bgColor}
                      onChange={(v) => updateStyle({ ...style, bgColor: v })}
                    />
                  </div>
                  <div className="min-w-0">
                    <RangeField
                      label={t("settings.appearance.backgroundOpacity")}
                      value={style.bgOpacity}
                      onChange={(v) => updateStyle({ ...style, bgOpacity: v })}
                      min={0}
                      max={100}
                      unit="%"
                    />
                  </div>
                </div>
              </div>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}

function NumberField({
  label,
  hint,
  value,
  onChange,
  min,
  max,
  step,
  unit,
}: {
  label: string;
  hint?: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step: number;
  unit: string;
}) {
  return (
    <div className="space-y-1.5">
      <label className="block text-sm font-medium">
        {label}
        {hint && <HelpTooltip>{hint}</HelpTooltip>}
      </label>
      <div className="flex items-center gap-2">
        <input
          type="number"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => {
            const n = parseInt(e.target.value, 10);
            onChange(Number.isNaN(n) ? value : Math.max(min, Math.min(max, n)));
          }}
          className="w-full rounded-xl border border-card-border bg-background px-3 py-2 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent"
        />
        <span className="text-xs text-muted">{unit}</span>
      </div>
    </div>
  );
}

function RangeField({
  label,
  value,
  onChange,
  min,
  max,
  unit,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  unit: string;
}) {
  return (
    <div className="space-y-1.5">
      <label className="block text-sm font-medium">{label}</label>
      <div className="flex items-center gap-3">
        <input
          type="range"
          min={min}
          max={max}
          value={value}
          onChange={(e) => onChange(parseInt(e.target.value, 10))}
          className="flex-1 accent-accent"
        />
        <span className="w-12 text-right text-sm text-muted">
          {value}
          {unit}
        </span>
      </div>
    </div>
  );
}

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="min-w-0 space-y-1.5">
      <label className="block text-sm font-medium">{label}</label>
      <div className="flex min-w-0 items-center gap-2">
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-9 w-9 shrink-0 rounded-lg border border-card-border bg-transparent p-0.5"
        />
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="min-w-0 flex-1 rounded-xl border border-card-border bg-background px-3 py-2 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent"
        />
      </div>
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
