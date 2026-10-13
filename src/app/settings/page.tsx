"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
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
  fontFamilyCss,
  paceFromScale,
  DEFAULT_SETTINGS_STORE,
  DEFAULT_SUBTITLE_STYLE,
  DEFAULT_SUBTITLE_TIMING,
  toLlmConfig,
  testConnection,
  READING_PACE_SCALE,
  useLocalStorage,
  SETTINGS_KEY,
  SUBTITLE_TIMING_KEY,
  SUBTITLE_STYLE_KEY,
} from "@/lib/client";
import { ArrowLeftIcon, CheckIcon, AlertIcon, LoaderIcon } from "@/components/icons";

type TestStatus =
  | { kind: "idle" }
  | { kind: "testing" }
  | { kind: "success"; latencyMs: number; reply?: string }
  | { kind: "error"; message: string };

function useSettings() {
  const [store, setStore] = useLocalStorage<SettingsStore>(SETTINGS_KEY, DEFAULT_SETTINGS_STORE);
  const [timing, setTiming] = useLocalStorage<SubtitleTiming>(SUBTITLE_TIMING_KEY, DEFAULT_SUBTITLE_TIMING);
  const [style, setStyle] = useLocalStorage<SubtitleStyle>(SUBTITLE_STYLE_KEY, DEFAULT_SUBTITLE_STYLE);

  return { store, timing, style, updateStore: setStore, updateTiming: setTiming, updateStyle: setStyle };
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
  return store.profiles.find((p) => p.id === store.activeProfileId) ?? store.profiles[0];
}

