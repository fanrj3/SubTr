"use client";

import { useCallback, useSyncExternalStore } from "react";
import {
  effectiveUILang,
  readUILang,
  subscribeUILang,
  t,
  type TKey,
  type UILang,
} from "./index";

export function useT(): {
  lang: UILang;
  effectiveLang: Exclude<UILang, "system">;
  t: (key: TKey, vars?: Record<string, string | number>) => string;
} {
  const lang = useSyncExternalStore(
    subscribeUILang,
    () => readUILang(),
    // Hydration must be deterministic: resolving "system" here would read the
    // client locale during hydration and mismatch the server HTML. React swaps
    // to the real resolved language immediately after hydration.
    () => "en" as UILang
  );

  const translate = useCallback(
    (key: TKey, vars?: Record<string, string | number>) => t(lang, key, vars),
    [lang]
  );

  return {
    lang,
    effectiveLang: effectiveUILang(lang),
    t: translate,
  };
}
