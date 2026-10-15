"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MAX_SELECTION_CHARS } from "@/lib/types";
import { PROVIDER_PRESETS } from "@/lib/presets";
import {
  useLocalStorage,
  useMode,
  useHotkeyBootstrap,
  readSettings,
  toLlmConfig,
  streamTranslate,
  resolveTargetLang,
  countWords,
  useT,
  isSingleLatinWord,
  lookupWord,
} from "@/lib/client";
import { TopBar } from "./top-bar";
import { Reader } from "./reader";
import { SubtitleOverlay, type SubtitleState } from "./subtitle-overlay";
import { StatusBar } from "./status-bar";
import { HomeWidgets } from "./home-widgets";

const TARGET_LANG_KEY = "subtr.targetLang.v1";
const DEFAULT_TARGET_LANG = "auto";

export function SubTrApp() {
  const { t } = useT();
  const [mode, setMode] = useMode();
  useHotkeyBootstrap();
  const [targetLang, setTargetLang] = useLocalStorage(TARGET_LANG_KEY, DEFAULT_TARGET_LANG);
  const [subtitle, setSubtitle] = useState<SubtitleState>({ kind: "idle" });

  const abortRef = useRef<AbortController | null>(null);
  const lastSelectionRef = useRef<string>("");

  const handleModeChange = useCallback(
    (next: boolean) => {
      setMode(next);
      if (!next) {
        setSubtitle({ kind: "idle" });
        lastSelectionRef.current = "";
      }
    },
    [setMode, setSubtitle]
  );

  const handleTargetLangChange = useCallback(
    (lang: string) => {
      setTargetLang(lang);
      lastSelectionRef.current = "";
    },
    [setTargetLang]
  );

  const dismissSubtitle = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setSubtitle({ kind: "idle" });
    lastSelectionRef.current = "";
  }, [setSubtitle]);

  const handleSelect = useCallback(
    async (text: string) => {
      if (!mode) return;

      const trimmed = text.trim();
      if (!trimmed) return;
      if (trimmed === lastSelectionRef.current) return;

      // Single Latin words try the offline dictionary before any API-key check.
      if (isSingleLatinWord(trimmed)) {
        lastSelectionRef.current = trimmed;
        const entry = await lookupWord(trimmed);
        if (entry) {
          abortRef.current?.abort();
          abortRef.current = null;
          setSubtitle({
            kind: "dictionary",
            original: trimmed,
            phonetic: entry.phonetic,
            senses: entry.senses,
          });
          return;
        }
      }

      if (trimmed.length > MAX_SELECTION_CHARS) {
        setSubtitle({
          kind: "error",
          original: trimmed.slice(0, 80) + (trimmed.length > 80 ? "…" : ""),
          message: t("error.selectionTooLong", { n: trimmed.length, max: MAX_SELECTION_CHARS }),
        });
        return;
      }

      const settings = readSettings();
      const config = toLlmConfig(settings);
      const preset = PROVIDER_PRESETS.find((p) => p.id === settings.presetId);
      const needsKey = !config.apiKey && !preset?.keyless;
      if (needsKey) {
        setSubtitle({
          kind: "error",
          original: trimmed.slice(0, 80) + (trimmed.length > 80 ? "…" : ""),
          message: t("error.addApiKey"),
        });
        return;
      }

      lastSelectionRef.current = trimmed;

      if (abortRef.current) {
        abortRef.current.abort();
      }
      abortRef.current = new AbortController();

      const resolvedTargetLang = resolveTargetLang(trimmed, targetLang);
      const wordCount = countWords(trimmed);
      const fastModeLimit = 20; // fast mode threshold no longer stored per-profile in 0.2.1
      const useFastMode =
        (settings.thinkingMode ?? "preset") === "preset" &&
        wordCount <= fastModeLimit &&
        preset?.fastModeParams != null;

      const explicitThinking =
        (settings.thinkingMode ?? "preset") !== "preset" && preset
          ? (preset as Record<string, unknown>).thinking
          : undefined;
      const thinkingOverrides =
        explicitThinking &&
        typeof explicitThinking === "object" &&
        explicitThinking !== null
          ? (explicitThinking as Record<string, unknown>)[settings.thinkingMode!]
          : undefined;

      const bodyOverrides: Record<string, unknown> | undefined =
        thinkingOverrides && typeof thinkingOverrides === "object"
          ? { ...(thinkingOverrides as Record<string, unknown>) }
          : preset?.defaultParams || useFastMode
            ? {
                ...(preset?.defaultParams ?? {}),
                ...(useFastMode ? (preset?.fastModeParams ?? {}) : {}),
              }
            : undefined;

      setSubtitle({ kind: "loading", original: trimmed });

      streamTranslate(
        trimmed,
        resolvedTargetLang,
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
            lastSelectionRef.current = "";
          },
        },
        bodyOverrides && Object.keys(bodyOverrides).length > 0
          ? bodyOverrides
          : undefined
      );
    },
    [mode, targetLang, setSubtitle, t]
  );

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  return (
    <div className="flex min-h-full flex-col pb-9">
      <TopBar
        mode={mode}
        onModeChange={handleModeChange}
        targetLang={targetLang}
        onTargetLangChange={handleTargetLangChange}
      />
      <Reader onSelect={handleSelect} mode={mode} />
      <HomeWidgets />
      <SubtitleOverlay
        key={subtitle.kind === "idle" ? "idle" : subtitle.original}
        state={subtitle}
        onDismiss={dismissSubtitle}
      />
      <StatusBar />
    </div>
  );
}
