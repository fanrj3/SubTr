const CJK_RANGES = [
  [0x4e00, 0x9fff], // CJK Unified Ideographs
  [0x3400, 0x4dbf], // CJK Extension A
  [0x3040, 0x309f], // Hiragana
  [0x30a0, 0x30ff], // Katakana
  [0xac00, 0xd7af], // Hangul Syllables
  [0x3130, 0x318f], // Hangul Jamo
];

function isCjkChar(code: number): boolean {
  return CJK_RANGES.some(([start, end]) => code >= start && code <= end);
}

export type TextMetrics = {
  latinWords: number;
  cjkChars: number;
};

export function getTextMetrics(text: string): TextMetrics {
  const trimmed = text.trim();
  if (trimmed.length === 0) return { latinWords: 0, cjkChars: 0 };

  const latinWords = trimmed
    .split(/\s+/)
    .filter((segment) => segment.length > 0 && /[a-zA-Z]/.test(segment)).length;

  const cjkChars = Array.from(trimmed).filter((ch) =>
    isCjkChar(ch.codePointAt(0) ?? 0)
  ).length;

  return { latinWords, cjkChars };
}

/**
 * Heuristic word count that handles both Latin-space-separated words and CJK
 * characters. Latin words are counted as-is; CJK characters are counted as
 * roughly half a "word".
 */
export function countWords(text: string): number {
  const { latinWords, cjkChars } = getTextMetrics(text);
  return Math.round(latinWords + cjkChars / 2);
}

/**
 * Returns true when more than half of the meaningful characters are CJK.
 */
export function isMostlyCjk(text: string): boolean {
  const chars = Array.from(text.trim());
  if (chars.length === 0) return false;
  const cjkCount = chars.filter((ch) => isCjkChar(ch.codePointAt(0) ?? 0)).length;
  return cjkCount / chars.length > 0.5;
}

/**
 * Resolve the target language for a selection.
 * - If the stored target is not "auto", return it.
 * - If "auto": mostly-CJK text → English; otherwise → 中文（简体）.
 */
export function resolveTargetLang(text: string, storedTargetLang: string): string {
  if (storedTargetLang !== "auto") return storedTargetLang;
  return isMostlyCjk(text) ? "English" : "中文（简体）";
}
