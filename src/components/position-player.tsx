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
  type PositionMetrics,
} from "@/lib/client";
import { SubtitleOverlay } from "./subtitle-overlay";
import { XIcon } from "./icons";

const FALLBACK_SCREEN = { width: 16, height: 10 };
const REFERENCE_WIDTH = 640;

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

function useDisplayAspect(): number {
  const fallback = FALLBACK_SCREEN.width / FALLBACK_SCREEN.height;
  return useSyncExternalStore(
    () => () => {},
    () => {
      if (typeof window === "undefined") return fallback;
      const w = window.screen.width || FALLBACK_SCREEN.width;
      const h = window.screen.height || FALLBACK_SCREEN.height;
      return w / h;
    },
    () => fallback
  );
}

type PositionPreviewProps = {
  style: SubtitleStyle;
  testText: string;
  timeMs: number;
  timing: SubtitleTiming;
  aspect: number;
  thumbnail: string | null;
  onChange: (style: SubtitleStyle) => void;
  onDoubleClick?: () => void;
  onMetricsChange?: (metrics: PositionMetrics) => void;
  className?: string;
};

function PositionPreview({
  style,
  testText,
  timeMs,
  timing,
  aspect,
  thumbnail,
  onChange,
  onDoubleClick,
  onMetricsChange,
  className = "",
}: PositionPreviewProps) {
  const { t } = useT();
  const containerRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const [layout, setLayout] = useState({
    containerWidth: 0,
    containerHeight: 0,
    cardWidth: 0,
    cardHeight: 0,
    viewportHeight: 0,
    contentHeight: 0,
  });

  const timeline = useMemo(() => computeTimeline(testText, timing), [testText, timing]);
  const maxScroll = Math.max(0, layout.contentHeight - layout.viewportHeight);
  const ratio = layout.containerWidth > 0 ? layout.containerWidth / REFERENCE_WIDTH : 1;

  // Measure container, card, and content so the card can be sized and kept inside.
  useEffect(() => {
    function measure() {
      const container = containerRef.current;
      const card = cardRef.current;
      const viewport = viewportRef.current;
      const content = contentRef.current;
      setLayout({
        containerWidth: container?.clientWidth ?? 0,
        containerHeight: container?.clientHeight ?? 0,
        cardWidth: card?.offsetWidth ?? 0,
        cardHeight: card?.offsetHeight ?? 0,
        viewportHeight: viewport?.clientHeight ?? 0,
        contentHeight: content?.scrollHeight ?? 0,
      });
    }
    measure();
    const ro = new ResizeObserver(measure);
    if (containerRef.current) ro.observe(containerRef.current);
    if (cardRef.current) ro.observe(cardRef.current);
    if (viewportRef.current) ro.observe(viewportRef.current);
    if (contentRef.current) ro.observe(contentRef.current);
    return () => ro.disconnect();
  }, [testText, style.fontSizePx, style.fontFamily]);

  // Report live metrics back to the parent.
  useEffect(() => {
    onMetricsChange?.(computeMetrics(testText, timing, maxScroll));
  }, [testText, timing, maxScroll, onMetricsChange]);

  // Sync scroll offset to the current playhead time.
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    viewport.scrollTop = scrollOffsetAtTime(timeMs, timing, timeline.scrollMs, maxScroll);
  }, [timeMs, timing, timeline.scrollMs, maxScroll]);

  const updateFromPointer = useCallback(
    (clientX: number, clientY: number) => {
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      let xPct = ((clientX - rect.left) / rect.width) * 100;
      let yPct = ((clientY - rect.top) / rect.height) * 100;

      if (layout.containerWidth > 0 && layout.cardWidth > 0) {
        const halfW = (layout.cardWidth / (2 * layout.containerWidth)) * 100;
        xPct = Math.max(halfW, Math.min(100 - halfW, xPct));
      } else {
        xPct = Math.max(5, Math.min(95, xPct));
      }

      if (layout.containerHeight > 0 && layout.cardHeight > 0) {
        const halfH = (layout.cardHeight / (2 * layout.containerHeight)) * 100;
        yPct = Math.max(halfH, Math.min(100 - halfH, yPct));
      } else {
        yPct = Math.max(5, Math.min(95, yPct));
      }

      onChange({ ...style, xPct: Math.round(xPct), yPct: Math.round(yPct) });
    },
    [style, onChange, layout]
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

  const cardStyle: React.CSSProperties = {
    left: `${style.xPct}%`,
    top: `${style.yPct}%`,
    maxWidth: layout.containerWidth * 0.9,
    backgroundColor: hexToRgba(style.bgColor, style.bgOpacity),
    color: style.textColor,
    fontFamily: fontFamilyCss(style.fontFamily),
    fontSize: Math.max(8, Math.min(32, style.fontSizePx * ratio)),
    transform: "translate(-50%, -50%)",
    padding: "1em 1.25em",
  };

  return (
    <div
      ref={containerRef}
      className={`relative w-full overflow-hidden rounded-xl border border-card-border select-none ${className}`}
      style={{ ...backgroundStyle, aspectRatio: aspect }}
      onPointerDown={(e) => {
        e.preventDefault();
        draggingRef.current = true;
        updateFromPointer(e.clientX, e.clientY);
      }}
      onDoubleClick={onDoubleClick}
      role="application"
      aria-label={t("settings.subtitle.position.drag")}
    >
      <div
        ref={cardRef}
        className="absolute cursor-grab rounded-2xl shadow-sm active:cursor-grabbing w-max overflow-hidden"
        style={cardStyle}
      >
        <div
          ref={viewportRef}
          className="subtr-scroll overflow-y-auto pr-1 text-left"
          style={{ maxHeight: Math.max(40, 200 * ratio) }}
        >
          <div ref={contentRef} className="whitespace-pre-wrap leading-snug">
            {testText}
          </div>
        </div>
      </div>
    </div>
  );
}

