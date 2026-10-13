"use client";

import Link from "next/link";
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

function formatTargetLang(value: string): string {
  return value === "auto" ? "Auto" : value;
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
  return (
    <header className="sticky top-0 z-30 border-b border-card-border bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-[75rem] items-center justify-between px-4 sm:px-6">
        <div className="flex items-center gap-2.5">
          <SubTrLogo className="h-7 w-7 text-foreground" />
          <span className="text-xl font-semibold tracking-tight">SubTr</span>
        </div>

        <div className="flex items-center gap-2 sm:gap-4">
          <div className="flex items-center gap-2 rounded-xl border border-card-border bg-card p-1 shadow-sm">
            <span className="hidden pl-2 text-sm text-muted sm:inline">Translate</span>
            <button
              type="button"
              onClick={() => onModeChange(!mode)}
              aria-pressed={mode}
              className={`relative inline-flex h-7 w-12 items-center rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                mode ? "bg-accent" : "bg-muted/40"
              }`}
              aria-label={mode ? "Translation on" : "Translation off"}
              suppressHydrationWarning
            >
              <span
                className={`inline-block h-5 w-5 rounded-md bg-white shadow-sm transition-transform ${
                  mode ? "translate-x-6" : "translate-x-1"
                }`}
              />
            </button>
            <span
              className={`pr-2 text-sm font-medium ${
                mode ? "text-accent" : "text-muted"
              }`}
              suppressHydrationWarning
            >
              {mode ? "ON" : "OFF"}
            </span>
          </div>

          <div className="flex items-center gap-2 rounded-xl border border-card-border bg-card p-1 shadow-sm">
            <span className="hidden pl-2 text-sm text-muted sm:inline">Translate to</span>
            <select
              value={targetLang}
              onChange={(e) => onTargetLangChange(e.target.value)}
              aria-label="Target language"
              className="h-7 rounded-lg border-0 bg-transparent px-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-accent sm:px-3"
              suppressHydrationWarning
            >
              {TARGET_LANGUAGES.map((lang) => (
                <option key={lang} value={lang}>
                  {formatTargetLang(lang)}
                </option>
              ))}
            </select>
          </div>

          <Link
            href="/settings"
            className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-card-border bg-card px-3 text-sm font-medium shadow-sm transition-colors hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent dark:hover:bg-white/5"
          >
            <SettingsIcon className="h-4 w-4" />
            <span className="hidden sm:inline">Settings</span>
          </Link>
        </div>
      </div>
    </header>
  );
}
