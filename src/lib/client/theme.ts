export const THEME_KEY = "subtr.theme.v1";

export type Theme = "system" | "light" | "dark";

export const DEFAULT_THEME: Theme = "system";

const listeners = new Set<() => void>();

export function subscribeTheme(callback: () => void): () => void {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

function notifyThemeListeners(): void {
  listeners.forEach((cb) => cb());
}

function parseStoredTheme(stored: string | null): Theme {
  if (stored === null) return DEFAULT_THEME;
  if (stored === "light" || stored === "dark" || stored === "system") return stored;
  try {
    const parsed = JSON.parse(stored);
    if (parsed === "light" || parsed === "dark" || parsed === "system") return parsed;
  } catch {
    // Fall through to default.
  }
  return DEFAULT_THEME;
}

export function readTheme(): Theme {
  if (typeof window === "undefined") return DEFAULT_THEME;
  try {
    return parseStoredTheme(window.localStorage.getItem(THEME_KEY));
  } catch {
    return DEFAULT_THEME;
  }
}

export function writeTheme(theme: Theme): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(THEME_KEY, theme);
    notifyThemeListeners();
  } catch {
    // Ignore storage errors.
  }
}

export function isSystemDark(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function isDarkTheme(theme: Theme): boolean {
  return theme === "dark" || (theme === "system" && isSystemDark());
}

export function applyTheme(theme: Theme): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const dark = isDarkTheme(theme);
  root.classList.toggle("dark", dark);
  root.classList.toggle("light", theme === "light");
  root.style.colorScheme = dark ? "dark" : "light";
}

export function getInitialThemeScript(): string {
  return `
    (function() {
      try {
        const key = ${JSON.stringify(THEME_KEY)};
        const stored = localStorage.getItem(key);
        var theme = "system";
        if (stored === "light" || stored === "dark" || stored === "system") {
          theme = stored;
        } else if (stored) {
          try {
            var parsed = JSON.parse(stored);
            if (parsed === "light" || parsed === "dark" || parsed === "system") theme = parsed;
          } catch (e) {}
        }
        const systemDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
        const isDark = theme === "dark" || (theme === "system" && systemDark);
        document.documentElement.classList.toggle("dark", isDark);
        document.documentElement.classList.toggle("light", theme === "light");
        document.documentElement.style.colorScheme = isDark ? "dark" : "light";
      } catch (e) {}
    })();
  `;
}
