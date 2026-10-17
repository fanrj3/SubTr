"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import {
  DEFAULT_THEME,
  isDarkTheme,
  readTheme,
  subscribeTheme,
  usePlugins,
  useT,
} from "@/lib/client";
import { PluginPanelFrame } from "./plugin-panel-frame";

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`h-4 w-4 shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
      aria-hidden="true"
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function PanelGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5" aria-hidden="true">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 9h18" />
      <path d="M8 9v11" />
    </svg>
  );
}

export function HomeWidgets() {
  const { t, effectiveLang } = useT();
  const plugins = usePlugins();
  const theme = useSyncExternalStore(subscribeTheme, readTheme, () => DEFAULT_THEME);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [mounted, setMounted] = useState<Record<string, boolean>>({});

  const widgets = useMemo(() => {
    if (!plugins.data) return [];
    const list: {
      key: string;
      pluginId: string;
      pluginName: string;
      panel: { id: string; title: string; entry: string; location?: "settings" | "home"; visible?: boolean };
    }[] = [];
    for (const plugin of plugins.data.plugins) {
      if (!plugin.enabled || plugin.status !== "ok") continue;
      for (const panel of plugin.panels ?? []) {
        if (panel.location !== "home" || panel.visible === false) continue;
        list.push({
          key: `${plugin.id}:${panel.id}`,
          pluginId: plugin.id,
          pluginName: plugin.name,
          panel,
        });
      }
    }
    return list;
  }, [plugins.data]);

  if (widgets.length === 0) return null;

  const panelTheme = isDarkTheme(theme) ? "dark" : "light";

  function toggle(key: string) {
    setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));
    setMounted((prev) => ({ ...prev, [key]: true }));
  }

  return (
    <div className="mx-auto w-full max-w-[68ch] space-y-2.5 px-4 pb-6 pt-3 sm:px-6">
      <div className="flex items-center gap-2 px-1 pb-0.5">
        <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted">
          {t("home.widgets.title")}
        </span>
        <span className="h-px flex-1 bg-card-border" />
        <span className="text-[10px] tabular-nums text-muted">{widgets.length}</span>
      </div>
      {widgets.map((widget) => {
        const open = !!expanded[widget.key];
        return (
          <div
            key={widget.key}
            className={`overflow-hidden rounded-2xl border bg-card shadow-sm transition-colors ${
              open ? "border-card-border" : "border-card-border/80 hover:border-card-border"
            }`}
          >
            <button
              type="button"
              onClick={() => toggle(widget.key)}
              aria-expanded={open}
              className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-black/[0.035] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent dark:hover:bg-white/[0.04]"
            >
              <span className="flex min-w-0 items-center gap-2.5">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-accent-dim text-accent ring-1 ring-accent/10">
                  <PanelGlyph />
                </span>
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-[13px] font-semibold leading-tight">
                    {widget.panel.title}
                  </span>
                  <span className="truncate text-[10px] font-medium uppercase tracking-[0.08em] text-muted">
                    {widget.pluginName}
                  </span>
                </span>
              </span>
              <span className="flex items-center gap-1.5">
                <span className={`hidden rounded-full px-2 py-0.5 text-[9px] font-semibold sm:inline ${open ? "bg-accent-dim text-accent" : "bg-muted/10 text-muted"}`}>
                  {open ? t("home.widgets.collapse") : t("home.widgets.expand")}
                </span>
                <span className="flex h-6 w-6 items-center justify-center rounded-md text-muted transition-colors">
                  <ChevronIcon open={open} />
                </span>
              </span>
            </button>
            {mounted[widget.key] && (
              <div className={open ? "border-t border-card-border/80 p-3" : "hidden"}>
                <PluginPanelFrame
                  pluginId={widget.pluginId}
                  panel={widget.panel}
                  theme={panelTheme}
                  lang={effectiveLang}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
