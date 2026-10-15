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
  useT,
  useModeState,
  isSingleLatinWord,
  lookupWord,
  computeTimeline,
  readSubtitleTiming,
  readSubtitleStyle,
  writeSubtitleStyle,
} from "@/lib/client";
import { isDesktopMode } from "@/lib/client/desktop";
import {
  SubtitleOverlay,
  type SubtitleState,
  type VoiceLine,
} from "@/components/subtitle-overlay";

const TARGET_LANG_KEY = "subtr.targetLang.v1";
const DEFAULT_TARGET_LANG = "auto";
const REPORT_INTERVAL_MS = 200;
const VOICE_STOP_MS = 200;
const VOICE_MAX_LINES = 4;
const VOICE_CHUNK_THROTTLE_MS = 150;
const VOICE_TENTATIVE_MS = 2000;
const VOICE_TENTATIVE_MIN_CHARS = 20;
const PLUGIN_STOP_MS = 200;

type TestState = {
  playing: boolean;
  timeMs: number;
  totalMs: number;
  text: string;
  confirmed: boolean;
};

type PreparedTranslation = {
  config: ReturnType<typeof toLlmConfig>;
  targetLang: string;
  bodyOverrides?: Record<string, unknown>;
};

function readTargetLang(): string {
  return readStorage(TARGET_LANG_KEY, DEFAULT_TARGET_LANG);
}

