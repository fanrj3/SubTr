"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type MutableRefObject } from "react";
import { XIcon, LoaderIcon, AlertIcon, CheckIcon, LockIcon } from "./icons";
import { getTextMetrics, useT } from "@/lib/client";
import { isDesktopMode } from "@/lib/client/desktop";
import {
  fontFamilyCss,
  readSubtitleStyle,
  readSubtitleTiming,
  subscribeSubtitleStyle,
  DEFAULT_SUBTITLE_STYLE,
  computeTimeline,
  scrollOffsetAtTime,
  type SubtitleTiming,
} from "@/lib/client";
import { MarkdownRenderer } from "./markdown-renderer";

export type SubtitleState =
  | { kind: "idle" }
  | { kind: "loading"; original: string }
  | { kind: "streaming"; original: string; text: string }
  | { kind: "error"; original: string; message: string }
  | { kind: "success"; original: string; text: string }
  | { kind: "dictionary"; original: string; phonetic?: string; senses: string[] };

export type VoiceLine = {
  id: string;
  source: string;
  text: string;
  final: boolean;
};

export type ControlledPlay = {
  timeMs: number;
  totalMs: number;
  playing: boolean;
};

export type TestMode = {
  enabled: boolean;
  showConfirm: boolean;
  onDragStart: () => void;
  onCommit: (xPct: number, yPct: number) => void;
  onConfirm: () => void;
};

type SubtitleOverlayProps = {
  state: SubtitleState;
  onDismiss: () => void;
  onRequestEscArmed?: (armed: boolean) => void;
  onRequestInteractive?: (interactive: boolean) => void;
  controlledPlay?: ControlledPlay;
  testMode?: TestMode;
  /** Continuous voice captions: no internal auto-hide, keep the card stable. */
  voice?: boolean;
  /** Rolling transcript lines (oldest→newest); newest is the live line. */
  voiceLines?: VoiceLine[];
  /** True while a voice session is fading out via `stop`/Esc. */
  voiceStopping?: boolean;
  /** Verbatim text injected by a plugin (no translation). */
  pluginText?: { text: string; tone: "normal" | "muted" } | null;
  /** True while plugin text is fading out via `clear()`. */
  pluginStopping?: boolean;
};

const ERROR_HIDE_MS = 20000;
const RECOMPUTE_MS = 400;
const MIN_REMAINING_MS = 300;
const SCROLL_EASE = 0.04; // per frame toward target velocity

function computeReadMs(text: string): number {
  const { latinWords, cjkChars } = getTextMetrics(text);
  const minMs = cjkChars === 0 ? 1000 : 1500;
  return Math.max(minMs, latinWords * (60000 / 220) + cjkChars * (60000 / 400));
}

