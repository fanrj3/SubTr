"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useT } from "@/lib/client";
import {
  hostFromBaseURL,
  isPluginCapability,
  type PluginCapability,
  type PluginInfo,
  type PluginsResponse,
  type TKey,
} from "@/lib/client";
import { LoaderIcon } from "./icons";

type PluginsSectionProps = {
  data: PluginsResponse | null;
  loading: boolean;
  theme: "light" | "dark";
  lang: "en" | "zh-CN";
  onToggle: (
    id: string,
    enabled: boolean,
    grantedCapabilities?: string[]
  ) => Promise<boolean>;
};

function isSafeApiUrl(url: unknown): url is string {
  if (typeof url !== "string") return false;
  if (!url.startsWith("/api/")) return false;
  if (url.includes("..")) return false;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(url)) return false;
  return true;
}

type PluginPanelProps = {
  pluginId: string;
  panel: { id: string; title: string; entry: string };
  theme: "light" | "dark";
  lang: "en" | "zh-CN";
};

function PluginPanel({ pluginId, panel, theme, lang }: PluginPanelProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(400);

  const sendInit = useCallback(() => {
    const win = iframeRef.current?.contentWindow;
    if (!win) return;
    win.postMessage({ type: "subtr-plugin-init", theme, lang }, "*");
  }, [theme, lang]);

  // (a) parent → iframe on load and on theme/lang change.
  useEffect(() => {
    sendInit();
  }, [sendInit]);

  // (b) iframe → parent bridge.
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
        setHeight(Math.max(120, Math.min(720, raw)));
      }
    }

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  return (
    <iframe
      ref={iframeRef}
      src={`/api/plugins/${encodeURIComponent(pluginId)}/panel/${encodeURIComponent(
        panel.id
      )}`}
      title={panel.title}
      sandbox="allow-scripts"
      onLoad={sendInit}
      style={{ height }}
      className="w-full rounded-xl border border-card-border bg-background"
    />
  );
}

function capabilityLabel(
  capability: PluginCapability,
  t: (key: TKey) => string
): string {
  switch (capability) {
    case "translate.transformInput":
      return t("settings.plugins.capability.transformInput");
    case "translate.transformOutput":
      return t("settings.plugins.capability.transformOutput");
    case "dictionary.source":
      return t("settings.plugins.capability.dictionarySource");
    case "ui.panel":
      return t("settings.plugins.capability.uiPanel");
  }
}

function statusClasses(status: PluginInfo["status"]): string {
  switch (status) {
    case "ok":
      return "bg-success-soft text-success";
    case "error":
      return "bg-danger-soft text-danger";
    case "incompatible":
      return "bg-danger-soft text-danger";
    default:
      return "bg-muted/10 text-muted";
  }
}

