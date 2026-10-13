"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  useLocalStorage,
  useT,
  hexToRgba,
  fontFamilyCss,
  type SubtitleStyle,
  type SubtitleTiming,
  POSITION_TEST_TEXT_KEY,
  DEFAULT_POSITION_TEST_TEXT,
  computeTimeline,
  computeMetrics,
  scrollOffsetAtTime,
} from "@/lib/client";

type PositionPlayerProps = {
  style: SubtitleStyle;
  timing: SubtitleTiming;
  onChange: (style: SubtitleStyle) => void;
};

function formatSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

function useIsMounted(): boolean {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );
}

export function PositionPlayer({ style, timing, onChange }: PositionPlayerProps) {
  const { t } = useT();
  const [testText, setTestText] = useLocalStorage(
    POSITION_TEST_TEXT_KEY,
    DEFAULT_POSITION_TEST_TEXT
  );
  const [timeMs, setTimeMs] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [thumbnail, setThumbnail] = useState<string | null>(null);
  const [loadingThumbnail, setLoadingThumbnail] = useState(false);
  const [sizes, setSizes] = useState({
    viewportHeight: 0,
    contentHeight: 0,
    containerHeight: 0,
  });

  const containerRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const timeRef = useRef(0);

  const timeline = useMemo(
    () => computeTimeline(testText, timing),
    [testText, timing]
  );
  const maxScroll = Math.max(0, sizes.contentHeight - sizes.viewportHeight);

  // Background capture (mirrors the old PositionCanvas behavior).
  const capture = useCallback(async () => {
    if (typeof window === "undefined") return;
    const bridge = window.subtrDesktop;
    if (!bridge?.captureDesktopThumbnail) return;
    setLoadingThumbnail(true);
    try {
      const dataUrl = await bridge.captureDesktopThumbnail();
      setThumbnail(dataUrl);
    } finally {
      setLoadingThumbnail(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    capture();
  }, [capture]);

  // Keep the time ref in sync for the animation loop.
  useEffect(() => {
    timeRef.current = timeMs;
  }, [timeMs]);

  // Measure the mini viewport and content so we know how much scroll room exists.
  useEffect(() => {
    function measure() {
      const viewport = viewportRef.current;
      const content = contentRef.current;
      const container = containerRef.current;
      setSizes({
        viewportHeight: viewport?.clientHeight ?? 0,
        contentHeight: content?.scrollHeight ?? 0,
        containerHeight: container?.clientHeight ?? 0,
      });
    }
    measure();
    const ro = new ResizeObserver(measure);
    if (viewportRef.current) ro.observe(viewportRef.current);
    if (contentRef.current) ro.observe(contentRef.current);
    if (containerRef.current) ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [testText, style.fontSizePx, style.fontFamily]);

  const displayTimeMs = Math.min(timeMs, timeline.totalMs);

  // Sync the mini subtitle scroll offset to the current playhead time.
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const offset = scrollOffsetAtTime(displayTimeMs, timing, timeline.scrollMs, maxScroll);
    viewport.scrollTop = offset;
  }, [displayTimeMs, timing, timeline.scrollMs, maxScroll]);

  // Playback loop.
  useEffect(() => {
    if (!isPlaying) return;
    let raf = 0;
    let last = performance.now();
    function step(now: number) {
      const delta = now - last;
      last = now;
      const next = Math.min(timeline.totalMs, timeRef.current + delta);
      timeRef.current = next;
      setTimeMs(next);
      if (next >= timeline.totalMs) {
        setIsPlaying(false);
        return;
      }
      raf = requestAnimationFrame(step);
    }
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [isPlaying, timeline.totalMs]);

  // Drag the mini card to set position.
  const updateFromPointer = useCallback(
    (clientX: number, clientY: number) => {
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const xPct = Math.round(
        Math.max(5, Math.min(95, ((clientX - rect.left) / rect.width) * 100))
      );
      const yPct = Math.round(
        Math.max(5, Math.min(95, ((clientY - rect.top) / rect.height) * 100))
      );
      onChange({ ...style, xPct, yPct });
    },
    [style, onChange]
  );

  useEffect(() => {
    function onMove(e: PointerEvent) {
      if (!draggingRef.current) return;
      updateFromPointer(e.clientX, e.clientY);
    }
    function onUp() {
      draggingRef.current = false;
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [updateFromPointer]);

  const backgroundStyle: React.CSSProperties = thumbnail
    ? {
        backgroundImage: `url(${thumbnail})`,
        backgroundSize: "cover",
        backgroundPosition: "center",
      }
    : {
        backgroundImage:
          "linear-gradient(135deg, rgba(120,113,108,0.25) 0%, rgba(68,64,60,0.35) 50%, rgba(41,37,36,0.45) 100%)",
      };

  const cardMaxHeight = Math.max(80, sizes.containerHeight * 0.5);
  // The scroll viewport needs a DEFINITE max-height in px: a percentage inside the
  // auto-height card resolves to none, so the content would be clipped (not scrolled).
  const viewportMaxHeight = Math.max(32, cardMaxHeight - 32); // minus py-4 (2 x 16px)

  const cardStyle: React.CSSProperties = {
    left: `${style.xPct}%`,
    top: `${style.yPct}%`,
    backgroundColor: hexToRgba(style.bgColor, style.bgOpacity),
    color: style.textColor,
    fontFamily: fontFamilyCss(style.fontFamily),
    fontSize: Math.max(10, Math.min(16, style.fontSizePx * 0.6)),
    maxHeight: cardMaxHeight,
  };

  const metrics = useMemo(
    () => computeMetrics(testText, timing, maxScroll),
    [testText, timing, maxScroll]
  );

  function handlePlayPause() {
    if (timeMs >= timeline.totalMs) {
      setTimeMs(0);
      setIsPlaying(true);
    } else {
      setIsPlaying((p) => !p);
    }
  }

  function handleScrub(value: number) {
    setIsPlaying(false);
    setTimeMs(Math.max(0, Math.min(timeline.totalMs, value)));
  }

  function handleScrubStart() {
    setIsPlaying(false);
  }

  const mounted = useIsMounted();
  const hasDesktopCapture =
    mounted &&
    typeof window !== "undefined" &&
    !!window.subtrDesktop?.captureDesktopThumbnail;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {/* Mini player / drag canvas */}
        <div
          ref={containerRef}
          className="relative h-48 w-full overflow-hidden rounded-xl border border-card-border"
          style={backgroundStyle}
          onPointerDown={(e) => {
            draggingRef.current = true;
            updateFromPointer(e.clientX, e.clientY);
          }}
          role="application"
          aria-label={t("settings.subtitle.position.drag")}
        >
          <div
            className="absolute -translate-x-1/2 -translate-y-1/2 cursor-grab rounded-2xl px-5 py-4 shadow-sm active:cursor-grabbing w-max max-w-[90%] overflow-hidden"
            style={cardStyle}
          >
            <div
              ref={viewportRef}
              className="subtr-scroll overflow-y-auto pr-1 text-left"
              style={{ maxHeight: viewportMaxHeight }}
            >
              <div ref={contentRef} className="whitespace-pre-wrap leading-snug">
                {testText}
              </div>
            </div>
          </div>
        </div>

        {/* Controls and metrics */}
        <div className="flex flex-col gap-3">
          <div className="space-y-1.5">
            <label
              htmlFor="position-test-text"
              className="block text-sm font-medium"
            >
              {t("settings.position.testText")}
            </label>
            <textarea
              id="position-test-text"
              rows={3}
              value={testText}
              onChange={(e) => setTestText(e.target.value)}
              className="w-full resize-none rounded-xl border border-card-border bg-background px-3 py-2 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent"
            />
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={handlePlayPause}
              className="inline-flex min-w-[6.5rem] items-center justify-center gap-1.5 rounded-xl border border-card-border bg-background px-3 py-2 text-sm font-medium shadow-sm transition-colors hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent dark:hover:bg-white/5"
            >
              {isPlaying ? t("settings.position.pause") : t("settings.position.play")}
            </button>
            <span className="text-xs tabular-nums text-muted">
              {t("settings.position.time", {
                current: formatSeconds(displayTimeMs),
                total: formatSeconds(timeline.totalMs),
              })}
            </span>
          </div>

          <input
            type="range"
            min={0}
            max={timeline.totalMs}
            step={10}
            value={displayTimeMs}
            onPointerDown={handleScrubStart}
            onChange={(e) => handleScrub(parseFloat(e.target.value))}
            className="w-full accent-accent"
            aria-label={t("settings.position.time", {
              current: formatSeconds(displayTimeMs),
              total: formatSeconds(timeline.totalMs),
            })}
          />

          <div className="grid grid-cols-2 gap-2 rounded-xl border border-card-border bg-background p-3 text-xs">
            <div>
              <p className="text-muted">{t("settings.position.totalTime")}</p>
              <p className="font-medium tabular-nums">
                {formatSeconds(metrics.totalSeconds * 1000)}
              </p>
            </div>
            <div>
              <p className="text-muted">{t("settings.position.scrollSpeed")}</p>
              <p className="font-medium tabular-nums">
                {Math.round(metrics.scrollSpeedPxPerS)} px/s
              </p>
            </div>
            <div className="col-span-2">
              <p className="text-muted">{t("settings.position.readingSpeed")}</p>
              <p className="font-medium tabular-nums">
                {metrics.wpm > 0 && t("settings.position.wpm", { n: metrics.wpm })}
                {metrics.wpm > 0 && metrics.cpm > 0 && " · "}
                {metrics.cpm > 0 && t("settings.position.cpm", { n: metrics.cpm })}
                {metrics.wpm === 0 && metrics.cpm === 0 && "—"}
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[10px] text-muted">
          {t("settings.subtitle.position.drag")}
        </p>
        {hasDesktopCapture ? (
          <button
            type="button"
            onClick={capture}
            disabled={loadingThumbnail}
            className="text-[10px] text-muted underline-offset-2 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
          >
            {loadingThumbnail
              ? t("settings.subtitle.position.refreshing")
              : thumbnail
                ? t("settings.subtitle.position.refresh")
                : t("settings.subtitle.position.capture")}
          </button>
        ) : (
          <span className="text-[10px] text-muted">
            {t("settings.subtitle.position.placeholder")}
          </span>
        )}
      </div>
    </div>
  );
}
