/**
 * Backwards-compatible re-exports. The heuristics now live in
 * `src/lib/language.ts` so the server can share them without importing client
 * code.
 */
export {
  countWords,
  getTextMetrics,
  hasCjk,
  hasLatin,
  isCjkChar,
  isEchoOutput,
  isMostlyCjk,
  normalizeForEchoCompare,
  resolveTargetLang,
  scriptProfile,
  shouldRetryEcho,
  type ScriptProfile,
  type TextMetrics,
} from "@/lib/language";
