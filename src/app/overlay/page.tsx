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
import { SubtitleOverlay, type SubtitleState } from "@/components/subtitle-overlay";

const TARGET_LANG_KEY = "subtr.targetLang.v1";
const DEFAULT_TARGET_LANG = "auto";
const REPORT_INTERVAL_MS = 200;
const VOICE_DEBOUNCE_MS = 800;
const VOICE_IDLE_MS = 2500;

type TestState = {
  playing: boolean;
  timeMs: number;
  totalMs: number;
  text: string;
  confirmed: boolean;
};

type VoiceSession = {
  active: boolean;
  seq: number;
  latestText: string;
  displayed: string;
  debounce: number | null;
  idle: number | null;
  controller: AbortController | null;
};

type PreparedTranslation = {
  config: ReturnType<typeof toLlmConfig>;
  targetLang: string;
  bodyOverrides?: Record<string, unknown>;
};

function readTargetLang(): string {
  return readStorage(TARGET_LANG_KEY, DEFAULT_TARGET_LANG);
}

function createVoiceSession(): VoiceSession {
  return {
    active: false,
    seq: 0,
    latestText: "",
    displayed: "",
    debounce: null,
    idle: null,
    controller: null,
  };
}

function Overlay() {
  const { t } = useT();
  const mode = useModeState();
  const [subtitle, setSubtitle] = useState<SubtitleState>({ kind: "idle" });
  const [test, setTest] = useState<TestState | null>(null);
  const [voiceActive, setVoiceActive] = useState(false);
  const [voiceRevision, setVoiceRevision] = useState(0);
  const testRef = useRef<TestState | null>(null);
  const voiceRef = useRef<VoiceSession | null>(null);
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

  const dismissSubtitle = useCallback(() => {
    const v = voiceRef.current;
    if (v) {
      if (v.debounce) window.clearTimeout(v.debounce);
      if (v.idle) window.clearTimeout(v.idle);
      v.controller?.abort();
      voiceRef.current = {
        ...createVoiceSession(),
        displayed: v.displayed,
      };
    }
    // Keep `voiceActive` true through the dismissal render: the overlay uses it
    // to take the hard-cut path (no re-creating fade, no fallback flash). It is
    // reset when the next non-voice capture begins.
    abortRef.current?.abort();
    abortRef.current = null;
    testRef.current = null;
    setTest(null);
    setSubtitle({ kind: "idle" });
  }, []);

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

  /** One translation per debounce window; stale results are ignored by seq. */
  const runVoiceTranslation = useCallback(
    (seq: number) => {
      const v = voiceRef.current;
      if (!v || !v.active) return;
      const text = v.latestText;
      if (!text.trim()) return;
      const prepared = prepareTranslation(text);
      if (!prepared) return; // keep previous text visible

      v.controller?.abort();
      const controller = new AbortController();
      // Replace only the controller; keep idle/debounce handles so the
      // in-flight idle timer can still be cancelled by the next payload.
      voiceRef.current = { ...v, controller };
      let buffer = "";

      streamTranslate(
        text,
        prepared.targetLang,
        prepared.config,
        controller.signal,
        {
          onChunk: (value) => {
            buffer = value;
          },
          onDone: () => {
            const current = voiceRef.current;
            if (!current || !current.active || current.seq !== seq) return; // stale
            const next = buffer.trim() || text;
            current.displayed = next;
            setSubtitle({
              kind: "success",
              original: text.slice(0, 80),
              text: next,
            });
            setVoiceRevision((r) => r + 1);
          },
          onError: () => {
            // Keep the previous translated text visible.
          },
        },
        prepared.bodyOverrides && Object.keys(prepared.bodyOverrides).length > 0
          ? prepared.bodyOverrides
          : undefined
      );
    },
    [prepareTranslation]
  );

  const handleVoiceCapture = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      const prev = voiceRef.current ?? createVoiceSession();
      if (prev.debounce) window.clearTimeout(prev.debounce);
      if (prev.idle) window.clearTimeout(prev.idle);

      const seq = prev.seq + 1;
      setVoiceActive(true);

      // Never blank the caption: show the source text on the first payload
      // until the first translation arrives; afterwards keep the previous one.
      if (!prev.displayed) {
        setSubtitle({ kind: "success", original: trimmed.slice(0, 80), text: trimmed });
        setVoiceRevision((r) => r + 1);
      }

      const debounce = window.setTimeout(() => {
        const cur = voiceRef.current;
        if (cur) voiceRef.current = { ...cur, debounce: null };
        runVoiceTranslation(seq);
      }, VOICE_DEBOUNCE_MS);

      const idle = window.setTimeout(() => {
        const cur = voiceRef.current;
        if (cur) voiceRef.current = { ...cur, idle: null };
        dismissSubtitle();
      }, VOICE_IDLE_MS);

      voiceRef.current = {
        active: true,
        seq,
        latestText: trimmed,
        displayed: prev.displayed,
        debounce,
        idle,
        controller: prev.controller,
      };
    },
    [runVoiceTranslation, dismissSubtitle]
  );

  const handleCapture = useCallback(
    async (text: string, source?: string, voice?: boolean) => {
      const trimmed = text.trim();
      if (!trimmed) return;

      if (voice) {
        handleVoiceCapture(trimmed);
        return;
      }

      // Any non-voice capture leaves voice mode cleanly.
      const v = voiceRef.current;
      if (v?.active) {
        if (v.debounce) window.clearTimeout(v.debounce);
        if (v.idle) window.clearTimeout(v.idle);
        v.controller?.abort();
        voiceRef.current = { ...createVoiceSession(), displayed: v.displayed };
        setVoiceActive(false);
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
      handleVoiceCapture,
      prepareTranslation,
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
        handleCapture(payload.text, payload.source, payload.voice);
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

  // Dev-only hook to simulate voice capture payloads in the browser.
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    const w = window as unknown as {
      __subtrVoiceTest?: (text: string, voice?: boolean) => void;
    };
    w.__subtrVoiceTest = (text, voice = true) => {
      void handleCapture(text, undefined, voice);
    };
    return () => {
      delete w.__subtrVoiceTest;
    };
  }, [handleCapture]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      const v = voiceRef.current;
      if (v) {
        if (v.debounce) window.clearTimeout(v.debounce);
        if (v.idle) window.clearTimeout(v.idle);
        v.controller?.abort();
      }
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
      voiceRevision={voiceRevision}
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
