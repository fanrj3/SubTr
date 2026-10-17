"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type MutableRefObject } from "react";
import {
  XIcon,
  LoaderIcon,
  AlertIcon,
  CheckIcon,
  LockIcon,
  CopyIcon,
  InsertIcon,
  OpenWindowIcon,
} from "./icons";
import { getTextMetrics, useT } from "@/lib/client";
import { isDesktopMode } from "@/lib/client/desktop";
import { isMac } from "@/lib/client/hotkey";
import {
  fontFamilyCss,
  readSubtitleStyle,
  readSubtitleTiming,
  subscribeSubtitleStyle,
  writeSubtitleStyle,
  FONT_FAMILY_LABELS,
  DEFAULT_SUBTITLE_STYLE,
  computeTimeline,
  scrollOffsetAtTime,
  type SubtitleStyle,
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

/** Text that copy/insert actions should use for the current card. */
function getActionText(state: SubtitleState): string {
  if (state.kind === "streaming" || state.kind === "success") return state.text.trim();
  if (state.kind === "dictionary") {
    return [state.original, state.phonetic ?? "", ...state.senses]
      .filter((part) => part.trim().length > 0)
      .join("\n");
  }
  return "";
}

/** Write text to the clipboard (with a legacy fallback for non-secure contexts). */
async function writeClipboardText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const el = document.createElement("textarea");
      el.value = text;
      el.setAttribute("readonly", "");
      el.style.position = "fixed";
      el.style.opacity = "0";
      el.style.pointerEvents = "none";
      document.body.appendChild(el);
      el.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(el);
      return ok;
    } catch {
      return false;
    }
  }
}

function isEditableElement(el: Element | null): el is HTMLElement {
  if (!el) return false;
  if (el instanceof HTMLInputElement) return true;
  if (el instanceof HTMLTextAreaElement) return true;
  return el instanceof HTMLElement && el.isContentEditable;
}

/** Replace the current selection in a text field with `text` (in-app fallback). */
function insertIntoEditable(el: HTMLElement | null, text: string): boolean {
  if (!isEditableElement(el)) return false;
  el.focus();
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? start;
    el.setRangeText(text, start, end, "end");
    el.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  }
  try {
    return document.execCommand("insertText", false, text);
  } catch {
    return false;
  }
}

const TEXT_COLORS = [
  "#ffffff",
  "#fef3c7",
  "#bfdbfe",
  "#fecaca",
  "#bbf7d0",
  "#e9d5ff",
  "#111827",
];

