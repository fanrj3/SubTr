"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type PluginPanel = {
  id: string;
  title: string;
  entry: string;
  location?: "settings" | "home";
  visible?: boolean;
};

type PluginPanelFrameProps = {
  pluginId: string;
  panel: PluginPanel;
  theme: "light" | "dark";
  lang: "en" | "zh-CN";
  className?: string;
  /** Lower clamp for the reported content height. */
  minHeight?: number;
  /** Upper clamp for the reported content height (preview raises this). */
  maxHeight?: number;
};

function isSafeApiUrl(url: unknown): url is string {
  if (typeof url !== "string") return false;
  if (!url.startsWith("/api/")) return false;
  if (url.includes("..")) return false;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(url)) return false;
  return true;
}

export function PluginPanelFrame({
  pluginId,
  panel,
  theme,
  lang,
  className = "",
  minHeight = 120,
  maxHeight = 720,
}: PluginPanelFrameProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(400);

  const sendInit = useCallback(() => {
    const win = iframeRef.current?.contentWindow;
    if (!win) return;
    win.postMessage({ type: "subtr-plugin-init", theme, lang }, "*");
  }, [theme, lang]);

  useEffect(() => {
    sendInit();
  }, [sendInit]);

  useEffect(() => {
    async function onMessage(event: MessageEvent) {
      const win = iframeRef.current?.contentWindow;
      if (!win || event.source !== win) return;
      const data = event.data as Record<string, unknown> | null;
      if (!data || typeof data.type !== "string") return;

      if (data.type === "subtr-plugin-fetch") {
        const rid = data.rid;
        const url = data.url;
        if (!isSafeApiUrl(url)) return;
        try {
          const res = await fetch(url, { cache: "no-store" });
          const body = await res.text();
          win.postMessage(
            {
              type: "subtr-plugin-fetch-result",
              rid,
              ok: res.ok,
              status: res.status,
              body,
            },
            "*"
          );
        } catch {
          win.postMessage(
            { type: "subtr-plugin-fetch-result", rid, ok: false, status: 0, body: "" },
            "*"
          );
        }
        return;
      }

      if (data.type === "subtr-plugin-resize") {
        const raw = Number(data.height);
        if (!Number.isFinite(raw)) return;
        setHeight(Math.max(minHeight, Math.min(maxHeight, raw)));
      }
    }

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [minHeight, maxHeight]);

  return (
    <div
      className={`subtr-panel-scroll overflow-hidden rounded-xl border border-card-border bg-background ${className}`}
    >
      <iframe
        ref={iframeRef}
        src={`/api/plugins/${encodeURIComponent(pluginId)}/panel/${encodeURIComponent(
          panel.id
        )}`}
        title={panel.title}
        sandbox="allow-scripts"
        onLoad={sendInit}
        style={{ height }}
        className="block w-full"
      />
    </div>
  );
}