export default function SettingsPage() {
  const { store, timing, style, updateStore, updateTiming, updateStyle } = useSettings();
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
      name: `Profile ${store.profiles.length + 1}`,
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
  }, [store, updateStore]);

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
      setTest({ kind: "error", message: result.error ?? "Connection failed" });
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
            Back
          </Link>
          <h1 className="text-lg font-semibold tracking-tight">Settings</h1>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-10">
        <div className="space-y-6">
          {/* Profiles */}
          <section className="rounded-2xl border border-card-border bg-card p-5 shadow-sm">
            <h2 className="mb-4 text-base font-semibold tracking-tight">Profiles</h2>
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
                            <span className="ml-2 text-xs text-accent">Active</span>
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingName(p.id)}
                          className="rounded-md px-2 py-1 text-xs text-muted transition-colors hover:bg-black/5 hover:text-foreground dark:hover:bg-white/5"
                        >
                          Rename
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteProfile(p.id)}
                          disabled={store.profiles.length <= 1}
                          className="rounded-md px-2 py-1 text-xs text-danger transition-colors hover:bg-danger-soft disabled:opacity-40"
                        >
                          Delete
                        </button>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={handleDuplicateProfile}
                className="rounded-xl border border-card-border bg-background px-3 py-2 text-sm font-medium transition-colors hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent dark:hover:bg-white/5"
              >
                Duplicate current
              </button>
              <button
                type="button"
                onClick={handleCreateProfile}
                className="rounded-xl border border-card-border bg-background px-3 py-2 text-sm font-medium transition-colors hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent dark:hover:bg-white/5"
              >
                New profile
              </button>
            </div>
          </section>

          {/* Provider */}
          <section className="rounded-2xl border border-card-border bg-card p-5 shadow-sm">
            <h2 className="mb-4 text-base font-semibold tracking-tight">Provider</h2>
            <div className="space-y-4">
              <div className="space-y-2">
                <label htmlFor="preset" className="block text-sm font-medium">
                  Provider
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
                  API key
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
                    aria-label={showKey ? "Hide API key" : "Show API key"}
                  >
                    {showKey ? "Hide" : "Show"}
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <label htmlFor="baseURL" className="block text-sm font-medium">
                  Base URL
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
                  Model
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
                  Thinking
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
                  <option value="preset">Preset default</option>
                  <option value="off">Off</option>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
                <p className="text-xs text-muted">
                  Override the provider&apos;s reasoning mode. Preset default follows the selected provider.
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
                  Test connection
                </button>
                {test.kind === "success" && (
                  <span className="inline-flex items-center gap-1.5 text-sm text-success">
                    <CheckIcon className="h-4 w-4" />
                    Valid · {test.latencyMs} ms
                    {test.reply ? ` · ${test.reply}` : null}
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
                Your key is stored locally in this browser and is sent only to your chosen endpoint
                through this app&apos;s own server route.
              </p>
            </div>
          </section>

          {/* Subtitle */}
          <section className="rounded-2xl border border-card-border bg-card p-5 shadow-sm">
            <h2 className="mb-4 text-base font-semibold tracking-tight">Subtitle</h2>

            <div className="space-y-5">
              <div className="space-y-3">
                <h3 className="text-sm font-medium">Timing</h3>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <NumberField
                    label="Initial hold"
                    value={timing.initialHoldMs}
                    onChange={(v) => updateTiming({ ...timing, initialHoldMs: v })}
                    min={0}
                    max={30000}
                    step={500}
                    unit="ms"
                  />
                  <NumberField
                    label="Minimum display"
                    value={timing.minDisplayMs}
                    onChange={(v) => updateTiming({ ...timing, minDisplayMs: v })}
                    min={1000}
                    max={60000}
                    step={1000}
                    unit="ms"
                  />
                  <NumberField
                    label="Final hold"
                    value={timing.finalHoldMs}
                    onChange={(v) => updateTiming({ ...timing, finalHoldMs: v })}
                    min={0}
                    max={10000}
                    step={200}
                    unit="ms"
                  />
                </div>
                <div className="space-y-2">
                  <label className="block text-sm font-medium">Reading pace</label>
                  <div className="flex gap-2">
                    {(["slow", "normal", "fast"] as const).map((pace) => (
                      <button
                        key={pace}
                        type="button"
                        onClick={() =>
                          updateTiming({ ...timing, textScale: READING_PACE_SCALE[pace] })
                        }
                        className={`rounded-lg px-3 py-1.5 text-sm font-medium capitalize transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                          paceFromScale(timing.textScale) === pace
                            ? "bg-accent text-white"
                            : "border border-card-border bg-background hover:bg-black/5 dark:hover:bg-white/5"
                        }`}
                      >
                        {pace}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <h3 className="text-sm font-medium">Position</h3>
                <PositionCanvas style={style} onChange={updateStyle} />
              </div>

              <div className="space-y-3">
                <h3 className="text-sm font-medium">Appearance</h3>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <label htmlFor="fontFamily" className="block text-sm font-medium">
                      Font
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
                      <option value="system">System</option>
                      <option value="serif">Serif</option>
                      <option value="mono">Mono</option>
                      <option value="geist">Geist</option>
                    </select>
                  </div>
                  <RangeField
                    label="Size"
                    value={style.fontSizePx}
                    onChange={(v) => updateStyle({ ...style, fontSizePx: v })}
                    min={12}
                    max={32}
                    unit="px"
                  />
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <ColorField
                    label="Text color"
                    value={style.textColor}
                    onChange={(v) => updateStyle({ ...style, textColor: v })}
                  />
                  <ColorField
                    label="Background"
                    value={style.bgColor}
                    onChange={(v) => updateStyle({ ...style, bgColor: v })}
                  />
                  <RangeField
                    label="Background opacity"
                    value={style.bgOpacity}
                    onChange={(v) => updateStyle({ ...style, bgOpacity: v })}
                    min={0}
                    max={100}
                    unit="%"
                  />
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
  value,
  onChange,
  min,
  max,
  step,
  unit,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step: number;
  unit: string;
}) {
  return (
    <div className="space-y-1.5">
      <label className="block text-sm font-medium">{label}</label>
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
    <div className="space-y-1.5">
      <label className="block text-sm font-medium">{label}</label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-9 w-9 rounded-lg border border-card-border bg-transparent p-0.5"
        />
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="flex-1 rounded-xl border border-card-border bg-background px-3 py-2 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent"
        />
      </div>
    </div>
  );
}

function PositionCanvas({
  style,
  onChange,
}: {
  style: SubtitleStyle;
  onChange: (style: SubtitleStyle) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);

  const updateFromPointer = useCallback(
    (clientX: number, clientY: number) => {
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const xPct = Math.round(
        Math.max(5, Math.min(95, ((clientX - rect.left) / rect.width) * 100))
      );
      const yPct = Math.round(
        Math.max(5, Math.min(95, ((clientY - rect.top) / rect.height) * 100))
      );
      onChange({ ...style, xPct, yPct });
    },
    [style, onChange]
  );

  useEffect(() => {
    function onMove(e: PointerEvent) {
      if (!draggingRef.current) return;
      updateFromPointer(e.clientX, e.clientY);
    }
    function onUp() {
      draggingRef.current = false;
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [updateFromPointer]);

  return (
    <div
      ref={containerRef}
      className="relative h-48 w-full overflow-hidden rounded-xl border border-card-border bg-black/5 dark:bg-white/5"
      onPointerDown={(e) => {
        draggingRef.current = true;
        updateFromPointer(e.clientX, e.clientY);
      }}
      role="application"
      aria-label="Drag to position the subtitle"
    >
      <div
        className="absolute -translate-x-1/2 -translate-y-1/2 cursor-grab rounded-lg px-3 py-1.5 text-xs font-medium shadow-sm active:cursor-grabbing"
        style={{
          left: `${style.xPct}%`,
          top: `${style.yPct}%`,
          backgroundColor: style.bgColor + hexOpacity(style.bgOpacity),
          color: style.textColor,
          fontFamily: fontFamilyCss(style.fontFamily),
          fontSize: Math.max(10, Math.min(16, style.fontSizePx * 0.6)),
        }}
      >
        Subtitle
      </div>
      <p className="absolute bottom-2 left-2 text-[10px] text-muted">
        Drag the box to set position
      </p>
    </div>
  );
}

function hexOpacity(percent: number): string {
  const value = Math.max(0, Math.min(100, Math.round(percent)));
  const alpha = Math.round((value / 100) * 255)
    .toString(16)
    .padStart(2, "0");
  return alpha;
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
