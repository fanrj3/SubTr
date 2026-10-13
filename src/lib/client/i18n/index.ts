export const UI_LANG_KEY = "subtr.uiLang.v1";

export type UILang = "system" | "zh-CN" | "en";

export const DEFAULT_UI_LANG: UILang = "system";

export { en } from "./en";
export { zhCN } from "./zh-CN";

import { en } from "./en";
import { zhCN } from "./zh-CN";

const listeners = new Set<() => void>();

export function subscribeUILang(callback: () => void): () => void {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

function notifyUILangListeners(): void {
  listeners.forEach((cb) => cb());
}

export function resolveSystemLang(): Exclude<UILang, "system"> {
  // Deterministic during SSR: Node >= 21 exposes a global `navigator`, which would
  // otherwise leak the server's locale into the markup and cause hydration mismatches.
  // The client resolves the real system language (and swaps in after hydration).
  if (typeof window === "undefined") return "en";
  return navigator.language.startsWith("zh") ? "zh-CN" : "en";
}

export function effectiveUILang(lang: UILang): Exclude<UILang, "system"> {
  return lang === "system" ? resolveSystemLang() : lang;
}

export function readUILang(): UILang {
  if (typeof window === "undefined") return DEFAULT_UI_LANG;
  try {
    const stored = window.localStorage.getItem(UI_LANG_KEY);
    if (stored === "system" || stored === "zh-CN" || stored === "en") return stored;
    try {
      const parsed = JSON.parse(stored ?? "");
      if (parsed === "system" || parsed === "zh-CN" || parsed === "en") return parsed;
    } catch {
      // Ignore parse errors.
    }
  } catch {
    // Ignore storage errors.
  }
  return DEFAULT_UI_LANG;
}

export function writeUILang(lang: UILang): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(UI_LANG_KEY, lang);
    notifyUILangListeners();
  } catch {
    // Ignore storage errors.
  }
}

export function applyUILang(lang: UILang): void {
  if (typeof document === "undefined") return;
  document.documentElement.lang = effectiveUILang(lang);
}

export function getInitialUILangScript(): string {
  return `
    (function() {
      try {
        const key = ${JSON.stringify(UI_LANG_KEY)};
        const stored = localStorage.getItem(key);
        var lang = "system";
        if (stored === "system" || stored === "zh-CN" || stored === "en") {
          lang = stored;
        } else if (stored) {
          try {
            var parsed = JSON.parse(stored);
            if (parsed === "system" || parsed === "zh-CN" || parsed === "en") lang = parsed;
          } catch (e) {}
        }
        var effective = lang === "system" ? (navigator.language.startsWith("zh") ? "zh-CN" : "en") : lang;
        document.documentElement.lang = effective;
      } catch (e) {}
    })();
  `;
}

export type TKey = keyof typeof en;

const flatEn = en as Record<string, string>;
const flatZhCN = zhCN as Record<string, string>;

export function t(
  lang: UILang,
  key: TKey,
  vars?: Record<string, string | number>
): string {
  const flat = effectiveUILang(lang) === "zh-CN" ? flatZhCN : flatEn;
  let str = flat[key as string] ?? flatEn[key as string] ?? (key as string);
  if (vars) {
    str = str.replace(/\{(\w+)\}/g, (_, name) => String(vars[name] ?? `{${name}}`));
  }
  return str;
}
