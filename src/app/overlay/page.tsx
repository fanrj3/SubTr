"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { MAX_SELECTION_CHARS } from "@/lib/types";
import { PROVIDER_PRESETS } from "@/lib/presets";
import {
  readSettings,
  readStorage,
  toLlmConfig,
  streamTranslate,
  resolveTargetLang,
  countWords,
} from "@/lib/client";
import { isDesktopMode } from "@/lib/client/desktop";
import { SubtitleOverlay, type SubtitleState } from "@/components/subtitle-overlay";

const MODE_KEY = "subtr.mode.v1";
const TARGET_LANG_KEY = "subtr.targetLang.v1";
const DEFAULT_TARGET_LANG = "auto";

function readMode(): boolean {
  return readStorage(MODE_KEY, false);
}

function readTargetLang(): string {
  return readStorage(TARGET_LANG_KEY, DEFAULT_TARGET_LANG);
}

function Overlay() {
  const [subtitle, setSubtitle] = useState<SubtitleState>({ kind: "idle" });
  const abortRef = useRef<AbortController | null>(null);
  const searchParams = useSearchParams();

  const dismissSubtitle = useCallback(() => {
    setSubtitle({ kind: "idle" });
  }, []);

  const handleRequestEscArmed = useCallback((armed: boolean) => {
    window.subtrDesktop?.setEscArmed?.(armed);
  }, []);

  const handleRequestInteractive = useCallback((interactive: boolean) => {
    window.subtrDesktop?.setOverlayInteractive?.(interactive);
  }, []);

  const handleCapture = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;

    if (!readMode()) return;

    const original = trimmed.slice(0, 80) + (trimmed.length > 80 ? "…" : "");

    if (trimmed.length > MAX_SELECTION_CHARS) {
      setSubtitle({
        kind: "error",
        original,
        message: `Selection too long · ${trimmed.length}/${MAX_SELECTION_CHARS} characters`,
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
        original,
        message: "Add your API key in Settings",
      });
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const resolvedTargetLang = resolveTargetLang(trimmed, readTargetLang());
    const wordCount = countWords(trimmed);
    const useFastMode =
      (settings.thinkingMode ?? "preset") === "preset" &&
      wordCount <= 20 &&
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

    setSubtitle({ kind: "loading", original });

    streamTranslate(
      trimmed,
      resolvedTargetLang,
      config,
      controller.signal,
      {
        onChunk: (value) => {
          setSubtitle({ kind: "streaming", original, text: value });
        },
        onDone: () => {
          setSubtitle((prev) =>
            prev.kind === "streaming" || prev.kind === "loading"
              ? {
                  kind: "success",
                  original,
                  text: prev.kind === "streaming" ? prev.text : "",
                }
              : prev
          );
        },
        onError: (message) => {
          setSubtitle({ kind: "error", original, message });
        },
      },
      bodyOverrides && Object.keys(bodyOverrides).length > 0
        ? bodyOverrides
        : undefined
    );
  }, []);

  useEffect(() => {
    document.body.style.background = "transparent";
    return () => {
      document.body.style.background = "";
    };
  }, []);

  useEffect(() => {
    if (isDesktopMode()) {
      const bridge = window.subtrDesktop;
      if (!bridge) return;

      const unsubscribe = bridge.onCapture((payload) => {
        handleCapture(payload.text);
      });
      return unsubscribe;
    }

    const text = searchParams.get("text");
    if (!text) return;

    const id = window.setTimeout(() => {
      handleCapture(text);
    }, 0);
    return () => window.clearTimeout(id);
  }, [handleCapture, searchParams]);

  useEffect(() => {
    const bridge = window.subtrDesktop;
    if (!bridge?.onEsc) return;

    const unsubscribe = bridge.onEsc(() => {
      dismissSubtitle();
    });
    return unsubscribe;
  }, [dismissSubtitle]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  return (
    <SubtitleOverlay
      key={subtitle.kind === "idle" ? "idle" : subtitle.original}
      state={subtitle}
      onDismiss={dismissSubtitle}
      onRequestEscArmed={handleRequestEscArmed}
      onRequestInteractive={handleRequestInteractive}
    />
  );
}

export default function OverlayPage() {
  return (
    <Suspense fallback={null}>
      <Overlay />
    </Suspense>
  );
}
