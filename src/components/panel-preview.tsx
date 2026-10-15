"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  DEFAULT_THEME,
  DEFAULT_UI_LANG,
  applyUILang,
  effectiveUILang,
  readTheme,
  readUILang,
  subscribeTheme,
  subscribeUILang,
  usePlugins,
  useT,
  type PluginInfo,
} from "@/lib/client";
import {
  AlertIcon,
  ArrowLeftIcon,
  LoaderIcon,
  PanelIcon,
  RefreshIcon,
} from "./icons";
import { PluginPanelFrame } from "./plugin-panel-frame";

type PanelWidth = "narrow" | "medium" | "full";
type PreviewTheme = "light" | "dark";
type PreviewThemeMode = "follow" | PreviewTheme;

const WIDTH_PX: Record<PanelWidth, number | undefined> = {
  narrow: 360,
  medium: 560,
  full: undefined,
};

/**
 * Owns the preview chrome: the language (always follows the app) and the
 * previewed theme. The theme defaults to the app's current theme but can be
 * overridden live from the header — the override is page-local and never writes
 * to the stored app theme.
 */
function usePreviewChrome() {
  const rawTheme = useSyncExternalStore(
    subscribeTheme,
    () => readTheme(),
    () => DEFAULT_THEME
  );
  const lang = useSyncExternalStore(
    subscribeUILang,
    () => readUILang(),
    () => DEFAULT_UI_LANG
  );
  const [systemDark, setSystemDark] = useState(false);
  const [mode, setMode] = useState<PreviewThemeMode>("follow");

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => setSystemDark(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  const appTheme: PreviewTheme =
    rawTheme === "system" ? (systemDark ? "dark" : "light") : rawTheme;
  const theme: PreviewTheme = mode === "follow" ? appTheme : mode;

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", theme === "dark");
    root.classList.toggle("light", theme === "light");
    root.style.colorScheme = theme;
  }, [theme]);

  useEffect(() => {
    applyUILang(lang);
  }, [lang]);

  return {
    theme,
    mode,
    setMode,
    panelLang: effectiveUILang(lang),
  };
}

function findPanel(plugin: PluginInfo, panelId: string) {
  return plugin.panels?.find((panel) => panel.id === panelId);
}