export function PluginsSection({
  data,
  loading,
  theme,
  lang,
  onToggle,
}: PluginsSectionProps) {
  const { t } = useT();
  const [consentPlugin, setConsentPlugin] = useState<PluginInfo | null>(null);
  const [granted, setGranted] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!consentPlugin) return;
    const next: Record<string, boolean> = {};
    for (const capability of consentPlugin.capabilities) {
      next[capability] = true;
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setGranted(next);
    setError(null);
  }, [consentPlugin]);

  function requestEnable(plugin: PluginInfo) {
    setConsentPlugin(plugin);
  }

  async function confirmEnable() {
    if (!consentPlugin) return;
    setBusy(true);
    setError(null);
    const grantedCapabilities = consentPlugin.capabilities.filter(
      (capability) => granted[capability]
    );
    const ok = await onToggle(consentPlugin.id, true, grantedCapabilities);
    setBusy(false);
    if (ok) {
      setConsentPlugin(null);
    } else {
      setError(t("settings.plugins.error.toggle"));
    }
  }

  async function disable(plugin: PluginInfo) {
    setBusy(true);
    setError(null);
    const ok = await onToggle(plugin.id, false);
    setBusy(false);
    if (!ok) setError(t("settings.plugins.error.toggle"));
  }

  async function copyDir() {
    if (!data?.dir) return;
    try {
      await navigator.clipboard.writeText(data.dir);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard may be unavailable; ignore.
    }
  }

  return (
    <section className="rounded-2xl border border-card-border bg-card p-5 shadow-sm">
      <h2 className="mb-4 text-base font-semibold tracking-tight">
        {t("settings.plugins.title")}
      </h2>

      {loading && !data ? (
        <div className="flex items-center gap-2 text-sm text-muted">
          <LoaderIcon className="h-4 w-4" />
          {t("settings.app.config.working")}
        </div>
      ) : !data || data.plugins.length === 0 ? (
        <div className="space-y-2">
          <p className="text-sm text-muted">{t("settings.plugins.empty")}</p>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted">{t("settings.plugins.folder")}</span>
            <code className="rounded-md bg-background px-2 py-1 font-mono text-xs">
              {data?.dir ?? "—"}
            </code>
            <button
              type="button"
              onClick={() => void copyDir()}
              className="rounded-md border border-card-border bg-background px-2 py-1 text-xs transition-colors hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent dark:hover:bg-white/5"
            >
              {copied ? t("settings.plugins.copied") : t("settings.plugins.copy")}
            </button>
          </div>
          <p className="text-xs text-muted">{t("settings.plugins.folderHint")}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {data.plugins.map((plugin) => (
            <div
              key={plugin.id}
              className="rounded-xl border border-card-border bg-background p-3"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{plugin.name}</span>
                    <span className="text-xs text-muted">
                      {t("settings.plugins.version", { n: plugin.version })}
                    </span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${statusClasses(
                        plugin.status
                      )}`}
                    >
                      {t(`settings.plugins.status.${plugin.status}`)}
                    </span>
                  </div>
                  {plugin.author && (
                    <p className="mt-0.5 text-xs text-muted">
                      {t("settings.plugins.by", { author: plugin.author })}
                      {plugin.homepage && (
                        <>
                          {" · "}
                          <a
                            href={plugin.homepage}
                            target="_blank"
                            rel="noreferrer"
                            className="underline underline-offset-2 hover:text-foreground"
                          >
                            {plugin.homepage}
                          </a>
                        </>
                      )}
                    </p>
                  )}
                </div>

                <button
                  type="button"
                  disabled={
                    busy ||
                    plugin.status === "error" ||
                    plugin.status === "incompatible"
                  }
                  onClick={() =>
                    plugin.enabled ? void disable(plugin) : requestEnable(plugin)
                  }
                  aria-pressed={plugin.enabled}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50 ${
                    plugin.enabled
                      ? "bg-accent text-white hover:bg-accent/90"
                      : "border border-card-border bg-background hover:bg-black/5 dark:hover:bg-white/5"
                  }`}
                >
                  {plugin.enabled
                    ? t("settings.plugins.disable")
                    : t("settings.plugins.enable")}
                </button>
              </div>

              <p className="mt-2 text-xs leading-relaxed text-muted">
                {plugin.description}
              </p>

              {plugin.error && (
                <p className="mt-1 text-xs text-danger">{plugin.error}</p>
              )}

              {plugin.capabilities.length > 0 && (
                <div className="mt-2">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-muted">
                    {t("settings.plugins.capability.title")}
                  </p>
                  <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-muted">
                    {plugin.capabilities.map((capability) =>
                      isPluginCapability(capability) ? (
                        <li key={capability}>{capabilityLabel(capability, t)}</li>
                      ) : (
                        <li key={capability}>{capability}</li>
                      )
                    )}
                  </ul>
                </div>
              )}

              {plugin.contributes?.providers?.map((provider) => (
                <p key={provider.id} className="mt-1 text-xs text-muted">
                  {t("settings.plugins.contributes.provider", {
                    label: provider.label,
                    host: hostFromBaseURL(provider.baseURL),
                  })}
                </p>
              ))}

              {plugin.enabled &&
                plugin.status === "ok" &&
                plugin.panels &&
                plugin.panels.length > 0 && (
                  <div className="mt-3 space-y-3 border-t border-card-border pt-3">
                    {plugin.panels.map((panel) => (
                      <PluginPanel
                        key={panel.id}
                        pluginId={plugin.id}
                        panel={panel}
                        theme={theme}
                        lang={lang}
                      />
                    ))}
                  </div>
                )}
            </div>
          ))}
        </div>
      )}

      {error && <p className="mt-3 text-xs text-danger">{error}</p>}

      {consentPlugin && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
          onClick={() => {
            if (!busy) setConsentPlugin(null);
          }}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-card-border bg-card p-5 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="mb-2 text-base font-semibold tracking-tight">
              {t("settings.plugins.consent.title")}
            </h3>
            <p className="mb-3 text-xs leading-relaxed text-muted">
              {t("settings.plugins.consent.security")}
            </p>

            {consentPlugin.capabilities.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-foreground">
                  {t("settings.plugins.consent.capabilities")}
                </p>
                {consentPlugin.capabilities.map((capability) => (
                  <label
                    key={capability}
                    className="flex items-start gap-2 rounded-lg border border-card-border bg-background p-2 text-xs"
                  >
                    <input
                      type="checkbox"
                      checked={granted[capability] ?? true}
                      onChange={(e) =>
                        setGranted((prev) => ({
                          ...prev,
                          [capability]: e.target.checked,
                        }))
                      }
                      className="mt-0.5 accent-accent"
                    />
                    <span>
                      {isPluginCapability(capability)
                        ? capabilityLabel(capability, t)
                        : capability}
                    </span>
                  </label>
                ))}
              </div>
            )}

            {error && <p className="mt-3 text-xs text-danger">{error}</p>}

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConsentPlugin(null)}
                disabled={busy}
                className="rounded-xl border border-card-border bg-background px-3 py-2 text-sm font-medium transition-colors hover:bg-black/5 disabled:opacity-50 dark:hover:bg-white/5"
              >
                {t("settings.plugins.consent.cancel")}
              </button>
              <button
                type="button"
                onClick={() => void confirmEnable()}
                disabled={busy}
                className="rounded-xl bg-accent px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-accent/90 disabled:opacity-50"
              >
                {busy
                  ? t("settings.app.config.working")
                  : t("settings.plugins.consent.enable")}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
