"use client";

import { useCallback, useEffect, useState } from "react";
import { useT } from "@/lib/client";
import {
  DEFAULT_HOTKEY,
  SUGGESTED_HOTKEYS,
  acceleratorFromEvent,
  formatAccel,
  keyFromCode,
  modifiersFromEvent,
  readHotkey,
  registerHotkey,
  writeHotkey,
  type HotkeyError,
} from "@/lib/client";

export function HotkeyRecorder() {
  const { t } = useT();
  const [accel, setAccel] = useState(() => readHotkey());
  const [recording, setRecording] = useState(false);
  const [preview, setPreview] = useState("");
  const [error, setError] = useState<{ message: string; suggestions: string[] } | null>(
    null
  );

  function messageFor(code: HotkeyError): string {
    switch (code) {
      case "reserved":
        return t("settings.app.hotkey.error.reserved");
      case "modifier":
        return t("settings.app.hotkey.error.modifier");
      case "noKey":
        return t("settings.app.hotkey.error.noKey");
      default:
        return t("settings.app.hotkey.error.generic");
    }
  }

  // Register the stored hotkey on load so the default works at startup.
  useEffect(() => {
    void registerHotkey(readHotkey());
  }, []);

  const accept = useCallback(
    async (candidate: string) => {
      const result = await registerHotkey(candidate);
      if (result.ok) {
        writeHotkey(candidate);
        setAccel(candidate);
        setError(null);
        setRecording(false);
        setPreview("");
      } else {
        setError({
          message: result.error || t("settings.app.hotkey.error.generic"),
          suggestions: SUGGESTED_HOTKEYS,
        });
      }
    },
    [t]
  );

  useEffect(() => {
    if (!recording) return;

    function onKeyDown(event: KeyboardEvent) {
      event.preventDefault();
      event.stopPropagation();

      if (event.key === "Escape") {
        setRecording(false);
        setPreview("");
        return;
      }

      const key = keyFromCode(event.code);
      const mods = modifiersFromEvent(event);

      if (!key) {
        setPreview(mods.length > 0 ? formatAccel(mods.join("+")) : "");
        return;
      }

      setPreview(formatAccel([...mods, key].join("+")));

      const outcome = acceleratorFromEvent(event);
      if ("error" in outcome) {
        setError({ message: messageFor(outcome.error), suggestions: [] });
        return;
      }

      setError(null);
      void accept(outcome.accel);
    }

    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
    // messageFor is stable enough for this capture-only listener.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recording, accept]);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <label className="block text-sm font-medium">
          {t("settings.app.hotkey")}
          <span className="ml-1 text-xs font-normal text-muted">
            {t("settings.app.hotkey.help")}
          </span>
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex min-w-[8rem] items-center justify-center rounded-xl border border-card-border bg-background px-3 py-2 text-sm font-medium tabular-nums">
          {recording
            ? preview || t("settings.app.hotkey.press")
            : formatAccel(accel)}
        </div>
        <button
          type="button"
          onClick={() => {
            setRecording(true);
            setPreview("");
            setError(null);
          }}
          className="rounded-xl border border-card-border bg-background px-3 py-2 text-sm font-medium shadow-sm transition-colors hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent dark:hover:bg-white/5"
        >
          {recording
            ? t("settings.app.hotkey.recording")
            : t("settings.app.hotkey.record")}
        </button>
        <button
          type="button"
          onClick={() => void accept(DEFAULT_HOTKEY)}
          className="rounded-xl border border-card-border bg-background px-3 py-2 text-sm font-medium transition-colors hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent dark:hover:bg-white/5"
        >
          {t("settings.app.hotkey.reset")}
        </button>
      </div>

      {error && (
        <div className="space-y-1.5 rounded-xl border border-danger/30 bg-danger-soft px-3 py-2 text-xs text-danger">
          <p>{error.message}</p>
          {error.suggestions.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-muted">{t("settings.app.hotkey.suggestions")}</span>
              {error.suggestions.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => void accept(suggestion)}
                  className="rounded-md border border-card-border bg-background px-1.5 py-0.5 font-medium text-foreground transition-colors hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent dark:hover:bg-white/5"
                >
                  {formatAccel(suggestion)}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