function hexToRgba(hex: string, alphaPct: number): string {
  const clean = hex.replace("#", "");
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  const a = Math.max(0, Math.min(100, alphaPct)) / 100;
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

export function SubtitleOverlay({
  state,
  onDismiss,
  onRequestEscArmed,
  onRequestInteractive,
  controlledPlay,
  testMode,
  voice,
  voiceLines,
  voiceStopping,
  pluginText,
  pluginStopping,
}: SubtitleOverlayProps) {
  const { t } = useT();
  const [showEscHint, setShowEscHint] = useState(false);
  const style = useSyncExternalStore(
    subscribeSubtitleStyle,
    () => readSubtitleStyle(),
    () => DEFAULT_SUBTITLE_STYLE
  );

  function translateError(message: string): string {
    if (message === "No response body") return t("error.noResponseBody");
    if (message === "Network error") return t("error.network");
    if (message === "Stream error") return t("error.stream");
    const serverMatch = /^Server error (\d+)$/.exec(message);
    if (serverMatch) return t("error.server", { status: serverMatch[1] });
    return message;
  }
  const cardRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  const phaseRef = useRef<"hold" | "scroll" | "final" | "interrupted" | "static">("hold");
  const streamEndedRef = useRef(false);
  const interruptedRef = useRef(false);
  const rafIdRef = useRef<number | null>(null);
  const timersRef = useRef<{
    hold?: number;
    final?: number;
    static?: number;
    error?: number;
    exit?: number;
  }>({});
  const [isExiting, setIsExiting] = useState(false);
  const prevKindRef = useRef(state.kind);
  const exitOriginalRef = useRef("");
  const original = state.kind !== "idle" ? state.original : "";
  const isControlled = !!controlledPlay;
  const isVoice = !!voice;
  const isPlugin = !!pluginText || !!pluginStopping;
  const mountStartTimeRef = useRef<number>(0);
  const scrollStartTimeRef = useRef<number>(0);
  const finalStartTimeRef = useRef<number>(0);
  const lastRecomputeRef = useRef<number>(0);
  const velocityRef = useRef(0);
  const targetVelocityRef = useRef(0);
  const posRef = useRef(0);
  const textRef = useRef("");
  const timingRef = useRef(readSubtitleTiming());
  const prefersReducedMotionRef = useRef(false);
  const [dragPos, setDragPos] = useState<{ xPct: number; yPct: number } | null>(null);
  const [showGuides, setShowGuides] = useState({ x: false, y: false });
  const dragRef = useRef(false);
  const [pinned, setPinned] = useState(false);

  // Measure card and viewport so we can clamp the center position to keep the card on-screen.
  const [metrics, setMetrics] = useState({
    cardWidth: 0,
    cardHeight: 0,
    viewportWidth: 0,
    viewportHeight: 0,
  });

  useEffect(() => {
    function update() {
      setMetrics({
        cardWidth: cardRef.current?.offsetWidth ?? 0,
        cardHeight: cardRef.current?.offsetHeight ?? 0,
        // CSS percentage left/top resolves against the layout viewport, which
        // excludes a stable scrollbar gutter — use clientWidth/clientHeight to match.
        viewportWidth: document.documentElement.clientWidth,
        viewportHeight: document.documentElement.clientHeight,
      });
    }
    update();
    const ro = new ResizeObserver(update);
    if (cardRef.current) ro.observe(cardRef.current);
    window.addEventListener("resize", update);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", update);
    };
  }, []);

  const startExit = useCallback(() => {
    if (isExiting) return;
    exitOriginalRef.current = original;
    setIsExiting(true);
    const duration = prefersReducedMotionRef.current ? 0 : 200;
    timersRef.current.exit = window.setTimeout(() => {
      onRequestEscArmed?.(false);
      onRequestInteractive?.(false);
      setIsExiting(false);
      onDismiss();
    }, duration);
  }, [isExiting, onDismiss, onRequestEscArmed, onRequestInteractive, original]);

  const startLoop = useCallback(() => {
    if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);

    function loop(now: number) {
      const viewport = viewportRef.current;
      const content = contentRef.current;
      if (!viewport || !content) {
        rafIdRef.current = requestAnimationFrame(loop);
        return;
      }

      const maxScroll = content.scrollHeight - viewport.clientHeight;
      const scaledReadMs = computeReadMs(textRef.current) / timingRef.current.textScale;

      if (phaseRef.current === "hold") {
        posRef.current = 0;
        viewport.scrollTop = 0;
      } else if (phaseRef.current === "scroll" && maxScroll > 0) {
        const remainingPx = maxScroll - posRef.current;
        const elapsed = now - scrollStartTimeRef.current;
        const remainingReadMs = Math.max(scaledReadMs - elapsed, MIN_REMAINING_MS);

        if (
          lastRecomputeRef.current === 0 ||
          now - lastRecomputeRef.current >= RECOMPUTE_MS
        ) {
          targetVelocityRef.current = (remainingPx / remainingReadMs) * 1000;
          lastRecomputeRef.current = now;
        }

        velocityRef.current +=
          (targetVelocityRef.current - velocityRef.current) * SCROLL_EASE;

        const dt = 1 / 60; // seconds per frame approx
        const nextScroll = posRef.current + velocityRef.current * dt;

        if (nextScroll >= maxScroll) {
          posRef.current = maxScroll;
          viewport.scrollTop = maxScroll;
          if (streamEndedRef.current) {
            phaseRef.current = "final";
            timersRef.current.final = window.setTimeout(startExit, timingRef.current.finalHoldMs);
          }
        } else {
          posRef.current = nextScroll;
          viewport.scrollTop = nextScroll;
        }
      } else if (
        phaseRef.current === "scroll" &&
        maxScroll <= 0 &&
        streamEndedRef.current
      ) {
        // Short content and stream ended → stay visible for the configured minimum/read time.
        const totalStaticMs = Math.max(
          timingRef.current.minDisplayMs,
          computeReadMs(textRef.current) / timingRef.current.textScale
        );
        const elapsed = now - mountStartTimeRef.current;
        const remainingStaticMs = Math.max(0, totalStaticMs - elapsed);
        if (remainingStaticMs <= 0) {
          phaseRef.current = "final";
          timersRef.current.final = window.setTimeout(startExit, timingRef.current.finalHoldMs);
        } else {
          phaseRef.current = "static";
          timersRef.current.static = window.setTimeout(() => {
            phaseRef.current = "final";
            timersRef.current.final = window.setTimeout(startExit, timingRef.current.finalHoldMs);
          }, remainingStaticMs);
        }
      } else if (phaseRef.current === "scroll" && maxScroll <= 0) {
        // No overflow but still streaming → keep viewport at top.
        posRef.current = 0;
        viewport.scrollTop = 0;
      }

      if (phaseRef.current === "hold" || phaseRef.current === "scroll") {
        rafIdRef.current = requestAnimationFrame(loop);
      }
    }

    rafIdRef.current = requestAnimationFrame(loop);
  }, [startExit]);

  // Keep textRef current for the rAF loop and thinking indicator.
  useEffect(() => {
    textRef.current =
      state.kind === "streaming" || state.kind === "success"
        ? state.text
        : state.kind === "error"
          ? state.message
          : state.kind === "dictionary"
            ? [state.original, state.phonetic ?? "", ...state.senses].join(" ")
            : "";
  }, [state]);

  // Plain-browser Esc listener (ignored in desktop mode; bridge handles Esc there).
  useEffect(() => {
    if (state.kind === "idle") return;
    if (isDesktopMode()) return;

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        startExit();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [state.kind, startExit]);

  // Cleanup on unmount and guard against stuck interactive state.
  useEffect(() => {
    function onMouseLeaveWindow() {
      onRequestInteractive?.(false);
    }
    function onVisibilityChange() {
      if (document.hidden) {
        onRequestInteractive?.(false);
      }
    }

    window.addEventListener("mouseleave", onMouseLeaveWindow);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      window.removeEventListener("mouseleave", onMouseLeaveWindow);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);
      for (const key of Object.keys(timersRef.current) as Array<
        keyof typeof timersRef.current
      >) {
        const id = timersRef.current[key];
        if (id) clearTimeout(id);
      }
      timersRef.current = {};
      onRequestEscArmed?.(false);
      onRequestInteractive?.(false);
    };
  }, [onRequestEscArmed, onRequestInteractive]);

  // Track stream end.
  useEffect(() => {
    if (state.kind === "success") {
      streamEndedRef.current = true;
    }
  }, [state.kind]);

  // Pinning is per-subtitle; reset when a new one appears.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPinned(false);
  }, [original]);

  // Reduced-motion is needed even in voice mode (where the init effect is skipped).
  useEffect(() => {
    prefersReducedMotionRef.current = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;
  }, []);

  // Voice rolling translation: scroll only on discrete line appends.
  const voiceLineCount = voiceLines?.length ?? 0;
  useEffect(() => {
    if (!isVoice) return;
    const vp = viewportRef.current;
    if (!vp) return;
    vp.scrollTo({
      top: vp.scrollHeight,
      behavior: prefersReducedMotionRef.current ? "auto" : "smooth",
    });
  }, [isVoice, voiceLineCount]);

  // Cancel an in-flight exit only when a genuinely NEW subtitle arrives during
  // the exit; start exit when parent switches to idle.
  useEffect(() => {
    if (state.kind !== "idle" && isExiting && original !== exitOriginalRef.current) {
      if (timersRef.current.exit) clearTimeout(timersRef.current.exit);
      setIsExiting(false);
    }
    // Voice captions hard-cut: no re-creating exit animation and no fallback
    // flash. Non-voice captures keep the normal exit fade.
    if (
      state.kind === "idle" &&
      prevKindRef.current !== "idle" &&
      !isExiting &&
      !isVoice &&
      !isPlugin
    ) {
      startExit();
    }
    prevKindRef.current = state.kind;
  }, [state.kind, original, isExiting, startExit, isVoice, isPlugin]);

  // Externally-controlled clock (desktop test playback / in-window fallback).
  useEffect(() => {
    if (!controlledPlay) return;
    const viewport = viewportRef.current;
    const content = contentRef.current;
    if (!viewport || !content) return;
    const timeline = computeTimeline(textRef.current, timingRef.current);
    const maxScroll = Math.max(0, content.scrollHeight - viewport.clientHeight);
    viewport.scrollTop = scrollOffsetAtTime(
      controlledPlay.timeMs,
      timingRef.current,
      timeline.scrollMs,
      maxScroll
    );
  }, [controlledPlay]);

  // Test-mode drag: pause, move live, snap to center, commit on drop.
  useEffect(() => {
    if (!testMode?.enabled) return;

    function onMove(e: PointerEvent) {
      if (!dragRef.current) return;
      const w = document.documentElement.clientWidth;
      const h = document.documentElement.clientHeight;
      let xPct = (e.clientX / w) * 100;
      let yPct = (e.clientY / h) * 100;
      const guides = { x: false, y: false };
      if (Math.abs(xPct - 50) <= 3) {
        xPct = 50;
        guides.x = true;
      }
      if (Math.abs(yPct - 50) <= 3) {
        yPct = 50;
        guides.y = true;
      }
      setShowGuides(guides);
      setDragPos({ xPct: Math.round(xPct), yPct: Math.round(yPct) });
    }

    function onUp() {
      if (!dragRef.current) return;
      dragRef.current = false;
      setShowGuides({ x: false, y: false });
      setDragPos((pos) => {
        if (pos) testMode?.onCommit(pos.xPct, pos.yPct);
        return null;
      });
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [testMode]);

  // Initialize / reset on mount and whenever the displayed subtitle changes.
  useEffect(() => {
    if (state.kind === "idle") return;
    if (controlledPlay) return;
    if (isVoice) return;
    if (isPlugin) return;

    prefersReducedMotionRef.current = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;
    timingRef.current = readSubtitleTiming();

    mountStartTimeRef.current = performance.now();
    streamEndedRef.current = state.kind !== "streaming" && state.kind !== "loading";
    interruptedRef.current = false;
    velocityRef.current = 0;
    targetVelocityRef.current = 0;
    lastRecomputeRef.current = 0;
    posRef.current = 0;

    // Reset scroll to top.
    if (viewportRef.current) {
      viewportRef.current.scrollTop = 0;
    }

    for (const key of Object.keys(timersRef.current) as Array<
      keyof typeof timersRef.current
    >) {
      const id = timersRef.current[key];
      if (id) clearTimeout(id);
    }
    timersRef.current = {};
    onRequestEscArmed?.(false);

    if (state.kind === "error") {
      phaseRef.current = "interrupted"; // no auto-scroll, just timer
      timersRef.current.error = window.setTimeout(startExit, ERROR_HIDE_MS);
      return;
    }

    // Dictionary entries are short content: stay static for the read time,
    // then run the final hold. Never enter the teleprompter scroll flow.
    if (state.kind === "dictionary") {
      phaseRef.current = "static";
      const staticMs = Math.max(
        timingRef.current.minDisplayMs,
        computeReadMs(textRef.current) / timingRef.current.textScale
      );
      timersRef.current.static = window.setTimeout(() => {
        phaseRef.current = "final";
        timersRef.current.final = window.setTimeout(startExit, timingRef.current.finalHoldMs);
      }, staticMs);
      return;
    }

    if (prefersReducedMotionRef.current) {
      phaseRef.current = "static";
      const staticMs = Math.max(
        timingRef.current.minDisplayMs,
        computeReadMs(textRef.current) / timingRef.current.textScale
      );
      timersRef.current.static = window.setTimeout(() => {
        phaseRef.current = "final";
        timersRef.current.final = window.setTimeout(startExit, timingRef.current.finalHoldMs);
      }, staticMs);
      return;
    }

    phaseRef.current = "hold";
    timersRef.current.hold = window.setTimeout(() => {
      phaseRef.current = "scroll";
      scrollStartTimeRef.current = performance.now();
      lastRecomputeRef.current = 0;
    }, timingRef.current.initialHoldMs);

    startLoop();

    return () => {
      if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [original, isControlled, isVoice, isPlugin]);

  function pin(showHint: boolean) {
    if (isVoice) return; // pinning is a no-op while voice mode is active
    if (pinned) return;
    setPinned(true);
    interruptedRef.current = true;
    phaseRef.current = "interrupted";
    if (showHint) setShowEscHint(true);
    onRequestEscArmed?.(true);
    // Clear auto-hide timers.
    if (timersRef.current.final) clearTimeout(timersRef.current.final);
    if (timersRef.current.static) clearTimeout(timersRef.current.static);
  }

  function handleWheel(e: React.WheelEvent) {
    if (state.kind === "error" || state.kind === "loading" || state.kind === "dictionary") return;
    if (e.deltaY === 0) return;
    pin(true);
  }

  function handleDismiss() {
    if (isExiting) return;
    onRequestEscArmed?.(false);
    onRequestInteractive?.(false);
    startExit();
  }

  const isError = state.kind === "error";
  const isLoading = state.kind === "loading";
  const isDictionary = state.kind === "dictionary";

  let rawText = "";
  let fallbackText = t("subtitle.noTranslation");
  if (state.kind === "error") {
    rawText = translateError(state.message);
    fallbackText = translateError(state.message);
  } else if (state.kind === "streaming" || state.kind === "success") {
    rawText = state.text;
  }

  const hasText = rawText.trim().length > 0;
  // Voice captions never flash the fallback while dismissing (or between
  // updates) — they keep the last content until the fade completes.
  const mainText = hasText ? rawText : isVoice ? "" : fallbackText;
  const isShort = isDictionary || mainText.trim().length <= 40;
  const contentPad = isShort ? "px-10" : "pr-1";

  if (state.kind === "idle" && !isExiting) return null;

  const cardBackground = hexToRgba(style.bgColor, style.bgOpacity);
  const dimmedColor = style.textColor + "99"; // ~60% opacity hex

  // Position in pixels (percentage bases differ between CSS layout viewport and
  // JS-reported widths when a scrollbar gutter is reserved, so percentages are
  // ambiguous). The wrapper carries px-4 (32px total horizontal padding).
  const MARGIN = 8;
  const hasMetrics = metrics.viewportWidth > 0 && metrics.viewportHeight > 0;
  const wrapperW = metrics.cardWidth + 32;
  const wrapperH = metrics.cardHeight;
  const clampPx = (v: number, min: number, max: number) =>
    Math.max(min, Math.min(Math.max(min, max), v));
  const posX = dragPos?.xPct ?? style.xPct;
  const posY = dragPos?.yPct ?? style.yPct;
  const leftPx = clampPx(
    (posX / 100) * metrics.viewportWidth,
    wrapperW / 2 + MARGIN,
    metrics.viewportWidth - wrapperW / 2 - MARGIN
  );
  const topPx = clampPx(
    (posY / 100) * metrics.viewportHeight,
    wrapperH / 2 + MARGIN,
    metrics.viewportHeight - wrapperH / 2 - MARGIN
  );
  // Voice: anchor the card by its BOTTOM so growth doesn't move the bottom edge.
  const voiceTopPx = clampPx(
    (posY / 100) * metrics.viewportHeight,
    200,
    metrics.viewportHeight - MARGIN
  );

  return (
    <>
      {testMode?.enabled && showGuides.x && (
        <div className="pointer-events-none fixed inset-y-0 left-1/2 z-40 w-px -translate-x-1/2 bg-accent/60" />
      )}
      {testMode?.enabled && showGuides.y && (
        <div className="pointer-events-none fixed inset-x-0 top-1/2 z-40 h-px -translate-y-1/2 bg-accent/60" />
      )}
    <div
      data-subtr-overlay
      className={`pointer-events-none fixed z-40 mx-auto flex max-w-[min(920px,92vw)] justify-center px-4 transition-all duration-200 ease-out motion-reduce:transition-none ${
        isExiting || voiceStopping || pluginStopping
          ? "pointer-events-none opacity-0 translate-y-2"
          : "opacity-100 translate-y-0"
      }`}
      style={{
        left: hasMetrics ? `${leftPx}px` : `${posX}%`,
        top: isVoice
          ? hasMetrics
            ? `${voiceTopPx}px`
            : `${posY}%`
          : hasMetrics
            ? `${topPx}px`
            : `${posY}%`,
        transform: isVoice ? "translate(-50%, -100%)" : "translate(-50%, -50%)",
      }}
      aria-live="polite"
      aria-atomic="true"
    >
      <div
        ref={cardRef}
        className={`pointer-events-auto relative w-full rounded-2xl border border-white/10 px-5 py-4 text-center shadow-lg backdrop-blur-xl transition-all animate-subtitle-in ${
          testMode?.enabled ? "cursor-grab active:cursor-grabbing" : ""
        }`}
        style={{
          backgroundColor: cardBackground,
          color: style.textColor,
          fontFamily: fontFamilyCss(style.fontFamily),
          fontSize: `${style.fontSizePx}px`,
        }}
        onPointerDown={(e) => {
          if (!testMode?.enabled) return;
          e.preventDefault();
          dragRef.current = true;
          testMode.onDragStart();
          setDragPos({ xPct: style.xPct, yPct: style.yPct });
        }}
        onClick={() => {
          if (testMode?.enabled) return;
          pin(false);
        }}
        onMouseEnter={() => onRequestInteractive?.(true)}
        onMouseLeave={() => onRequestInteractive?.(false)}
        onWheel={handleWheel}
      >
        {showEscHint && (
          <div className="absolute left-2 top-2 z-10 rounded-md bg-white/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-white/70">
            {t("subtitle.esc")}
          </div>
        )}

        {testMode?.enabled && testMode.showConfirm && (
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              testMode.onConfirm();
            }}
            className="absolute right-9 top-2 rounded-lg p-1.5 transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
            style={{ color: dimmedColor }}
            aria-label={t("subtitle.confirmPosition")}
          >
            <CheckIcon className="h-4 w-4" />
          </button>
        )}

        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            handleDismiss();
          }}
          className="absolute right-2 top-2 rounded-lg p-1.5 transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
          style={{ color: dimmedColor }}
          aria-label={t("subtitle.dismiss")}
        >
          <XIcon className="h-4 w-4" />
        </button>

        {!isVoice && !isPlugin && (
          <p
            className="mb-1 line-clamp-2 px-10 text-xs leading-relaxed"
            style={{ color: dimmedColor }}
          >
            {state.kind !== "idle" ? state.original : ""}
          </p>
        )}

        {isPlugin && (
          <p
            className="px-6 text-center leading-snug tracking-wide"
            style={{
              color: pluginText?.tone === "muted" ? dimmedColor : style.textColor,
            }}
          >
            {pluginText?.text ?? ""}
          </p>
        )}

        {isVoice && !isPlugin && (
          <div className="flex flex-col gap-2">
            <div
              className="flex h-[2.7em] items-end justify-center overflow-hidden text-center"
              style={{ color: dimmedColor }}
              aria-live="polite"
            >
              <p className="w-full text-[0.85em] font-normal leading-snug">
                {(voiceLines ?? [])[(voiceLines ?? []).length - 1]?.source ?? ""}
              </p>
            </div>
            <div
              ref={viewportRef}
              className="subtr-scroll max-h-[4.2em] overflow-y-auto text-center"
              style={{ color: style.textColor }}
            >
              <div ref={contentRef} className="space-y-0.5 leading-snug tracking-wide">
                {(voiceLines ?? []).map((line) => (
                  <p key={line.id} className={line.final ? "" : "opacity-60"}>
                    {line.text || "\u00A0"}
                  </p>
                ))}
              </div>
            </div>
          </div>
        )}

        {isLoading && (
          <div className="flex items-center justify-center gap-2 py-1">
            <LoaderIcon
              className="h-5 w-5 animate-spin"
              style={{ animationDuration: "0.8s", color: style.textColor }}
            />
            <span className="subtr-thinking-swap text-base font-medium">
              <span className="subtr-thinking-primary">{t("subtitle.translating")}</span>
              <span className="subtr-thinking-secondary">
                {t("subtitle.thinking")}
                <span className="subtr-thinking-dots" aria-hidden="true">…</span>
              </span>
            </span>
          </div>
        )}

        {isError && (
          <div className="flex items-center justify-center gap-2 py-1" style={{ color: "#f87171" }}>
            <AlertIcon className="h-5 w-5" />
            <span className="text-base">{mainText}</span>
          </div>
        )}

        {isDictionary && state.kind === "dictionary" && (
          <div
            ref={viewportRef}
            className={`subtr-scroll max-h-[200px] overflow-y-auto text-left ${contentPad}`}
          >
            <div ref={contentRef} className="space-y-1.5">
              <p className="text-lg font-semibold leading-tight tracking-wide">
                {state.original}
              </p>
              {state.phonetic && (
                <p className="text-xs leading-snug" style={{ color: dimmedColor }}>
                  {state.phonetic}
                </p>
              )}
              <ol className="ml-4 list-decimal space-y-0.5 text-sm leading-snug">
                {state.senses.map((sense, index) => (
                  <li key={`${sense}-${index}`}>{sense}</li>
                ))}
              </ol>
            </div>
          </div>
        )}

        {!isLoading && !isError && !isDictionary && !isVoice && !isPlugin && (
          <div
            ref={viewportRef}
            className={`subtr-scroll max-h-[200px] overflow-y-auto text-left ${contentPad}`}
          >
            <div ref={contentRef}>
              {state.kind === "streaming" && !hasText ? (
                <p className="subtr-thinking text-base leading-snug tracking-wide">
                  {t("subtitle.thinking")}
                  <span className="subtr-thinking-dots" aria-hidden="true">…</span>
                </p>
              ) : (
                <MarkdownRenderer className="leading-snug tracking-wide">
                  {mainText}
                </MarkdownRenderer>
              )}
              {state.kind === "streaming" && hasText && (
                <span
                  className="ml-0.5 inline-block h-[1em] w-0.5 align-middle animate-caret-blink"
                  style={{ backgroundColor: style.textColor }}
                  aria-hidden="true"
                />
              )}
            </div>
          </div>
        )}

        {pinned ? (
          <div
            className="pointer-events-none absolute bottom-2 right-2 flex h-4 w-4 items-center justify-center"
            style={{ color: dimmedColor }}
            role="img"
            aria-label={t("subtitle.pinned")}
          >
            <LockIcon className="h-3.5 w-3.5" />
          </div>
        ) : (
          !controlledPlay &&
          !isVoice &&
          !isPlugin && (
            <HoldProgress
              phaseRef={phaseRef}
              timingRef={timingRef}
              mountStartTimeRef={mountStartTimeRef}
              finalStartTimeRef={finalStartTimeRef}
              textColor={style.textColor}
            />
          )
        )}
      </div>
    </div>
    </>
  );
}

