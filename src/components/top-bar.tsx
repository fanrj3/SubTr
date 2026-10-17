"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import {
  DEFAULT_HOTKEY,
  HOTKEY_KEY,
  formatAccel,
  useLocalStorage,
  useT,
} from "@/lib/client";
import { isDesktopMode } from "@/lib/client/desktop";
import { SubTrLogo, SettingsIcon } from "./icons";

const TARGET_LANGUAGES = [
  "auto",
  "中文（简体）",
  "中文（繁體）",
  "English",
  "日本語",
  "한국어",
  "Español",
  "Français",
  "Deutsch",
];

function formatTargetLang(value: string, autoLabel: string): string {
  return value === "auto" ? autoLabel : value;
}

type TopBarProps = {
  mode: boolean;
  onModeChange: (mode: boolean) => void;
  targetLang: string;
  onTargetLangChange: (lang: string) => void;
};

export function TopBar({
  mode,
  onModeChange,
  targetLang,
  onTargetLangChange,
}: TopBarProps) {
  const { t } = useT();
  const desktop = useSyncExternalStore(
    () => () => {},
    () => isDesktopMode(),
    () => false
  );
  const [hotkey] = useLocalStorage<string>(HOTKEY_KEY, DEFAULT_HOTKEY);

  return (
    <header className="sticky top-0 z-30 border-b border-card-border/80 bg-background/75 backdrop-blur-xl supports-[backdrop-filter]:bg-background/60">
      <div className="mx-auto flex min-h-[68px] max-w-[75rem] flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-2.5 sm:px-6">
        <Link
          href="/"
          className="group flex items-center gap-2.5 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          aria-label="SubTr"
        >
          <span className="relative flex h-9 w-9 items-center justify-center rounded-[11px] bg-accent-dim text-accent ring-1 ring-accent/15 transition-transform duration-200 ease-out group-hover:-rotate-3">
            <SubTrLogo className="h-[19px] w-[19px]" />
          </span>
          <span className="flex flex-col leading-none">
            <span className="text-[17px] font-semibold tracking-[-0.02em]">SubTr</span>
            <span className="mt-0.5 hidden text-[9px] font-medium uppercase tracking-[0.16em] text-muted sm:block">
              subtitle translation
            </span>
          </span>
        </Link>

        <div className="flex flex-wrap items-center justify-end gap-1.5 sm:gap-2">
          {desktop && (
            <span
              title={t("settings.app.hotkey")}
              className="hidden items-center gap-1.5 rounded-lg border border-card-border bg-card/60 px-2 py-1 text-[10px] font-medium text-muted md:inline-flex"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-success/80" />
              <kbd className="font-sans text-[10px] font-semibold tracking-wide text-foreground/80">
                {formatAccel(hotkey)}
              </kbd>
            </span>
          )}

          <div className="flex h-9 items-center gap-2 rounded-xl border border-card-border bg-card p-1 shadow-sm">
            <span className="hidden select-none pl-2 text-[11px] font-medium text-muted lg:inline">
              {t("topBar.translate")}
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={mode}
              onClick={() => onModeChange(!mode)}
              className={`relative inline-flex h-7 w-[46px] items-center rounded-lg transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                mode ? "bg-accent" : "bg-muted/35"
              }`}
              aria-label={mode ? t("topBar.translateOn") : t("topBar.translateOff")}
              suppressHydrationWarning
            >
              <span
                className={`inline-block h-5 w-5 rounded-md bg-white shadow-sm transition-transform duration-200 ease-out ${
                  mode ? "translate-x-[21px]" : "translate-x-1"
                }`}
              />
            </button>
            <span
              className={`flex items-center gap-1 pr-2 text-[11px] font-semibold tracking-wide ${
                mode ? "text-accent" : "text-muted"
              }`}
              suppressHydrationWarning
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  mode ? "animate-pulse-dot bg-accent" : "bg-muted/60"
                }`}
              />
              {mode ? t("topBar.on") : t("topBar.off")}
            </span>
          </div>

          <div className="flex h-9 items-center gap-1.5 rounded-xl border border-card-border bg-card p-1 pl-2.5 shadow-sm">
            <span className="hidden select-none text-[11px] font-medium text-muted sm:inline">
              {t("topBar.translateTo")}
            </span>
            <select
              value={targetLang}
              onChange={(e) => onTargetLangChange(e.target.value)}
              aria-label={t("topBar.translateTo")}
              className="h-7 max-w-[8.5rem] cursor-pointer rounded-lg border-0 bg-transparent px-1.5 text-[12px] font-medium outline-none transition-colors hover:bg-black/[0.04] focus-visible:ring-2 focus-visible:ring-accent dark:hover:bg-white/5 sm:px-2"
              suppressHydrationWarning
            >
              {TARGET_LANGUAGES.map((lang) => (
                <option key={lang} value={lang}>
                  {formatTargetLang(lang, t("topBar.auto"))}
                </option>
              ))}
            </select>
          </div>

          <Link
            href="/settings"
            className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-card-border bg-card px-2.5 text-[12px] font-medium shadow-sm transition-colors hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent dark:hover:bg-white/5 sm:px-3"
          >
            <SettingsIcon className="h-4 w-4" />
            <span className="hidden sm:inline">{t("topBar.settings")}</span>
          </Link>
        </div>
      </div>
    </header>
  );
}
