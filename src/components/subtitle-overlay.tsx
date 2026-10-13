"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { XIcon, LoaderIcon, AlertIcon } from "./icons";
import { getTextMetrics, useT } from "@/lib/client";
import { isDesktopMode } from "@/lib/client/desktop";
import {
  fontFamilyCss,
  readSubtitleStyle,
  readSubtitleTiming,
  type SubtitleStyle,
} from "@/lib/client";
import { MarkdownRenderer } from "./markdown-renderer";

export type SubtitleState =
  | { kind: "idle" }
  | { kind: "loading"; original: string }
  | { kind: "streaming"; original: string; text: string }
  | { kind: "error"; original: string; message: string }
  | { kind: "success"; original: string; text: string };

type SubtitleOverlayProps = {
  state: SubtitleState;
  onDismiss: () => void;
  onRequestEscArmed?: (armed: boolean) => void;
  onRequestInteractive?: (interactive: boolean) => void;
};

const ERROR_HIDE_MS = 20000;
const RECOMPUTE_MS = 400;
const MIN_REMAINING_MS = 300;
const SCROLL_EASE = 0.04; // per frame toward target velocity

function computeReadMs(text: string): number {
  const { latinWords, cjkChars } = getTextMetrics(text);
  const minMs = cjkChars === 0 ? 1000 : 1500;
  return Math.max(minMs, latinWords * (60000 / 180) + cjkChars * (60000 / 330));
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
}: SubtitleOverlayProps) {
  const { t } = useT();
  const [showEscHint, setShowEscHint] = useState(false);
  const [style] = useState<SubtitleStyle>(() => readSubtitleStyle());

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
    hold?: ReturnType<typeof setTimeout>;
    final?: ReturnType<typeof setTimeout>;
    static?: ReturnType<typeof setTimeout>;
    error?: ReturnType<typeof setTimeout>;
  }>({});
  const mountStartTimeRef = useRef<number>(0);
  const scrollStartTimeRef = useRef<number>(0);
  const lastRecomputeRef = useRef<number>(0);
  const velocityRef = useRef(0);
  const targetVelocityRef = useRef(0);
  const posRef = useRef(0);
  const textRef = useRef("");
  const timingRef = useRef(readSubtitleTiming());
  const prefersReducedMotionRef = useRef(false);

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
      const scaledReadMs = computeReadMs(textRef.current) * timingRef.current.textScale;

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
            timersRef.current.final = setTimeout(onDismiss, timingRef.current.finalHoldMs);
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
          computeReadMs(textRef.current) * timingRef.current.textScale
        );
        const elapsed = now - mountStartTimeRef.current;
        const remainingStaticMs = Math.max(0, totalStaticMs - elapsed);
        if (remainingStaticMs <= 0) {
          phaseRef.current = "final";
          timersRef.current.final = setTimeout(onDismiss, timingRef.current.finalHoldMs);
        } else {
          phaseRef.current = "static";
          timersRef.current.static = setTimeout(() => {
            phaseRef.current = "final";
            timersRef.current.final = setTimeout(onDismiss, timingRef.current.finalHoldMs);
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
  }, [onDismiss]);

  // Keep textRef current for the rAF loop and thinking indicator.
  useEffect(() => {
    textRef.current =
      state.kind === "streaming" || state.kind === "success"
        ? state.text
        : state.kind === "error"
          ? state.message
          : "";
  }, [state]);

  // Plain-browser Esc listener (ignored in desktop mode; bridge handles Esc there).
  useEffect(() => {
    if (state.kind === "idle") return;
    if (isDesktopMode()) return;

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onDismiss();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [state.kind, onDismiss]);

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

  // Initialize / reset once on mount (parent remounts per subtitle via key).
  useEffect(() => {
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
      timersRef.current.error = setTimeout(onDismiss, ERROR_HIDE_MS);
      return;
    }

    if (prefersReducedMotionRef.current) {
      phaseRef.current = "static";
      const staticMs = Math.max(
        timingRef.current.minDisplayMs,
        computeReadMs(textRef.current) * timingRef.current.textScale
      );
      timersRef.current.static = setTimeout(() => {
        phaseRef.current = "final";
        timersRef.current.final = setTimeout(onDismiss, timingRef.current.finalHoldMs);
      }, staticMs);
      return;
    }

    phaseRef.current = "hold";
    timersRef.current.hold = setTimeout(() => {
      phaseRef.current = "scroll";
      scrollStartTimeRef.current = performance.now();
      lastRecomputeRef.current = 0;
    }, timingRef.current.initialHoldMs);

    startLoop();

    return () => {
      if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleWheel(e: React.WheelEvent) {
    if (state.kind === "error" || state.kind === "loading") return;
    if (e.deltaY === 0) return;

    if (!interruptedRef.current) {
      interruptedRef.current = true;
      phaseRef.current = "interrupted";
      setShowEscHint(true);
      onRequestEscArmed?.(true);
      // Clear auto-hide timers.
      if (timersRef.current.final) clearTimeout(timersRef.current.final);
      if (timersRef.current.static) clearTimeout(timersRef.current.static);
    }
  }

  function handleDismiss() {
    onRequestEscArmed?.(false);
    onRequestInteractive?.(false);
    onDismiss();
  }

  const isError = state.kind === "error";
  const isLoading = state.kind === "loading";

  let rawText = "";
  let fallbackText = t("subtitle.noTranslation");
  if (state.kind === "error") {
    rawText = translateError(state.message);
    fallbackText = translateError(state.message);
  } else if (state.kind === "streaming" || state.kind === "success") {
    rawText = state.text;
  }

  const hasText = rawText.trim().length > 0;
  const mainText = hasText ? rawText : fallbackText;

  if (state.kind === "idle") return null;

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
  const leftPx = clampPx(
    (style.xPct / 100) * metrics.viewportWidth,
    wrapperW / 2 + MARGIN,
    metrics.viewportWidth - wrapperW / 2 - MARGIN
  );
  const topPx = clampPx(
    (style.yPct / 100) * metrics.viewportHeight,
    wrapperH / 2 + MARGIN,
    metrics.viewportHeight - wrapperH / 2 - MARGIN
  );

  return (
    <div
      data-subtr-overlay
      className="pointer-events-none fixed z-40 mx-auto flex max-w-[min(920px,92vw)] justify-center px-4"
      style={{
        left: hasMetrics ? `${leftPx}px` : `${style.xPct}%`,
        top: hasMetrics ? `${topPx}px` : `${style.yPct}%`,
        transform: "translate(-50%, -50%)",
      }}
      aria-live="polite"
      aria-atomic="true"
    >
      <div
        ref={cardRef}
        className="pointer-events-auto relative w-full rounded-2xl border border-white/10 px-5 py-4 text-center shadow-lg backdrop-blur-xl transition-all animate-subtitle-in"
        style={{
          backgroundColor: cardBackground,
          color: style.textColor,
          fontFamily: fontFamilyCss(style.fontFamily),
          fontSize: `${style.fontSizePx}px`,
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

        <button
          type="button"
          onClick={handleDismiss}
          className="absolute right-2 top-2 rounded-lg p-1.5 transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
          style={{ color: dimmedColor }}
          aria-label={t("subtitle.dismiss")}
        >
          <XIcon className="h-4 w-4" />
        </button>

        <p
          className="mb-1 line-clamp-2 text-xs leading-relaxed"
          style={{ color: dimmedColor }}
        >
          {state.original}
        </p>

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

        {!isLoading && !isError && (
          <div
            ref={viewportRef}
            className="subtr-scroll max-h-[200px] overflow-y-auto pr-1 text-left"
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
      </div>
    </div>
  );
}