type HoldProgressProps = {
  phaseRef: MutableRefObject<
    "hold" | "scroll" | "final" | "interrupted" | "static"
  >;
  timingRef: MutableRefObject<SubtitleTiming>;
  mountStartTimeRef: MutableRefObject<number>;
  finalStartTimeRef: MutableRefObject<number>;
  textColor: string;
};

function HoldProgress({
  phaseRef,
  timingRef,
  mountStartTimeRef,
  finalStartTimeRef,
  textColor,
}: HoldProgressProps) {
  const [progress, setProgress] = useState(0);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let raf = 0;
    function loop(now: number) {
      const phase = phaseRef.current;
      if (phase === "hold") {
        const elapsed = now - mountStartTimeRef.current;
        const total = timingRef.current.initialHoldMs;
        setProgress(total > 0 ? Math.min(1, elapsed / total) : 1);
        setVisible(true);
      } else if (phase === "final") {
        if (finalStartTimeRef.current === 0) {
          finalStartTimeRef.current = now;
        }
        const elapsed = now - finalStartTimeRef.current;
        const total = timingRef.current.finalHoldMs;
        setProgress(total > 0 ? Math.min(1, elapsed / total) : 1);
        setVisible(true);
      } else {
        finalStartTimeRef.current = 0;
        setVisible(false);
      }
      raf = requestAnimationFrame(loop);
    }
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [phaseRef, timingRef, mountStartTimeRef, finalStartTimeRef]);

  if (!visible) return null;
  return (
    <div
      className="pointer-events-none absolute bottom-2 right-2 h-1 w-16 overflow-hidden rounded-full opacity-30"
      style={{ color: textColor }}
      aria-hidden="true"
    >
      <div
        className="h-full rounded-full bg-current"
        style={{ width: `${progress * 100}%` }}
      />
    </div>
  );
}
