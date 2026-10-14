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
  type PositionMetrics,
} from "@/lib/client";
import { SubtitleOverlay } from "./subtitle-overlay";
import { XIcon } from "./icons";

const FALLBACK_SCREEN = { width: 16, height: 10 };
const REFERENCE_WIDTH = 640;
const MEASURE_WIDTH = 800;
const CARD_MAX_HEIGHT = 200;

type PositionPlayerProps = {
  style: SubtitleStyle;
  timing: SubtitleTiming;
  onChange: (style: SubtitleStyle) => void;
};

type PlayState = {
  active: boolean;
  playing: boolean;
  timeMs: number;
  totalMs: number;
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
  onChange: (style: SubtitleStyle) => void;
  aspect: number;
  thumbnail: string | null;
  onDoubleClick?: () => void;
  className?: string;
};

function PositionPreview({
  style,
  onChange,
  aspect,
  thumbnail,
  onDoubleClick,
  className = "",
}: PositionPreviewProps) {
  const { t } = useT();
  const containerRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const [isDragging, setIsDragging] = useState(false);
  const [showGuides, setShowGuides] = useState({ x: false, y: false });
  const [layout, setLayout] = useState({
    containerWidth: 0,
    containerHeight: 0,
    boxWidth: 0,
    boxHeight: 0,
  });

  const ratio = layout.containerWidth > 0 ? layout.containerWidth / REFERENCE_WIDTH : 1;

  useEffect(() => {
    function measure() {
      const container = containerRef.current;
      const box = boxRef.current;
      setLayout({
        containerWidth: container?.clientWidth ?? 0,
        containerHeight: container?.clientHeight ?? 0,
        boxWidth: box?.offsetWidth ?? 0,
        boxHeight: box?.offsetHeight ?? 0,
      });
    }
    measure();
    const ro = new ResizeObserver(measure);
    if (containerRef.current) ro.observe(containerRef.current);
    if (boxRef.current) ro.observe(boxRef.current);
    return () => ro.disconnect();
  }, [style.fontSizePx, style.fontFamily]);

  const updateFromPointer = useCallback(
    (clientX: number, clientY: number) => {
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      let xPct = ((clientX - rect.left) / rect.width) * 100;
      let yPct = ((clientY - rect.top) / rect.height) * 100;
      const guides = { x: false, y: false };

      if (Math.abs(xPct - 50) <= 3) {
        xPct = 50;
        guides.x = true;
      }
      if (Math.abs(yPct - 50) <= 3) {
        yPct = 50;
        guides.y = true;
      }

      if (layout.containerWidth > 0 && layout.boxWidth > 0) {
        const halfW = (layout.boxWidth / (2 * layout.containerWidth)) * 100;
        xPct = Math.max(halfW, Math.min(100 - halfW, xPct));
      } else {
        xPct = Math.max(5, Math.min(95, xPct));
      }

      if (layout.containerHeight > 0 && layout.boxHeight > 0) {
        const halfH = (layout.boxHeight / (2 * layout.containerHeight)) * 100;
        yPct = Math.max(halfH, Math.min(100 - halfH, yPct));
      } else {
        yPct = Math.max(5, Math.min(95, yPct));
      }

      setShowGuides(guides);
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
      setIsDragging(false);
      setShowGuides({ x: false, y: false });
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

  const boxWidth = Math.min(layout.containerWidth * 0.8, 360 * ratio);
  const boxHeight = Math.max(48, 96 * ratio);
  const boxStyle: React.CSSProperties = {
    left: `${style.xPct}%`,
    top: `${style.yPct}%`,
    width: boxWidth,
    height: boxHeight,
    maxWidth: layout.containerWidth * 0.9,
    backgroundColor: hexToRgba(style.bgColor, style.bgOpacity),
    borderRadius: Math.max(8, 16 * ratio),
    border: "1px solid rgba(255,255,255,0.1)",
    transform: "translate(-50%, -50%)",
  };

  return (
    <div
      ref={containerRef}
      className={`relative w-full overflow-hidden rounded-xl border border-card-border select-none ${className}`}
      style={{ ...backgroundStyle, aspectRatio: aspect }}
      onPointerDown={(e) => {
        e.preventDefault();
        draggingRef.current = true;
        setIsDragging(true);
        updateFromPointer(e.clientX, e.clientY);
      }}
      onDoubleClick={onDoubleClick}
      role="application"
      aria-label={t("settings.subtitle.position.drag")}
    >
      {isDragging && showGuides.x && (
        <div className="pointer-events-none absolute top-0 bottom-0 left-1/2 w-px -translate-x-1/2 bg-accent/60" />
      )}
      {isDragging && showGuides.y && (
        <div className="pointer-events-none absolute left-0 right-0 top-1/2 h-px -translate-y-1/2 bg-accent/60" />
      )}
      <div
        ref={boxRef}
        className="absolute cursor-grab shadow-sm active:cursor-grabbing"
        style={boxStyle}
      />
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
  const [thumbnail, setThumbnail] = useState<string | null>(null);
  const [loadingThumbnail, setLoadingThumbnail] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [playState, setPlayState] = useState<PlayState>({
    active: false,
    playing: false,
    timeMs: 0,
    totalMs: 0,
  });
  const [contentHeight, setContentHeight] = useState(0);

  const measureRef = useRef<HTMLDivElement>(null);
  const timeline = useMemo(() => computeTimeline(testText, timing), [testText, timing]);
  const maxScroll = Math.max(0, contentHeight - CARD_MAX_HEIGHT);
  const metrics: PositionMetrics = useMemo(
    () => computeMetrics(testText, timing, maxScroll),
    [testText, timing, maxScroll]
  );

  const mounted = useIsMounted();
  const isDesktopPlayer =
    mounted &&
    typeof window !== "undefined" &&
    !!window.subtrDesktop?.showTestSubtitle &&
    !!window.subtrDesktop?.controlTestPlay;

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

  // Measure the test text height for the scroll-speed metric.
  useEffect(() => {
    function measure() {
      if (measureRef.current) {
        setContentHeight(measureRef.current.scrollHeight);
      }
    }
    measure();
    const ro = new ResizeObserver(measure);
    if (measureRef.current) ro.observe(measureRef.current);
    return () => ro.disconnect();
  }, [testText, style.fontSizePx, style.fontFamily]);

  // Reflect desktop test playback state from the overlay.
  useEffect(() => {
    const bridge = window.subtrDesktop;
    if (!bridge?.onTestPlayState) return;
    return bridge.onTestPlayState((state) => {
      setPlayState({
        active: true,
        playing: state.playing,
        timeMs: state.timeMs,
        totalMs: state.totalMs,
      });
    });
  }, []);

  // Browser fallback clock.
  useEffect(() => {
    if (isDesktopPlayer || !playState.active || !playState.playing) return;
    let raf = 0;
    let last = performance.now();
    function step(now: number) {
      const delta = now - last;
      last = now;
      setPlayState((prev) => {
        if (!prev.active || !prev.playing) return prev;
        const next = Math.min(prev.totalMs, prev.timeMs + delta);
        if (next >= prev.totalMs) {
          return { ...prev, timeMs: prev.totalMs, playing: false, active: false };
        }
        return { ...prev, timeMs: next };
      });
      raf = requestAnimationFrame(step);
    }
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [isDesktopPlayer, playState.active, playState.playing]);

  const totalMs = playState.active ? playState.totalMs : timeline.totalMs;
  const displayTimeMs = Math.min(playState.timeMs, totalMs);

  function handlePlayPause() {
    const trimmed = testText.trim();
    if (!trimmed) return;

    const ended = playState.timeMs >= playState.totalMs;
    const hasSession = playState.active && !ended;

    if (isDesktopPlayer) {
      if (playState.playing) {
        window.subtrDesktop?.controlTestPlay?.({ action: "pause" });
      } else if (hasSession) {
        window.subtrDesktop?.controlTestPlay?.({ action: "play" });
      } else {
        window.subtrDesktop?.showTestSubtitle?.(trimmed);
        window.subtrDesktop?.controlTestPlay?.({ action: "play" });
      }
      return;
    }

    if (playState.playing) {
      setPlayState((prev) => ({ ...prev, playing: false }));
    } else if (hasSession) {
      setPlayState((prev) => ({ ...prev, playing: true }));
    } else {
      setPlayState({
        active: true,
        playing: true,
        timeMs: 0,
        totalMs: timeline.totalMs,
      });
    }
  }

  function handleScrub(value: number) {
    if (isDesktopPlayer) {
      window.subtrDesktop?.controlTestPlay?.({ action: "pause" });
      window.subtrDesktop?.controlTestPlay?.({ action: "seek", timeMs: value });
      return;
    }
    setPlayState({
      active: true,
      playing: false,
      timeMs: Math.max(0, Math.min(timeline.totalMs, value)),
      totalMs: timeline.totalMs,
    });
  }

  const presets = useMemo(
    () => [
      { label: t("settings.position.preset.bottomCenter"), xPct: 50, yPct: 88 },
      { label: t("settings.position.preset.topCenter"), xPct: 50, yPct: 12 },
      { label: t("settings.position.preset.topLeft"), xPct: 12, yPct: 12 },
      { label: t("settings.position.preset.topRight"), xPct: 88, yPct: 12 },
      { label: t("settings.position.preset.bottomLeft"), xPct: 12, yPct: 88 },
      { label: t("settings.position.preset.bottomRight"), xPct: 88, yPct: 88 },
    ],
    [t]
  );

  const hasDesktopCapture =
    mounted &&
    typeof window !== "undefined" &&
    !!window.subtrDesktop?.captureDesktopThumbnail;

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-4 md:flex-row">
        <PositionPreview
          style={style}
          onChange={onChange}
          aspect={aspect}
          thumbnail={thumbnail}
          onDoubleClick={() => {
            if (!isModalOpen) setIsModalOpen(true);
          }}
          className="cursor-pointer self-start md:flex-1"
        />

        <div className="flex flex-col gap-3 md:w-40">
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

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handlePlayPause}
              disabled={!testText.trim()}
              className="inline-flex min-w-[6.5rem] items-center justify-center gap-1.5 rounded-xl border border-card-border bg-background px-3 py-2 text-sm font-medium shadow-sm transition-colors hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50 dark:hover:bg-white/5"
            >
              {playState.playing ? t("settings.position.pause") : t("settings.position.play")}
            </button>
            <span className="text-xs tabular-nums text-muted">
              {t("settings.position.time", {
                current: formatSeconds(displayTimeMs),
                total: formatSeconds(totalMs),
              })}
            </span>
          </div>

          <input
            type="range"
            min={0}
            max={totalMs}
            step={10}
            value={displayTimeMs}
            onChange={(e) => handleScrub(parseFloat(e.target.value))}
            className="w-full accent-accent"
            aria-label={t("settings.position.time", {
              current: formatSeconds(displayTimeMs),
              total: formatSeconds(totalMs),
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

          <div className="grid grid-cols-2 gap-2">
            {presets.map((preset) => (
              <button
                key={preset.label}
                type="button"
                onClick={() => onChange({ ...style, xPct: preset.xPct, yPct: preset.yPct })}
                className="rounded-lg border border-card-border bg-background px-2 py-1.5 text-xs font-medium transition-colors hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent dark:hover:bg-white/5"
              >
                {preset.label}
              </button>
            ))}
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

      {/* Hidden measurement for the scroll-speed metric. */}
      <div
        ref={measureRef}
        aria-hidden="true"
        style={{
          position: "fixed",
          left: -9999,
          top: 0,
          visibility: "hidden",
          pointerEvents: "none",
          width: MEASURE_WIDTH,
          fontFamily: fontFamilyCss(style.fontFamily),
          fontSize: `${style.fontSizePx}px`,
          lineHeight: 1.375,
          whiteSpace: "pre-wrap",
        }}
      >
        {testText}
      </div>

      {isModalOpen && (
        <ModalPreview
          aspect={aspect}
          style={style}
          thumbnail={thumbnail}
          onChange={onChange}
          onClose={() => setIsModalOpen(false)}
        />
      )}

      {!isDesktopPlayer && playState.active && (
        <SubtitleOverlay
          state={{
            kind: "success",
            original: testText.slice(0, 80),
            text: testText,
          }}
          onDismiss={() =>
            setPlayState({ active: false, playing: false, timeMs: 0, totalMs: timeline.totalMs })
          }
          controlledPlay={{
            timeMs: playState.timeMs,
            totalMs: playState.totalMs,
            playing: playState.playing,
          }}
        />
      )}
    </div>
  );
}

type ModalPreviewProps = Omit<PositionPreviewProps, "onDoubleClick" | "className"> & {
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
