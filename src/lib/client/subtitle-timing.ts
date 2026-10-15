import { readStorage, writeStorage } from "./storage";

export const SUBTITLE_TIMING_KEY = "subtr.subtitleTiming.v1";

export type SubtitleTiming = {
  initialHoldMs: number;
  minDisplayMs: number;
  textScale: number;
  finalHoldMs: number;
};

export const DEFAULT_SUBTITLE_TIMING: SubtitleTiming = {
  initialHoldMs: 4000,
  minDisplayMs: 8000,
  textScale: 1.0,
  finalHoldMs: 1800,
};

export function readSubtitleTiming(): SubtitleTiming {
  return { ...DEFAULT_SUBTITLE_TIMING, ...readStorage<Partial<SubtitleTiming>>(SUBTITLE_TIMING_KEY, {}) };
}

export function writeSubtitleTiming(timing: SubtitleTiming): void {
  writeStorage(SUBTITLE_TIMING_KEY, timing);
}

export type ReadingPace = "slow" | "normal" | "fast";

// Pace is a SPEED factor: higher = faster scroll. Slow < 1 < Fast.
export const READING_PACE_SCALE: Record<ReadingPace, number> = {
  slow: 0.7,
  normal: 1.0,
  fast: 1.4,
};

export function paceFromScale(scale: number): ReadingPace {
  if (scale >= 1.2) return "fast";
  if (scale <= 0.85) return "slow";
  return "normal";
}