export function PositionPlayer({ style, timing, onChange }: PositionPlayerProps) {
  const { t } = useT();
  const aspect = useDisplayAspect();
  const [testText, setTestText] = useLocalStorage(
    POSITION_TEST_TEXT_KEY,
    DEFAULT_POSITION_TEST_TEXT
  );
  const [timeMs, setTimeMs] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [thumbnail, setThumbnail] = useState<string | null>(null);
  const [loadingThumbnail, setLoadingThumbnail] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [testOverlay, setTestOverlay] = useState(false);
  const [metrics, setMetrics] = useState<PositionMetrics>(() =>
    computeMetrics(testText, timing, 0)
  );

  const timeRef = useRef(0);
  const timeline = useMemo(() => computeTimeline(testText, timing), [testText, timing]);

  // Background capture.
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

  useEffect(() => {
    timeRef.current = timeMs;
  }, [timeMs]);

  const displayTimeMs = Math.min(timeMs, timeline.totalMs);

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

  function handleTest() {
    const trimmed = testText.trim();
    if (!trimmed) return;
    if (typeof window !== "undefined" && window.subtrDesktop?.showTestSubtitle) {
      window.subtrDesktop.showTestSubtitle(trimmed);
    } else {
      setTestOverlay(true);
    }
  }

  const mounted = useIsMounted();
  const hasDesktopCapture =
    mounted &&
    typeof window !== "undefined" &&
    !!window.subtrDesktop?.captureDesktopThumbnail;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <PositionPreview
          style={style}
          testText={testText}
          timeMs={displayTimeMs}
          timing={timing}
          aspect={aspect}
          thumbnail={thumbnail}
          onChange={onChange}
          onDoubleClick={() => {
            if (!isModalOpen) setIsModalOpen(true);
          }}
          onMetricsChange={setMetrics}
          className="cursor-pointer self-start"
        />

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
            <button
              type="button"
              onClick={handleTest}
              disabled={!testText.trim()}
              className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-card-border bg-background px-3 py-2 text-sm font-medium shadow-sm transition-colors hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50 dark:hover:bg-white/5"
            >
              {t("settings.position.test")}
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

      {isModalOpen && (
        <ModalPreview
          aspect={aspect}
          style={style}
          testText={testText}
          timeMs={displayTimeMs}
          timing={timing}
          thumbnail={thumbnail}
          onChange={onChange}
          onClose={() => setIsModalOpen(false)}
        />
      )}

      {testOverlay && (
        <SubtitleOverlay
          state={{ kind: "success", original: testText.slice(0, 80), text: testText }}
          onDismiss={() => setTestOverlay(false)}
        />
      )}
    </div>
  );
}

type ModalPreviewProps = Omit<PositionPreviewProps, "onDoubleClick" | "onMetricsChange" | "className"> & {
  onClose: () => void;
};

function ModalPreview({ onClose, ...previewProps }: ModalPreviewProps) {
  const { t } = useT();

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="relative w-full max-w-[80vw] max-h-[80vh]"
        style={{ aspectRatio: previewProps.aspect }}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute -right-3 -top-3 z-10 flex h-8 w-8 items-center justify-center rounded-full border border-card-border bg-background text-foreground shadow-sm transition-colors hover:bg-black/5 dark:hover:bg-white/5"
          aria-label={t("subtitle.dismiss")}
        >
          <XIcon className="h-4 w-4" />
        </button>
        <PositionPreview
          {...previewProps}
          className="h-full w-full"
        />
      </div>
    </div>
  );
}