const MENU_WIDTH = 252;
const MENU_HEIGHT = 372;

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
  const [hovered, setHovered] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [toast, setToast] = useState<{
    text: string;
    kind: "ok" | "info" | "error";
  } | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const lastSpaceAtRef = useRef(0);
  const lastEditableRef = useRef<HTMLElement | null>(null);
  const modLabel = isMac() ? "⌘" : "Ctrl";

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

  const showToast = useCallback(
    (text: string, kind: "ok" | "info" | "error" = "ok", duration = 1700) => {
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
      setToast({ text, kind });
      toastTimerRef.current = window.setTimeout(() => {
        toastTimerRef.current = null;
        setToast(null);
      }, duration);
    },
    []
  );

  function patchStyle(patch: Partial<SubtitleStyle>) {
    writeSubtitleStyle({ ...readSubtitleStyle(), ...patch });
  }

  async function copyAction() {
    const text = getActionText(state);
    if (!text) {
      showToast(t("subtitle.copyFailed"), "error");
      return;
    }
    if (isDesktopMode()) {
      window.subtrDesktop?.overlayAction?.("copy");
      return;
    }
    const ok = await writeClipboardText(text);
    showToast(ok ? t("subtitle.copied") : t("subtitle.copyFailed"), ok ? "ok" : "error");
  }

  function insertAction() {
    const text = getActionText(state);
    if (!text) {
      showToast(t("subtitle.insertFailed"), "error");
      return;
    }
    if (isDesktopMode()) {
      window.subtrDesktop?.overlayAction?.("insert");
      return;
    }
    const ok = insertIntoEditable(lastEditableRef.current, text);
    showToast(ok ? t("subtitle.inserted") : t("subtitle.insertFailed"), ok ? "ok" : "error");
  }

  function openMenu(event: React.MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    if (!pinned) pin(false);
    onRequestInteractive?.(true);
    const maxX = Math.max(12, window.innerWidth - MENU_WIDTH - 12);
    const maxY = Math.max(12, window.innerHeight - MENU_HEIGHT - 12);
    setMenu({
      x: Math.max(12, Math.min(event.clientX, maxX)),
      y: Math.max(12, Math.min(event.clientY, maxY)),
    });
  }

  // Report click-through state: interactive while hovering the card or its menu.
  useEffect(() => {
    onRequestInteractive?.(hovered || !!menu);
  }, [hovered, menu, onRequestInteractive]);

  // Track the last editable field so the in-app (browser) insert can restore it
  // after the subtitle card steals focus.
  useEffect(() => {
    function onFocusIn(event: FocusEvent) {
      if (isEditableElement(event.target as Element)) {
        lastEditableRef.current = event.target as HTMLElement;
      }
    }
    document.addEventListener("focusin", onFocusIn);
    return () => document.removeEventListener("focusin", onFocusIn);
  }, []);

  // Desktop: report the action payload so main can arm global ⌘C / ⌘I / Space
  // only while the pinned card is being hovered.
  const actionText = getActionText(state);
  const actionCanInsert =
    !isVoice &&
    !isPlugin &&
    (state.kind === "success" || state.kind === "streaming") &&
    actionText.length > 0;
  useEffect(() => {
    if (!isDesktopMode()) return;
    window.subtrDesktop?.overlayActions?.({
      pinned,
      hovered,
      menuOpen: !!menu,
      canInsert: actionCanInsert,
      text: actionText,
    });
  }, [pinned, hovered, menu, actionCanInsert, actionText]);

  // Disarm global shortcuts as soon as the card starts fading / unmounts.
  useEffect(() => {
    if (!isDesktopMode()) return;
    if (!(isExiting || voiceStopping || pluginStopping)) return;
    window.subtrDesktop?.overlayActions?.({
      pinned: false,
      hovered: false,
      menuOpen: false,
      canInsert: false,
      text: "",
    });
  }, [isExiting, voiceStopping, pluginStopping]);

  useEffect(() => {
    return () => {
      if (!isDesktopMode()) return;
      window.subtrDesktop?.overlayActions?.({
        pinned: false,
        hovered: false,
        menuOpen: false,
        canInsert: false,
        text: "",
      });
    };
  }, []);

  // Desktop: main reports the result of the global shortcut (toast feedback).
  useEffect(() => {
    if (!isDesktopMode()) return;
    const bridge = window.subtrDesktop;
    return bridge?.onOverlayActionResult?.((payload) => {
      if (payload.action === "copy") {
        showToast(
          payload.ok ? t("subtitle.copied") : t("subtitle.copyFailed"),
          payload.ok ? "ok" : "error"
        );
      } else if (payload.action === "insert") {
        showToast(
          payload.ok ? t("subtitle.inserted") : t("subtitle.insertFailed"),
          payload.ok ? "ok" : "error"
        );
      } else if (payload.action === "space-first") {
        showToast(t("subtitle.spaceFirst"), "info", 1200);
      }
    });
  }, [showToast, t]);

  // In-app (browser) keyboard actions while pinned and hovering the card.
  useEffect(() => {
    if (isDesktopMode() || !pinned || !(hovered || menu)) return;

    function onKeyDown(event: KeyboardEvent) {
      const mod = event.metaKey || event.ctrlKey;
      if (mod && !event.shiftKey && event.key.toLowerCase() === "c") {
        const selection = document.getSelection()?.toString().trim();
        if (selection) return; // copy the user's own selection normally
        event.preventDefault();
        void copyAction();
        return;
      }
      if (mod && !event.shiftKey && event.key.toLowerCase() === "i") {
        event.preventDefault();
        insertAction();
        return;
      }
      if (event.key === " " && !mod && !event.repeat) {
        const active = document.activeElement;
        if (active?.closest?.("[data-subtr-overlay]")) return;
        event.preventDefault();
        const now = Date.now();
        if (now - lastSpaceAtRef.current <= 480) {
          lastSpaceAtRef.current = 0;
          insertAction();
        } else {
          lastSpaceAtRef.current = now;
          showToast(t("subtitle.spaceFirst"), "info", 1200);
        }
      }
    }

    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
    // copyAction/insertAction intentionally read the latest render state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pinned, hovered, menu, state, showToast, t]);

  // Close the context menu on an outside click or Escape.
  useEffect(() => {
    if (!menu) return;
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Element | null;
      if (target?.closest?.("[data-subtr-menu]")) return;
      setMenu(null);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setMenu(null);
    }
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [menu]);

  // Clear a pending toast timer on unmount.
  useEffect(() => {
    return () => {
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    };
  }, []);

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
        className={`group pointer-events-auto relative w-full rounded-[22px] border px-5 py-4 text-center shadow-[0_24px_64px_-16px_rgba(0,0,0,0.55)] ring-1 ring-black/5 backdrop-blur-xl transition-all duration-200 animate-subtitle-in ${
          pinned
            ? "border-accent/40 ring-2 ring-accent/15"
            : "border-white/10 hover:border-white/20"
        } ${testMode?.enabled ? "cursor-grab active:cursor-grabbing" : ""}`}
        style={{
          backgroundColor: cardBackground,
          color: style.textColor,
          fontFamily: fontFamilyCss(style.fontFamily),
          fontSize: `${style.fontSizePx}px`,
        }}
        onPointerDown={(e) => {
          if (isEditableElement(document.activeElement)) {
            lastEditableRef.current = document.activeElement as HTMLElement;
          }
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
        onContextMenu={openMenu}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
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

        {!testMode?.enabled && actionText.length > 0 && (
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              void copyAction();
            }}
            title={t("subtitle.copy")}
            className="absolute right-9 top-2 rounded-lg p-1.5 opacity-70 transition-all hover:bg-white/10 hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
            style={{ color: dimmedColor }}
            aria-label={t("subtitle.copy")}
          >
            <CopyIcon className="h-4 w-4" />
          </button>
        )}

        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            handleDismiss();
          }}
          className="absolute right-2 top-2 rounded-lg p-1.5 opacity-70 transition-all hover:bg-white/10 hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
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

        {pinned && !menu && !isVoice && !isPlugin && actionText.length > 0 && (
          <div
            className="mt-2.5 flex flex-wrap items-center justify-center gap-x-2.5 gap-y-1 pr-1 text-[10px] font-medium leading-none tracking-wide"
            style={{ color: dimmedColor }}
          >
            <span className="inline-flex items-center gap-1">
              <kbd className="rounded-[5px] border border-white/15 bg-white/10 px-1 py-0.5 text-[9px] font-semibold">
                {modLabel}C
              </kbd>
              {t("subtitle.copy")}
            </span>
            <span className="opacity-30">·</span>
            <span className="inline-flex items-center gap-1">
              <kbd className="rounded-[5px] border border-white/15 bg-white/10 px-1 py-0.5 text-[9px] font-semibold">
                {modLabel}I
              </kbd>
              {t("subtitle.insert")}
            </span>
            <span className="opacity-30">·</span>
            <span className="inline-flex items-center gap-1">
              <kbd className="rounded-[5px] border border-white/15 bg-white/10 px-1 py-0.5 text-[9px] font-semibold">
                Space ×2
              </kbd>
              {t("subtitle.insert")}
            </span>
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

      {menu && (
        <div
          data-subtr-menu
          role="menu"
          aria-label={t("subtitle.menu.title")}
          className="pointer-events-auto fixed z-[60] w-[252px] animate-menu-in overflow-hidden rounded-2xl border border-white/10 bg-[#17151b]/95 p-2.5 text-white shadow-[0_24px_64px_-12px_rgba(0,0,0,0.65)] backdrop-blur-2xl"
          style={{ left: menu.x, top: menu.y }}
          onPointerDown={(e) => e.stopPropagation()}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          onContextMenu={(e) => e.preventDefault()}
        >
          <div className="flex items-center justify-between px-1 pb-2">
            <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/45">
              {t("subtitle.menu.title")}
            </span>
            <button
              type="button"
              onClick={() =>
                patchStyle({
                  fontFamily: DEFAULT_SUBTITLE_STYLE.fontFamily,
                  fontSizePx: DEFAULT_SUBTITLE_STYLE.fontSizePx,
                  textColor: DEFAULT_SUBTITLE_STYLE.textColor,
                })
              }
              className="rounded-md px-1.5 py-0.5 text-[10px] font-medium text-white/45 transition-colors hover:bg-white/10 hover:text-white/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              {t("subtitle.menu.reset")}
            </button>
          </div>

          <div className="space-y-2.5">
            <div>
              <div className="mb-1 px-1 text-[10px] font-medium text-white/45">
                {t("subtitle.menu.size")}
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => patchStyle({ fontSizePx: Math.max(12, style.fontSizePx - 1) })}
                  className="flex h-7 w-8 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-xs font-semibold transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  aria-label="Smaller text"
                >
                  A−
                </button>
                <div className="flex-1 text-center text-xs font-semibold tabular-nums text-white/80">
                  {style.fontSizePx}px
                </div>
                <button
                  type="button"
                  onClick={() => patchStyle({ fontSizePx: Math.min(32, style.fontSizePx + 1) })}
                  className="flex h-7 w-8 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-xs font-semibold transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  aria-label="Larger text"
                >
                  A+
                </button>
              </div>
            </div>

            <div>
              <div className="mb-1 px-1 text-[10px] font-medium text-white/45">
                {t("subtitle.menu.color")}
              </div>
              <div className="flex items-center gap-1.5 px-0.5">
                {TEXT_COLORS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    onClick={() => patchStyle({ textColor: color })}
                    aria-label={color}
                    aria-pressed={style.textColor.toLowerCase() === color.toLowerCase()}
                    className={`h-5 w-5 rounded-full border transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                      style.textColor.toLowerCase() === color.toLowerCase()
                        ? "border-white ring-2 ring-accent"
                        : "border-white/25"
                    }`}
                    style={{ backgroundColor: color }}
                  />
                ))}
                <label
                  title={t("subtitle.menu.customColor")}
                  className="relative ml-auto flex h-5 w-5 cursor-pointer items-center justify-center overflow-hidden rounded-full border border-white/25 bg-white/10"
                >
                  <span className="text-[10px] leading-none text-white/70">+</span>
                  <input
                    type="color"
                    value={style.textColor}
                    onChange={(e) => patchStyle({ textColor: e.target.value })}
                    className="absolute inset-0 cursor-pointer opacity-0"
                    aria-label={t("subtitle.menu.customColor")}
                  />
                </label>
              </div>
            </div>

            <div>
              <div className="mb-1 px-1 text-[10px] font-medium text-white/45">
                {t("subtitle.menu.font")}
              </div>
              <div className="grid grid-cols-2 gap-1">
                {(Object.keys(FONT_FAMILY_LABELS) as SubtitleStyle["fontFamily"][]).map((family) => (
                  <button
                    key={family}
                    type="button"
                    onClick={() => patchStyle({ fontFamily: family })}
                    aria-pressed={style.fontFamily === family}
                    className={`h-7 rounded-lg border text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                      style.fontFamily === family
                        ? "border-accent/50 bg-accent/20 text-white"
                        : "border-white/10 bg-white/5 text-white/65 hover:bg-white/10"
                    }`}
                    style={{ fontFamily: fontFamilyCss(family) }}
                  >
                    {FONT_FAMILY_LABELS[family]}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="my-2 h-px bg-white/10" />

          <div className="space-y-0.5">
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setMenu(null);
                void copyAction();
              }}
              className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs font-medium text-white/80 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <CopyIcon className="h-3.5 w-3.5 opacity-70" />
              {t("subtitle.menu.copy")}
              <kbd className="ml-auto rounded border border-white/10 bg-white/5 px-1 py-0.5 text-[9px] font-semibold text-white/45">
                {modLabel}C
              </kbd>
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setMenu(null);
                insertAction();
              }}
              className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs font-medium text-white/80 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <InsertIcon className="h-3.5 w-3.5 opacity-70" />
              {t("subtitle.menu.insert")}
              <kbd className="ml-auto rounded border border-white/10 bg-white/5 px-1 py-0.5 text-[9px] font-semibold text-white/45">
                {modLabel}I
              </kbd>
            </button>
            {isDesktopMode() && (
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenu(null);
                  window.subtrDesktop?.openMainWindow?.();
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs font-medium text-white/80 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <OpenWindowIcon className="h-3.5 w-3.5 opacity-70" />
                {t("subtitle.menu.open")}
              </button>
            )}
          </div>
        </div>
      )}

      {toast && (
        <div
          role="status"
          aria-live="polite"
          className={`pointer-events-none fixed left-1/2 top-6 z-[70] inline-flex animate-toast-in -translate-x-1/2 items-center gap-2 rounded-full border px-4 py-2 text-xs font-medium shadow-[0_16px_48px_-12px_rgba(0,0,0,0.5)] backdrop-blur-xl ${
            toast.kind === "error"
              ? "border-danger/30 bg-[#1b1114]/95 text-red-300"
              : "border-white/10 bg-[#17151b]/95 text-white"
          }`}
        >
          {toast.kind === "ok" ? (
            <CheckIcon className="h-3.5 w-3.5 text-emerald-400" />
          ) : toast.kind === "error" ? (
            <AlertIcon className="h-3.5 w-3.5" />
          ) : (
            <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
          )}
          {toast.text}
        </div>
      )}
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
