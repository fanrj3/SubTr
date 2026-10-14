import { readStorage, writeStorage } from "./storage";

export const SUBTITLE_STYLE_KEY = "subtr.subtitleStyle.v1";

const listeners = new Set<() => void>();

export function subscribeSubtitleStyle(callback: () => void): () => void {
  listeners.add(callback);
  function onStorage(e: StorageEvent): void {
    if (e.key === SUBTITLE_STYLE_KEY) callback();
  }
  if (typeof window !== "undefined") {
    window.addEventListener("storage", onStorage);
  }
  return () => {
    listeners.delete(callback);
    if (typeof window !== "undefined") {
      window.removeEventListener("storage", onStorage);
    }
  };
}

function notifySubtitleStyleListeners(): void {
  listeners.forEach((cb) => cb());
}

export function writeSubtitleStyle(style: SubtitleStyle): void {
  writeStorage(SUBTITLE_STYLE_KEY, style);
  notifySubtitleStyleListeners();
}

export function notifySubtitleStyleChanged(): void {
  notifySubtitleStyleListeners();
}

export type SubtitleStyle = {
  xPct: number;
  yPct: number;
  fontFamily: "system" | "serif" | "mono" | "geist";
  fontSizePx: number;
  textColor: string;
  bgColor: string;
  bgOpacity: number;
};

export const DEFAULT_SUBTITLE_STYLE: SubtitleStyle = {
  xPct: 50,
  yPct: 88,
  fontFamily: "system",
  fontSizePx: 18,
  textColor: "#ffffff",
  bgColor: "#0a0a0a",
  bgOpacity: 82,
};

export const FONT_FAMILY_LABELS: Record<SubtitleStyle["fontFamily"], string> = {
  system: "System",
  serif: "Serif",
  mono: "Mono",
  geist: "Geist",
};

let lastStoredStyle: Partial<SubtitleStyle> | undefined;
let lastMergedStyle: SubtitleStyle | undefined;

export function readSubtitleStyle(): SubtitleStyle {
  const stored = readStorage<Partial<SubtitleStyle>>(SUBTITLE_STYLE_KEY, {});
  if (stored === lastStoredStyle && lastMergedStyle) {
    return lastMergedStyle;
  }
  lastStoredStyle = stored;
  lastMergedStyle = { ...DEFAULT_SUBTITLE_STYLE, ...stored };
  return lastMergedStyle;
}

export function fontFamilyCss(fontFamily: SubtitleStyle["fontFamily"]): string {
  switch (fontFamily) {
    case "serif":
      return "Georgia, ui-serif, serif";
    case "mono":
      return "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";
    case "geist":
      return "var(--font-geist-sans), ui-sans-serif, system-ui, sans-serif";
    default:
      return "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
  }
}

export function hexToRgba(hex: string, alphaPct: number): string {
  const clean = hex.replace("#", "");
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  const a = Math.max(0, Math.min(100, alphaPct)) / 100;
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}
