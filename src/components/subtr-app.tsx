"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MAX_SELECTION_CHARS } from "@/lib/types";
import { PROVIDER_PRESETS } from "@/lib/presets";
import type { PersistedSettings } from "@/lib/client";
import {
  useLocalStorage,
  readSettings,
  toLlmConfig,
  streamTranslate,
} from "@/lib/client";
import { TopBar } from "./top-bar";
import { Reader } from "./reader";
import { SubtitleOverlay, type SubtitleState } from "./subtitle-overlay";
import { SettingsModal } from "./settings-modal";

const MODE_KEY = "subtr.mode.v1";
const TARGET_LANG_KEY = "subtr.targetLang.v1";
const DEFAULT_TARGET_LANG = "English";

export function SubTrApp() {
  const [mode, setMode] = useLocalStorage(MODE_KEY, false);
  const [targetLang, setTargetLang] = useLocalStorage(TARGET_LANG_KEY, DEFAULT_TARGET_LANG);
  const [settings, setSettings] = useLocalStorage<PersistedSettings>(
    "subtr.settings.v1",
    readSettings()
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [subtitle, setSubtitle] = useState<SubtitleState>({ kind: "idle" });

  const abortRef = useRef<AbortController | null>(null);
  const lastSelectionRef = useRef<string>("");

  const handleModeChange = useCallback(
    (next: boolean) => {
      setMode(next);
      if (!next) {
        setSubtitle({ kind: "idle" });
      }
    },
    [setMode, setSubtitle]
  );

  const handleTargetLangChange = useCallback(
    (lang: string) => {
      setTargetLang(lang);
    },
    [setTargetLang]
  );

  const handleSettingsChange = useCallback(
    (next: PersistedSettings) => {
      setSettings(next);
    },
    [setSettings]
  );

  const dismissSubtitle = useCallback(() => {
    setSubtitle({ kind: "idle" });
    lastSelectionRef.current = "";
  }, [setSubtitle]);

  const handleSelect = useCallback(
    (text: string) => {
      if (!mode) return;

      const trimmed = text.trim();
      if (!trimmed) return;
      if (trimmed === lastSelectionRef.current) return;
      lastSelectionRef.current = trimmed;

      if (trimmed.length > MAX_SELECTION_CHARS) {
        setSubtitle({
          kind: "error",
          original: trimmed.slice(0, 80) + (trimmed.length > 80 ? "…" : ""),
          message: `Selection too long · ${trimmed.length}/${MAX_SELECTION_CHARS} characters`,
        });
        return;
      }

      const config = toLlmConfig(settings);
      const preset = PROVIDER_PRESETS.find((p) => p.id === settings.presetId);
      const needsKey = !config.apiKey && !preset?.keyless;
      if (needsKey) {
        setSubtitle({
          kind: "error",
          original: trimmed.slice(0, 80) + (trimmed.length > 80 ? "…" : ""),
          message: "Add your API key in Settings",
        });
        return;
      }

      if (abortRef.current) {
        abortRef.current.abort();
      }
      abortRef.current = new AbortController();

      setSubtitle({ kind: "loading", original: trimmed });

      streamTranslate(
        trimmed,
        targetLang,
        config,
        abortRef.current.signal,
        {
          onChunk: (value) => {
            setSubtitle({ kind: "streaming", original: trimmed, text: value });
          },
          onDone: () => {
            setSubtitle((prev) =>
              prev.kind === "streaming" || prev.kind === "loading"
                ? {
                    kind: "success",
                    original: trimmed,
                    text: prev.kind === "streaming" ? prev.text : "",
                  }
                : prev
            );
          },
          onError: (message) => {
            setSubtitle({ kind: "error", original: trimmed, message });
          },
        }
      );
    },
    [mode, settings, targetLang, setSubtitle]
  );

  const handleOpenSettings = useCallback(() => {
    setSettingsOpen(true);
  }, []);

  const handleCloseSettings = useCallback(() => {
    setSettingsOpen(false);
  }, []);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  return (
    <div className="flex min-h-full flex-col">
      <TopBar
        mode={mode}
        onModeChange={handleModeChange}
        targetLang={targetLang}
        onTargetLangChange={handleTargetLangChange}
        onOpenSettings={handleOpenSettings}
      />
      <Reader onSelect={handleSelect} />
      <SubtitleOverlay state={subtitle} onDismiss={dismissSubtitle} />
      {settingsOpen && (
        <SettingsModal
          settings={settings}
          onChange={handleSettingsChange}
          onClose={handleCloseSettings}
        />
      )}
    </div>
  );
}
