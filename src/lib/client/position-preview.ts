import { getTextMetrics } from "./translation-utils";
import type { SubtitleTiming } from "./subtitle-timing";

export const POSITION_TEST_TEXT_KEY = "subtr.positionTestText.v1";

export const DEFAULT_POSITION_TEST_TEXT =
  'Preview this scrolling subtitle in the mini player. 这段预览文字会模拟真实字幕的滚动节奏：先停留、再滚动、最后停留。You can pause, scrub, and watch how position, font, and colors look in motion.';

export type PositionTimeline = {
  readMs: number;
  scaledReadMs: number;
  scrollMs: number;
  totalMs: number;
  latinWords: number;
  cjkChars: number;
};

export function computeReadMs(text: string): number {
  const { latinWords, cjkChars } = getTextMetrics(text);
  const minMs = cjkChars === 0 ? 1000 : 1500;
  return Math.max(minMs, latinWords * (60000 / 220) + cjkChars * (60000 / 400));
}

export function computeTimeline(
  text: string,
  timing: SubtitleTiming
): PositionTimeline {
  const { latinWords, cjkChars } = getTextMetrics(text);
  const readMs = computeReadMs(text);
  const scaledReadMs = readMs * timing.textScale;
  const scrollMs = Math.max(timing.minDisplayMs, scaledReadMs);
  const totalMs = timing.initialHoldMs + scrollMs + timing.finalHoldMs;
  return { readMs, scaledReadMs, scrollMs, totalMs, latinWords, cjkChars };
}

export function scrollOffsetAtTime(
  timeMs: number,
  timing: SubtitleTiming,
  scrollMs: number,
  maxScroll: number
): number {
  if (timeMs <= timing.initialHoldMs) return 0;
  if (timeMs >= timing.initialHoldMs + scrollMs) return maxScroll;
  const progress =
    (timeMs - timing.initialHoldMs) / scrollMs;
  return progress * maxScroll;
}

export type PositionMetrics = {
  totalSeconds: number;
  scrollSpeedPxPerS: number;
  wpm: number;
  cpm: number;
};

export function computeMetrics(
  text: string,
  timing: SubtitleTiming,
  maxScrollPx: number
): PositionMetrics {
  const { scaledReadMs, scrollMs, totalMs, latinWords, cjkChars } =
    computeTimeline(text, timing);
  const totalSeconds = totalMs / 1000;
  const scrollSpeedPxPerS =
    scrollMs > 0 ? maxScrollPx / (scrollMs / 1000) : 0;
  const wpm =
    scaledReadMs > 0 ? Math.round((latinWords / scaledReadMs) * 60000) : 0;
  const cpm =
    scaledReadMs > 0 ? Math.round((cjkChars / scaledReadMs) * 60000) : 0;
  return { totalSeconds, scrollSpeedPxPerS, wpm, cpm };
}
