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
    <div className="mx-auto w-full max-w-[65ch] space-y-2 px-6 pb-4 pt-2">
      {widgets.map((widget) => {
        const open = !!expanded[widget.key];
        return (
          <div
            key={widget.key}
            className="overflow-hidden rounded-xl border border-card-border bg-card shadow-sm"
          >
            <button
              type="button"
              onClick={() => toggle(widget.key)}
              aria-expanded={open}
              className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left transition-colors hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent dark:hover:bg-white/5"
            >
              <span className="flex min-w-0 items-baseline gap-2">
                <span className="truncate text-sm font-medium">{widget.panel.title}</span>
                <span className="truncate text-xs text-muted">{widget.pluginName}</span>
              </span>
              <ChevronIcon open={open} />
              <span className="sr-only">
                {open ? t("home.widgets.collapse") : t("home.widgets.expand")}
              </span>
            </button>
            {mounted[widget.key] && (
              <div className={open ? "border-t border-card-border p-3" : "hidden"}>
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
