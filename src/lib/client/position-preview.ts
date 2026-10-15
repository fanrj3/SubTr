import { getTextMetrics } from "./translation-utils";
import type { SubtitleTiming } from "./subtitle-timing";

export const POSITION_TEST_TEXT_KEY = "subtr.positionTestText.v1";

export const DEFAULT_POSITION_TEST_TEXT =
  'The night train slipped out of the station while the city was still asleep, carrying its small constellation of passengers toward the coast. In the dining car, an old conductor poured tea and told stories about the towns that had vanished beneath the reservoir. 列车穿过沉睡的城市，窗外的灯火像散落的星子一样向后流去。A student copied equations into a notebook, a nurse listened to music with her eyes closed, and a painter sketched the moon through the glass. Somewhere past the third bridge, the rain began, soft at first, then steady, drumming on the roof like a patient hand. They spoke of weather, of work, of the people waiting at the far end of the line, and the long hours did not feel long at all. By dawn the sea appeared, pale and enormous, and everyone fell quiet, as if the journey had been leading to that single silver line all along. The conductor smiled, collected the cups, and said that every arrival is also a beginning.';

export const OLD_POSITION_TEST_TEXT =
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
  timing: SubtitleTiming
): PositionMetrics {
  const { scaledReadMs, totalMs, latinWords, cjkChars } =
    computeTimeline(text, timing);
  const totalSeconds = totalMs / 1000;
  // Displayed teleprompter speed: 1.00× = 3 px/s baseline, scaled linearly.
  const scrollSpeedPxPerS = 3 * timing.textScale;
  const wpm =
    scaledReadMs > 0 ? Math.round((latinWords / scaledReadMs) * 60000) : 0;
  const cpm =
    scaledReadMs > 0 ? Math.round((cjkChars / scaledReadMs) * 60000) : 0;
  return { totalSeconds, scrollSpeedPxPerS, wpm, cpm };
}
