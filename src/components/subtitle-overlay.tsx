"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { XIcon, LoaderIcon, AlertIcon } from "./icons";
import { getTextMetrics } from "@/lib/client";
import { isDesktopMode } from "@/lib/client/desktop";

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
const HOLD_MS = 5000;
const FINAL_MS = 1200;
const RECOMPUTE_MS = 400;
const MIN_REMAINING_MS = 300;
const SCROLL_EASE = 0.04; // per frame toward target velocity

function computeReadMs(text: string): number {
  const { latinWords, cjkChars } = getTextMetrics(text);
  const minMs = cjkChars === 0 ? 1000 : 1500;
  return Math.max(minMs, latinWords * (60000 / 180) + cjkChars * (60000 / 330));
}

export function SubtitleOverlay({
  state,
  onDismiss,
  onRequestEscArmed,
  onRequestInteractive,
}: SubtitleOverlayProps) {
  const [showEscHint, setShowEscHint] = useState(false);

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
  const scrollStartTimeRef = useRef<number>(0);
  const lastRecomputeRef = useRef<number>(0);
  const velocityRef = useRef(0);
  const targetVelocityRef = useRef(0);
  const posRef = useRef(0);
  const textRef = useRef("");
  const prefersReducedMotionRef = useRef(false);

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

      if (phaseRef.current === "hold") {
        posRef.current = 0;
        viewport.scrollTop = 0;
      } else if (phaseRef.current === "scroll" && maxScroll > 0) {
        const remainingPx = maxScroll - posRef.current;
        const readMs = computeReadMs(textRef.current);
        const elapsed = now - scrollStartTimeRef.current;
        const remainingReadMs = Math.max(readMs - elapsed, MIN_REMAINING_MS);

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
            timersRef.current.final = setTimeout(onDismiss, FINAL_MS);
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
        // No overflow and stream ended → final.
        phaseRef.current = "final";
        timersRef.current.final = setTimeout(onDismiss, FINAL_MS);
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

  // Keep textRef current for the rAF loop.
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
      timersRef.current.static = setTimeout(() => {
        phaseRef.current = "final";
        timersRef.current.final = setTimeout(onDismiss, FINAL_MS);
      }, Math.max(2500, computeReadMs(textRef.current)));
      return;
    }

    phaseRef.current = "hold";
    timersRef.current.hold = setTimeout(() => {
      phaseRef.current = "scroll";
      scrollStartTimeRef.current = performance.now();
      lastRecomputeRef.current = 0;
    }, HOLD_MS);

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
  let fallbackText = "No translation returned";
  if (state.kind === "error") {
    rawText = state.message;
    fallbackText = state.message;
  } else if (state.kind === "streaming" || state.kind === "success") {
    rawText = state.text;
  }

  const hasText = rawText.trim().length > 0;
  const mainText = hasText ? rawText : fallbackText;

  if (state.kind === "idle") return null;

  return (
    <div
      data-subtr-overlay
      className="pointer-events-none fixed inset-x-0 bottom-[clamp(3rem,12vh,8rem)] z-40 mx-auto flex max-w-[min(920px,92vw)] justify-center px-4 animate-subtitle-in"
      aria-live="polite"
      aria-atomic="true"
    >
      <div
        className="pointer-events-auto relative w-full rounded-2xl border border-white/10 bg-black/82 px-5 py-4 text-center text-white shadow-lg backdrop-blur-xl transition-all"
        onMouseEnter={() => onRequestInteractive?.(true)}
        onMouseLeave={() => onRequestInteractive?.(false)}
        onWheel={handleWheel}
      >
        {showEscHint && (
          <div className="absolute left-2 top-2 z-10 rounded-md bg-white/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-white/70">
            Esc
          </div>
        )}

        <button
          type="button"
          onClick={handleDismiss}
          className="absolute right-2 top-2 rounded-lg p-1.5 text-white/50 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
          aria-label="Dismiss subtitle"
        >
          <XIcon className="h-4 w-4" />
        </button>

        <p className="mb-1 line-clamp-2 text-xs leading-relaxed text-white/55">
          {state.original}
        </p>

        {isLoading && (
          <div className="flex items-center justify-center gap-2 py-1 text-white">
            <LoaderIcon
              className="h-5 w-5 animate-spin text-white"
              style={{ animationDuration: "0.8s" }}
            />
            <span className="text-base font-medium">Translating</span>
          </div>
        )}

        {isError && (
          <div className="flex items-center justify-center gap-2 py-1 text-danger">
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
              <p
                className={`text-lg leading-snug tracking-wide ${
                  hasText ? "font-medium text-white" : "text-white/60"
                }`}
              >
                {mainText}
                {state.kind === "streaming" && hasText && (
                  <span
                    className="ml-0.5 inline-block h-[1em] w-0.5 align-middle bg-white/80 animate-caret-blink"
                    aria-hidden="true"
                  />
                )}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