export function PanelPreview({
  pluginId,
  panelId,
}: {
  pluginId: string;
  panelId: string;
}) {
  const { t } = useT();
  const plugins = usePlugins();
  const { theme, mode, setMode, panelLang } = usePreviewChrome();
  const [width, setWidth] = useState<PanelWidth>("full");
  const [frameKey, setFrameKey] = useState(0);

  const reload = useCallback(() => {
    setFrameKey((key) => key + 1);
    void plugins.refresh();
  }, [plugins]);

  const plugin = plugins.data?.plugins.find((entry) => entry.id === pluginId);
  const panel = plugin ? findPanel(plugin, panelId) : undefined;
  const ready =
    !!plugin && plugin.enabled && plugin.status === "ok" && !!panel;

  const loading = plugins.loading && !plugins.data;
  const failure = plugin && plugin.status === "error" ? plugin.error : null;

  const themeOptions: { value: PreviewThemeMode; label: string }[] = [
    { value: "follow", label: t("panelPreview.theme.follow") },
    { value: "light", label: t("settings.app.theme.light") },
    { value: "dark", label: t("settings.app.theme.dark") },
  ];

  const widthOptions: { value: PanelWidth; label: string }[] = [
    { value: "narrow", label: t("panelPreview.width.narrow") },
    { value: "medium", label: t("panelPreview.width.medium") },
    { value: "full", label: t("panelPreview.width.full") },
  ];

  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <header className="sticky top-0 z-30 border-b border-card-border bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex min-h-14 min-w-0 max-w-5xl flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2 sm:px-6">
          <Link
            href="/settings"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-medium text-muted transition-colors hover:bg-black/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent dark:hover:bg-white/5"
          >
            <ArrowLeftIcon className="h-4 w-4" />
            <span className="hidden sm:inline">{t("panelPreview.back")}</span>
          </Link>

          <div className="hidden h-5 w-px shrink-0 bg-card-border sm:block" aria-hidden />

          <div className="flex min-w-0 flex-1 items-center gap-2">
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-accent-dim text-accent">
              <PanelIcon className="h-3.5 w-3.5" />
            </span>
            <div className="min-w-0">
              <h1 className="truncate text-sm font-semibold tracking-tight">
                {panel?.title ?? plugin?.name ?? t("panelPreview.title")}
              </h1>
              <p className="truncate text-[11px] text-muted">
                {plugin ? (
                  <>
                    {plugin.name} · {t("settings.plugins.version", { n: plugin.version })}
                  </>
                ) : (
                  t("panelPreview.loading")
                )}
              </p>
            </div>
          </div>

          <div className="flex min-w-0 basis-full flex-wrap items-center gap-2 sm:basis-auto">
            <div
              role="group"
              aria-label={t("panelPreview.themeLabel")}
              className="flex items-center gap-0.5 rounded-lg border border-card-border bg-background p-0.5"
            >
              {themeOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={mode === option.value}
                  onClick={() => setMode(option.value)}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                    mode === option.value
                      ? "bg-accent text-white"
                      : "text-muted hover:bg-black/5 dark:hover:bg-white/5"
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>

            <div
              role="group"
              aria-label={t("panelPreview.widthLabel")}
              className="flex items-center gap-0.5 rounded-lg border border-card-border bg-background p-0.5"
            >
              {widthOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={width === option.value}
                  onClick={() => setWidth(option.value)}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                    width === option.value
                      ? "bg-accent text-white"
                      : "text-muted hover:bg-black/5 dark:hover:bg-white/5"
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={reload}
              className="inline-flex items-center gap-1.5 rounded-lg border border-card-border bg-background px-3 py-1.5 text-xs font-medium transition-colors hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent dark:hover:bg-white/5"
            >
              <RefreshIcon className="h-3.5 w-3.5" />
              {t("panelPreview.reload")}
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 sm:px-6">
        {loading ? (
          <PreviewNotice
            icon={<LoaderIcon className="h-4 w-4" />}
            title={t("panelPreview.loading")}
          />
        ) : !ready ? (
          <PreviewNotice
            tone="danger"
            icon={<AlertIcon className="h-4 w-4" />}
            title={failure ? t("panelPreview.loadError") : t("panelPreview.notFound")}
            description={failure ?? t("panelPreview.notFoundHint")}
          />
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2 px-1">
              <h2 className="text-[11px] font-medium uppercase tracking-wide text-muted">
                {t("panelPreview.previewLabel")}
              </h2>
              <p className="hidden text-[11px] text-muted sm:block">
                {t("panelPreview.freshHint")}
              </p>
            </div>

            <div
              className="mx-auto w-full transition-[max-width] duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none"
              style={{ maxWidth: WIDTH_PX[width] }}
            >
              <PluginPanelFrame
                key={frameKey}
                pluginId={pluginId}
                panel={panel}
                theme={theme}
                lang={panelLang}
                minHeight={200}
                maxHeight={2000}
              />
            </div>

            <dl className="flex flex-wrap gap-x-5 gap-y-1 px-1 text-[11px] text-muted">
              <div className="flex items-center gap-1.5">
                <dt>{t("panelPreview.pluginId")}</dt>
                <dd className="font-mono text-foreground/80">{pluginId}</dd>
              </div>
              <div className="flex items-center gap-1.5">
                <dt>{t("panelPreview.panelId")}</dt>
                <dd className="font-mono text-foreground/80">{panelId}</dd>
              </div>
              <div className="flex items-center gap-1.5">
                <dt>{t("panelPreview.entry")}</dt>
                <dd className="font-mono text-foreground/80">{panel.entry}</dd>
              </div>
            </dl>
          </div>
        )}
      </main>
    </div>
  );
}

function PreviewNotice({
  icon,
  title,
  description,
  tone = "muted",
}: {
  icon: ReactNode;
  title: string;
  description?: string;
  tone?: "muted" | "danger";
}) {
  return (
    <div
      className={`flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed px-6 py-16 text-center ${
        tone === "danger"
          ? "border-danger/30 bg-danger-soft/40"
          : "border-card-border bg-card"
      }`}
    >
      <span
        className={`grid h-9 w-9 place-items-center rounded-full ${
          tone === "danger" ? "bg-danger-soft text-danger" : "bg-muted/10 text-muted"
        }`}
      >
        {icon}
      </span>
      <h2 className="text-sm font-semibold">{title}</h2>
      {description && (
        <p className="max-w-md text-xs leading-relaxed text-muted">{description}</p>
      )}
    </div>
  );
}
