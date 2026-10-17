/**
 * Language/script heuristics shared by the client and the server.
 *
 * These helpers stay dependency-free and browser-safe so the same rules decide
 * the Auto target on the client, build the prompt on the server, and detect an
 * echoed ("already in the target language") response after streaming.
 */

const CJK_RANGES: Array<[number, number]> = [
  [0x4e00, 0x9fff], // CJK Unified Ideographs
  [0x3400, 0x4dbf], // CJK Extension A
  [0x3040, 0x309f], // Hiragana
  [0x30a0, 0x30ff], // Katakana
  [0xac00, 0xd7af], // Hangul Syllables
  [0x3130, 0x318f], // Hangul Jamo
];

export function isCjkChar(code: number): boolean {
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

export type ScriptProfile = {
  /** CJK ideographs / kana / hangul. */
  cjkChars: number;
  /** Latin letters (a–z, A–Z). */
  latinLetters: number;
  /** Any other Unicode letter (Cyrillic, Arabic, accents-only scripts…). */
  otherLetters: number;
  /** cjkChars / (cjkChars + latinLetters), 0 when there are no letters. */
  cjkRatio: number;
};

/** Count meaningful letters, ignoring whitespace, punctuation, digits and emoji. */
export function scriptProfile(text: string): ScriptProfile {
  let cjkChars = 0;
  let latinLetters = 0;
  let otherLetters = 0;

  for (const ch of text.normalize("NFKC")) {
    const code = ch.codePointAt(0) ?? 0;
    if (isCjkChar(code)) {
      cjkChars += 1;
      continue;
    }
    if ((code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a)) {
      latinLetters += 1;
      continue;
    }
    if (/\p{L}/u.test(ch)) otherLetters += 1;
  }

  const total = cjkChars + latinLetters;
  return {
    cjkChars,
    latinLetters,
    otherLetters,
    cjkRatio: total > 0 ? cjkChars / total : 0,
  };
}

/**
 * True when CJK characters dominate the *letters* in the text. Punctuation,
 * whitespace, numbers and emoji are ignored, so a Chinese paragraph with an
 * English product name or a URL still counts as Chinese.
 *
 * A 40% floor is used once there are at least four CJK characters: mixed
 * Chinese/English UI copy ("使用 React 和 TypeScript 开发…") is still primarily
 * Chinese even when the Latin share is ~35–45%.
 */
export function isMostlyCjk(text: string): boolean {
  const profile = scriptProfile(text);
  if (profile.cjkChars === 0) return false;
  if (profile.latinLetters === 0) return true;
  const threshold = profile.cjkChars >= 4 ? 0.4 : 0.5;
  return profile.cjkRatio >= threshold;
}

/** True when the text contains at least one CJK character. */
export function hasCjk(text: string): boolean {
  return scriptProfile(text).cjkChars > 0;
}

/** True when the text contains at least one Latin letter. */
export function hasLatin(text: string): boolean {
  return scriptProfile(text).latinLetters > 0;
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

/** Normalize text for echo comparison: case, width, whitespace/punctuation. */
export function normalizeForEchoCompare(text: string): string {
  return text
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, "");
}

/** True when `output` is effectively the same text as `source`. */
export function isEchoOutput(source: string, output: string): boolean {
  const a = normalizeForEchoCompare(source);
  const b = normalizeForEchoCompare(output);
  if (!a || !b) return false;
  if (a === b) return true;
  // The model occasionally wraps the whole source in a prefix/suffix such as
  // “翻译如下：…”. Equality of the meaningful content still counts as an echo.
  return b.length >= a.length * 0.9 && (b.includes(a) || a.includes(b));
}

/**
 * Decide whether an identical-looking output should be retried with a stronger
 * "you must translate" prompt. Only when the target script/language clearly
 * differs from the source script, so translating into the source language on
 * purpose (English→English) is never flagged.
 */
export function shouldRetryEcho(
  source: string,
  targetLang: string,
  output: string
): boolean {
  if (!isEchoOutput(source, output)) return false;

  const target = targetLang.trim().toLocaleLowerCase();
  const looksEnglish = /english|español|spanish|français|french|deutsch|german|italiano|português|portuguese|nederlands|russian|русский/.test(
    target
  );
  const looksCjk = /中文|汉语|漢語|chinese|日本語|日语|japanese|한국어|korean/.test(target);

  if (looksEnglish) {
    // Echoing Chinese/Japanese/Korean source back is the classic bug.
    return isMostlyCjk(source);
  }
  if (looksCjk) {
    return hasLatin(source) && !hasCjk(source);
  }
  return false;
}
