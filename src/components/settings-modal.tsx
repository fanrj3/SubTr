"use client";

import { useEffect, useRef, useState } from "react";
import { PROVIDER_PRESETS } from "@/lib/presets";
import type { PersistedSettings } from "@/lib/client";
import { applyPreset, toLlmConfig, testConnection } from "@/lib/client";
import { isDesktopMode } from "@/lib/client/desktop";
import { XIcon, EyeIcon, EyeOffIcon, CheckIcon, AlertIcon, LoaderIcon } from "./icons";

type TestStatus =
  | { kind: "idle" }
  | { kind: "testing" }
  | { kind: "success"; latencyMs: number; reply?: string }
  | { kind: "error"; message: string };

type SettingsModalProps = {
  settings: PersistedSettings;
  onChange: (settings: PersistedSettings) => void;
  onClose: () => void;
};

const FOCUSABLE = "button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])";

export function SettingsModal({ settings, onChange, onClose }: SettingsModalProps) {
  const [showKey, setShowKey] = useState(false);
  const [test, setTest] = useState<TestStatus>({ kind: "idle" });
  const overlayRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const didFocusRef = useRef(false);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (didFocusRef.current) return;
    const panel = panelRef.current;
    if (!panel) return;
    const first = panel.querySelector<HTMLElement>(FOCUSABLE);
    if (first) {
      first.focus();
      didFocusRef.current = true;
    }
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab") return;

      const currentPanel = panelRef.current;
      if (!currentPanel) return;
      const focusables = Array.from(currentPanel.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (focusables.length === 0) return;
      const firstEl = focusables[0];
      const lastEl = focusables[focusables.length - 1];

      if (e.shiftKey && document.activeElement === firstEl) {
        e.preventDefault();
        lastEl.focus();
      } else if (!e.shiftKey && document.activeElement === lastEl) {
        e.preventDefault();
        firstEl.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (e.target === overlayRef.current) {
        onCloseRef.current();
      }
    }
    const overlay = overlayRef.current;
    overlay?.addEventListener("click", onClick);
    return () => overlay?.removeEventListener("click", onClick);
  }, []);

  function update(patch: Partial<PersistedSettings>) {
    onChange({ ...settings, ...patch });
  }

  function handlePresetChange(presetId: string) {
    onChange(applyPreset(presetId, settings));
  }

  async function handleTest() {
    setTest({ kind: "testing" });
    const result = await testConnection(toLlmConfig(settings));
    if (result.ok) {
      setTest({ kind: "success", latencyMs: result.latencyMs, reply: result.reply });
    } else {
      setTest({ kind: "error", message: result.error ?? "Connection failed" });
    }
  }

  const selectedPreset = PROVIDER_PRESETS.find((p) => p.id === settings.presetId);

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 backdrop-blur-sm sm:items-center"
      role="presentation"
    >
      <div
        ref={panelRef}
        data-subtr-settings
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        className="w-full max-w-lg max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-2xl border border-card-border bg-card shadow-lg"
      >
        <div className="flex items-center justify-between border-b border-card-border px-6 py-4">
          <h2 id="settings-title" className="text-lg font-semibold tracking-tight">
            Settings
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-muted transition-colors hover:bg-black/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent dark:hover:bg-white/5"
            aria-label="Close settings"
          >
            <XIcon className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-5 px-6 py-5">
          <div className="space-y-2">
            <label htmlFor="preset" className="block text-sm font-medium">
              Provider
            </label>
            <select
              id="preset"
              value={settings.presetId}
              onChange={(e) => handlePresetChange(e.target.value)}
              className="w-full rounded-xl border border-card-border bg-background px-3 py-2.5 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent"
            >
              {PROVIDER_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
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
                value={settings.apiKey}
                onChange={(e) => update({ apiKey: e.target.value })}
                placeholder="sk-..."
                className="w-full rounded-xl border border-card-border bg-background px-3 py-2.5 pr-10 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent"
              />
              <button
                type="button"
                onClick={() => setShowKey((s) => !s)}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-muted transition-colors hover:bg-black/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent dark:hover:bg-white/5"
                aria-label={showKey ? "Hide API key" : "Show API key"}
              >
                {showKey ? (
                  <EyeOffIcon className="h-4 w-4" />
                ) : (
                  <EyeIcon className="h-4 w-4" />
                )}
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
              value={settings.baseURL}
              onChange={(e) => update({ baseURL: e.target.value })}
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
              value={settings.model}
              onChange={(e) => update({ model: e.target.value })}
              placeholder="gpt-5-mini"
              className="w-full rounded-xl border border-card-border bg-background px-3 py-2.5 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent"
            />
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
            {isDesktopMode() && (
              <>
                <br />
                On desktop, select text in any app and press ⌘/Ctrl+Shift+D to show the subtitle.
              </>
            )}
          </p>
        </div>
      </div>
    </div>
  );
}