function Overlay() {
  const { t } = useT();
  const mode = useModeState();
  const [subtitle, setSubtitle] = useState<SubtitleState>({ kind: "idle" });
  const [test, setTest] = useState<TestState | null>(null);
  const [voiceActive, setVoiceActive] = useState(false);
  const [voiceLines, setVoiceLines] = useState<VoiceLine[]>([]);
  const [voiceStopping, setVoiceStopping] = useState(false);
  const testRef = useRef<TestState | null>(null);
  const linesRef = useRef<VoiceLine[]>([]);
  const voiceSeqRef = useRef(0);
  const debounceRef = useRef<number | null>(null);
  const voiceControllerRef = useRef<AbortController | null>(null);
  const lineReqRef = useRef<Map<string, number>>(new Map());
  const reqSeqRef = useRef(0);
  const activeUtteranceRef = useRef<string | null>(null);
  const lastTentativeAtRef = useRef(0);
  const lastTentativeLenRef = useRef(0);
  const stopTimerRef = useRef<number | null>(null);
  const wasPlayingRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const searchParams = useSearchParams();

  useEffect(() => {
    testRef.current = test;
  }, [test]);

  const report = useCallback((state: TestState) => {
    window.subtrDesktop?.reportTestPlayState?.({
      playing: state.playing,
      timeMs: state.timeMs,
      totalMs: state.totalMs,
    });
  }, []);

  const commitLines = useCallback((next: VoiceLine[]) => {
    linesRef.current = next;
    setVoiceLines(next);
  }, []);

  const applyLineText = useCallback(
    (id: string, text: string) => {
      commitLines(linesRef.current.map((line) => (line.id === id ? { ...line, text } : line)));
    },
    [commitLines]
  );

  const [pluginText, setPluginText] = useState<{
    text: string;
    tone: "normal" | "muted";
  } | null>(null);
  const [pluginStopping, setPluginStopping] = useState(false);
  const pluginTimerRef = useRef<number | null>(null);
  const pluginStopTimerRef = useRef<number | null>(null);
  const pluginStopPendingRef = useRef(false);

  const clearPluginText = useCallback(() => {
    if (pluginTimerRef.current) {
      window.clearTimeout(pluginTimerRef.current);
      pluginTimerRef.current = null;
    }
    pluginStopPendingRef.current = true;
    setPluginStopping(true);
    if (pluginStopTimerRef.current) window.clearTimeout(pluginStopTimerRef.current);
    pluginStopTimerRef.current = window.setTimeout(() => {
      pluginStopTimerRef.current = null;
      // Keep `pluginStopping` true for this idle transition so the overlay
      // takes the plugin hard-cut (no re-created fade, no fallback flash).
      setPluginText(null);
      setSubtitle({ kind: "idle" });
    }, PLUGIN_STOP_MS);
  }, []);

  // Plugin teardown: drop the stopping flag only after the idle render removed
  // the card (never in the same batch).
  useEffect(() => {
    if (pluginStopPendingRef.current && subtitle.kind === "idle") {
      pluginStopPendingRef.current = false;
      setPluginStopping(false);
    }
  }, [subtitle.kind]);

  const resetVoiceForPlugin = useCallback(() => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = null;
    voiceControllerRef.current?.abort();
    voiceControllerRef.current = null;
    lineReqRef.current.clear();
    activeUtteranceRef.current = null;
    commitLines([]);
    setVoiceActive(false);
  }, [commitLines]);

  const showPluginText = useCallback(
    (text: string, tone: "normal" | "muted", stickyMs?: number) => {
      resetVoiceForPlugin();
      if (pluginStopTimerRef.current) {
        window.clearTimeout(pluginStopTimerRef.current);
        pluginStopTimerRef.current = null;
      }
      pluginStopPendingRef.current = false;
      setPluginStopping(false);
      setPluginText({ text, tone });
      setSubtitle({ kind: "success", original: "", text: "" });
      if (pluginTimerRef.current) window.clearTimeout(pluginTimerRef.current);
      if (typeof stickyMs === "number" && stickyMs > 0) {
        pluginTimerRef.current = window.setTimeout(() => {
          pluginTimerRef.current = null;
          clearPluginText();
        }, stickyMs);
      }
    },
    [resetVoiceForPlugin, clearPluginText]
  );

  const dismissSubtitle = useCallback(() => {
    // Voice mode: local fade only — voice stays on, so the next payload reopens.
    if (voiceActive || linesRef.current.length > 0) {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
      debounceRef.current = null;
      voiceControllerRef.current?.abort();
      voiceControllerRef.current = null;
      setVoiceStopping(true);
      if (stopTimerRef.current) window.clearTimeout(stopTimerRef.current);
      stopTimerRef.current = window.setTimeout(() => {
        stopTimerRef.current = null;
        setVoiceStopping(false);
        commitLines([]);
        setSubtitle({ kind: "idle" });
      }, VOICE_STOP_MS);
      return;
    }
    abortRef.current?.abort();
    abortRef.current = null;
    testRef.current = null;
    setTest(null);
    setSubtitle({ kind: "idle" });
  }, [voiceActive, commitLines]);

  const voiceStopPendingRef = useRef(false);

  const stopVoice = useCallback(() => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = null;
    voiceControllerRef.current?.abort();
    voiceControllerRef.current = null;
    voiceStopPendingRef.current = true;
    setVoiceStopping(true);
    if (stopTimerRef.current) window.clearTimeout(stopTimerRef.current);
    stopTimerRef.current = window.setTimeout(() => {
      stopTimerRef.current = null;
      // Keep `voiceActive` true for this idle transition so the overlay takes
      // the voice hard-cut (no re-created fade, no fallback flash). It is
      // cleared in the effect below, after the card has been removed.
      setVoiceStopping(false);
      commitLines([]);
      setSubtitle({ kind: "idle" });
    }, VOICE_STOP_MS);
  }, [commitLines]);

  // Stop teardown: drop the voice flag only after the idle render has removed
  // the card (never in the same batch).
  useEffect(() => {
    if (voiceStopPendingRef.current && subtitle.kind === "idle") {
      voiceStopPendingRef.current = false;
      setVoiceActive(false);
    }
  }, [subtitle.kind, voiceActive]);

  const handleRequestEscArmed = useCallback((armed: boolean) => {
    window.subtrDesktop?.setEscArmed?.(armed);
  }, []);

  const handleRequestInteractive = useCallback((interactive: boolean) => {
    window.subtrDesktop?.setOverlayInteractive?.(interactive);
  }, []);

  const prepareTranslation = useCallback((trimmed: string): PreparedTranslation | null => {
    const settings = readSettings();
    const config = toLlmConfig(settings);
    const preset = PROVIDER_PRESETS.find((p) => p.id === settings.presetId);
    const needsKey = !config.apiKey && !preset?.keyless;
    if (needsKey) return null;

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

    return {
      config,
      targetLang: resolveTargetLang(trimmed, readTargetLang()),
      bodyOverrides,
    };
  }, []);

  /** Translate one line; stream chunks into it (throttled) with a per-line seq guard. */
  const translateLine = useCallback(
    (lineId: string, source: string) => {
      const prepared = prepareTranslation(source);
      if (!prepared) return; // keep the line's current text
      voiceControllerRef.current?.abort();
      const controller = new AbortController();
      voiceControllerRef.current = controller;
      const reqSeq = ++reqSeqRef.current;
      lineReqRef.current.set(lineId, reqSeq);
      let buffer = "";
      let lastFlush = 0;

      streamTranslate(
        source,
        prepared.targetLang,
        prepared.config,
        controller.signal,
        {
          onChunk: (value) => {
            buffer = value;
            const now = performance.now();
            if (now - lastFlush >= VOICE_CHUNK_THROTTLE_MS) {
              lastFlush = now;
              if (lineReqRef.current.get(lineId) === reqSeq) {
                applyLineText(lineId, buffer);
              }
            }
          },
          onDone: () => {
            if (lineReqRef.current.get(lineId) !== reqSeq) return; // stale
            applyLineText(lineId, buffer.trim() || source);
          },
          onError: () => {
            // Keep the line's current text.
          },
        },
        prepared.bodyOverrides && Object.keys(prepared.bodyOverrides).length > 0
          ? prepared.bodyOverrides
          : undefined
      );
    },
    [prepareTranslation, applyLineText]
  );

  const handleVoicePayload = useCallback(
    (
      text: string,
      utteranceId: string | undefined,
      close: boolean,
      stop: boolean
    ) => {
      if (stop) {
        stopVoice();
        return;
      }
      // A payload during/after a stop cancels the teardown and reopens.
      voiceStopPendingRef.current = false;
      if (stopTimerRef.current) {
        window.clearTimeout(stopTimerRef.current);
        stopTimerRef.current = null;
      }
      setVoiceStopping(false);

      // Newest wins: a voice payload replaces any plugin text.
      if (pluginText) {
        if (pluginTimerRef.current) window.clearTimeout(pluginTimerRef.current);
        pluginTimerRef.current = null;
        if (pluginStopTimerRef.current) window.clearTimeout(pluginStopTimerRef.current);
        pluginStopTimerRef.current = null;
        pluginStopPendingRef.current = false;
        setPluginStopping(false);
        setPluginText(null);
      }

      const trimmed = text.trim();
      const lines = linesRef.current;
      const live = lines[lines.length - 1];
      const newUtterance =
        !live || live.final || (utteranceId ? utteranceId !== activeUtteranceRef.current : false);

      if (newUtterance) {
        if (!trimmed) return;
        const id = `v${++voiceSeqRef.current}`;
        activeUtteranceRef.current = utteranceId ?? id;
        lastTentativeAtRef.current = 0;
        lastTentativeLenRef.current = 0;
        commitLines(
          [...lines, { id, source: trimmed, text: "", final: false }].slice(-VOICE_MAX_LINES)
        );
        setVoiceActive(true);
        setSubtitle({ kind: "success", original: "", text: "" });
        if (trimmed.length >= VOICE_TENTATIVE_MIN_CHARS) {
          lastTentativeAtRef.current = performance.now();
          lastTentativeLenRef.current = trimmed.length;
          translateLine(id, trimmed);
        }
        return;
      }

      // Monotonic, append-only source within the utterance.
      const monotonic = trimmed.length > live.source.length ? trimmed : live.source;

      if (close) {
        commitLines(
          lines.map((line, index) =>
            index === lines.length - 1 ? { ...line, source: monotonic, final: true } : line
          )
        );
        activeUtteranceRef.current = null;
        setVoiceActive(true);
        setSubtitle({ kind: "success", original: "", text: "" });
        translateLine(live.id, monotonic); // final, frozen
        return;
      }

      if (monotonic.length <= live.source.length) {
        // Regressive or reworded payload: ignore so display stays stable.
        return;
      }

      commitLines(
        lines.map((line, index) =>
          index === lines.length - 1 ? { ...line, source: monotonic } : line
        )
      );
      setVoiceActive(true);
      setSubtitle({ kind: "success", original: "", text: "" });

      const now = performance.now();
      if (
        monotonic.length - lastTentativeLenRef.current >= VOICE_TENTATIVE_MIN_CHARS &&
        now - lastTentativeAtRef.current >= VOICE_TENTATIVE_MS
      ) {
        lastTentativeAtRef.current = now;
        lastTentativeLenRef.current = monotonic.length;
        translateLine(live.id, monotonic);
      }
    },
    [commitLines, translateLine, stopVoice, pluginText]
  );

  const handleCapture = useCallback(
    async (
      text: string,
      source?: string,
      voice?: boolean,
      voiceOpts?: { utteranceId?: string; close?: boolean; stop?: boolean },
      pluginOpts?: {
        pluginText?: boolean;
        tone?: "normal" | "muted";
        stickyMs?: number;
        clear?: boolean;
      }
    ) => {
      if (pluginOpts?.clear) {
        clearPluginText();
        return;
      }
      if (pluginOpts?.pluginText) {
        const trimmedPlugin = text.trim();
        if (trimmedPlugin) {
          showPluginText(
            trimmedPlugin,
            pluginOpts.tone === "muted" ? "muted" : "normal",
            pluginOpts.stickyMs
          );
        }
        return;
      }

      if (voice) {
        handleVoicePayload(
          text,
          voiceOpts?.utteranceId,
          !!voiceOpts?.close,
          !!voiceOpts?.stop
        );
        return;
      }

      const trimmed = text.trim();
      if (!trimmed) return;

      // Any non-voice capture leaves voice/plugin mode cleanly.
      if (voiceActive || linesRef.current.length > 0) {
        if (debounceRef.current) window.clearTimeout(debounceRef.current);
        debounceRef.current = null;
        voiceControllerRef.current?.abort();
        voiceControllerRef.current = null;
        lineReqRef.current.clear();
        activeUtteranceRef.current = null;
        commitLines([]);
        setVoiceActive(false);
      }
      if (pluginText || pluginStopping) {
        if (pluginTimerRef.current) window.clearTimeout(pluginTimerRef.current);
        pluginTimerRef.current = null;
        if (pluginStopTimerRef.current) window.clearTimeout(pluginStopTimerRef.current);
        pluginStopTimerRef.current = null;
        pluginStopPendingRef.current = false;
        setPluginStopping(false);
        setPluginText(null);
      }

      const isTest = source === "test";
      if (!isTest && !mode) return;

      const original = trimmed.slice(0, 80) + (trimmed.length > 80 ? "…" : "");

      if (isTest) {
        const timing = readSubtitleTiming();
        const timeline = computeTimeline(trimmed, timing);
        const initial: TestState = {
          playing: true,
          timeMs: 0,
          totalMs: timeline.totalMs,
          text: trimmed,
          confirmed: false,
        };
        testRef.current = initial;
        setTest(initial);
        setSubtitle({ kind: "success", original, text: trimmed });
        report(initial);
        return;
      }

      // Single Latin words try the offline dictionary before any API-key check.
      if (isSingleLatinWord(trimmed)) {
        const entry = await lookupWord(trimmed);
        if (entry) {
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
          original,
          message: t("error.selectionTooLong", { n: trimmed.length, max: MAX_SELECTION_CHARS }),
        });
        return;
      }

      const prepared = prepareTranslation(trimmed);
      if (!prepared) {
        setSubtitle({
          kind: "error",
          original,
          message: t("error.addApiKey"),
        });
        return;
      }

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setSubtitle({ kind: "loading", original });

      streamTranslate(
        trimmed,
        prepared.targetLang,
        prepared.config,
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
        prepared.bodyOverrides && Object.keys(prepared.bodyOverrides).length > 0
          ? prepared.bodyOverrides
          : undefined
      );
    },
    [
      t,
      mode,
      report,
      handleVoicePayload,
      prepareTranslation,
      voiceActive,
      commitLines,
      clearPluginText,
      showPluginText,
      pluginText,
      pluginStopping,
    ]
  );

  // Test playback clock.
  useEffect(() => {
    if (!test?.playing) return;
    let raf = 0;
    let last = performance.now();
    let lastReport = 0;

    function step(now: number) {
      const delta = now - last;
      last = now;
      const current = testRef.current;
      if (!current || !current.playing) return;

      const nextTime = Math.min(current.totalMs, current.timeMs + delta);

      if (now - lastReport >= REPORT_INTERVAL_MS) {
        lastReport = now;
        window.subtrDesktop?.reportTestPlayState?.({
          playing: true,
          timeMs: nextTime,
          totalMs: current.totalMs,
        });
      }

      if (nextTime >= current.totalMs) {
        window.subtrDesktop?.reportTestPlayState?.({
          playing: false,
          timeMs: current.totalMs,
          totalMs: current.totalMs,
        });
        testRef.current = null;
        setTest(null);
        setSubtitle({ kind: "idle" });
        return;
      }

      const updated = { ...current, timeMs: nextTime };
      testRef.current = updated;
      setTest(updated);
      raf = requestAnimationFrame(step);
    }

    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [test?.playing]);

  // Control channel from the settings window.
  useEffect(() => {
    const bridge = window.subtrDesktop;
    if (!bridge?.onTestPlayControl) return;
    return bridge.onTestPlayControl((payload) => {
      const current = testRef.current;
      if (!current) return;

      if (payload.action === "play") {
        const timeMs = current.timeMs >= current.totalMs ? 0 : current.timeMs;
        const updated = { ...current, playing: true, timeMs };
        testRef.current = updated;
        setTest(updated);
        report(updated);
      } else if (payload.action === "pause") {
        const updated = { ...current, playing: false };
        testRef.current = updated;
        setTest(updated);
        report(updated);
      } else if (payload.action === "seek") {
        const timeMs = Math.max(0, Math.min(current.totalMs, payload.timeMs ?? current.timeMs));
        const updated = { ...current, playing: false, timeMs };
        testRef.current = updated;
        setTest(updated);
        report(updated);
      }
    });
  }, [report]);

  const commitPosition = useCallback((xPct: number, yPct: number) => {
    writeSubtitleStyle({ ...readSubtitleStyle(), xPct, yPct });
  }, []);

  const handleDragStart = useCallback(() => {
    const current = testRef.current;
    if (!current) return;
    wasPlayingRef.current = current.playing;
    const updated = { ...current, playing: false };
    testRef.current = updated;
    setTest(updated);
    report(updated);
  }, [report]);

  const handleConfirm = useCallback(() => {
    const current = testRef.current;
    if (!current) return;
    const updated = { ...current, confirmed: true, playing: wasPlayingRef.current };
    testRef.current = updated;
    setTest(updated);
    report(updated);
  }, [report]);

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
        handleCapture(
          payload.text,
          payload.source,
          payload.voice,
          {
            utteranceId: payload.utteranceId,
            close: payload.close,
            stop: payload.stop,
          },
          {
            pluginText: payload.pluginText,
            tone: payload.tone,
            stickyMs: payload.stickyMs,
            clear: payload.pluginOverlay === "clear",
          }
        );
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

  // Dev-only hooks to simulate capture payloads in the browser.
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    const w = window as unknown as {
      __subtrVoiceTest?: (
        text: string,
        opts?: { utteranceId?: string; close?: boolean; stop?: boolean }
      ) => void;
      __subtrCapture?: (text: string, voice?: boolean) => void;
      __subtrPluginShow?: (
        text: string,
        opts?: { tone?: "normal" | "muted"; stickyMs?: number }
      ) => void;
      __subtrPluginClear?: () => void;
    };
    w.__subtrVoiceTest = (text, opts) => {
      void handleCapture(text, undefined, true, opts);
    };
    w.__subtrCapture = (text, voice = false) => {
      void handleCapture(text, undefined, voice);
    };
    w.__subtrPluginShow = (text, opts) => {
      void handleCapture(text, undefined, false, undefined, {
        pluginText: true,
        tone: opts?.tone,
        stickyMs: opts?.stickyMs,
      });
    };
    w.__subtrPluginClear = () => {
      void handleCapture("", undefined, false, undefined, { clear: true });
    };
    return () => {
      delete w.__subtrVoiceTest;
      delete w.__subtrCapture;
      delete w.__subtrPluginShow;
      delete w.__subtrPluginClear;
    };
  }, [handleCapture]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
      if (stopTimerRef.current) window.clearTimeout(stopTimerRef.current);
      if (pluginTimerRef.current) window.clearTimeout(pluginTimerRef.current);
      if (pluginStopTimerRef.current) window.clearTimeout(pluginStopTimerRef.current);
      voiceControllerRef.current?.abort();
    };
  }, []);

  const controllingTest = test
    ? {
        timeMs: test.timeMs,
        totalMs: test.totalMs,
        playing: test.playing,
      }
    : undefined;

  const testMode = test && !test.confirmed
    ? {
        enabled: true,
        showConfirm: true,
        onDragStart: handleDragStart,
        onCommit: commitPosition,
        onConfirm: handleConfirm,
      }
    : undefined;

  return (
    <SubtitleOverlay
      state={subtitle}
      onDismiss={dismissSubtitle}
      onRequestEscArmed={handleRequestEscArmed}
      onRequestInteractive={handleRequestInteractive}
      controlledPlay={controllingTest}
      testMode={testMode}
      voice={voiceActive}
      voiceLines={voiceLines}
      voiceStopping={voiceStopping}
      pluginText={pluginText}
      pluginStopping={pluginStopping}
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
