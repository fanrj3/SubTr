"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useT } from "@/lib/client";
import {
  hostFromBaseURL,
  importPlugin,
  isPluginCapability,
  uninstallPlugin,
  type PluginCapability,
  type PluginInfo,
  type PluginsResponse,
  type TKey,
} from "@/lib/client";
import { LoaderIcon, PanelIcon } from "./icons";
import { PluginPanelFrame } from "./plugin-panel-frame";
import { SettingsDialog, SettingsSwitch } from "./settings-ui";

type PluginsSectionProps = {
  data: PluginsResponse | null;
  loading: boolean;
  theme: "light" | "dark";
  lang: "en" | "zh-CN";
  onToggle: (
    id: string,
    enabled: boolean,
    grantedCapabilities?: string[],
    visiblePanels?: Record<string, boolean>
  ) => Promise<boolean>;
  onRefresh: () => Promise<void>;
};

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

function PanelPreviewLink({
  pluginId,
  panelId,
  title,
}: {
  pluginId: string;
  panelId: string;
  title: string;
}) {
  const { t } = useT();
  return (
    <Link
      href={`/panel-preview/${encodeURIComponent(pluginId)}/${encodeURIComponent(
        panelId
      )}`}
      aria-label={t("settings.plugins.previewAria", { title })}
      className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-muted transition-colors hover:bg-black/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent dark:hover:bg-white/5"
    >
      <PanelIcon className="h-3.5 w-3.5" />
      {t("settings.plugins.preview")}
    </Link>
  );
}

export function PluginsSection({
  data,
  loading,
  theme,
  lang,
  onToggle,
  onRefresh,
}: PluginsSectionProps) {
  const { t } = useT();
  const [consentPlugin, setConsentPlugin] = useState<PluginInfo | null>(null);
  const [granted, setGranted] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [importing, setImporting] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [showOverwrite, setShowOverwrite] = useState(false);
  const [importMessage, setImportMessage] = useState<
    { kind: "success" | "error"; text: string } | null
  >(null);
  const [uninstallTarget, setUninstallTarget] = useState<PluginInfo | null>(null);
  const [uninstalling, setUninstalling] = useState(false);
  const importInputRef = useRef<HTMLInputElement>(null);

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

  function importErrorText(status: number, reason: string): string {
    if (status === 413) return t("settings.plugins.importTooLarge");
    if (status === 400) {
      return reason
        ? t("settings.plugins.importInvalid", { reason })
        : t("settings.plugins.importFailed");
    }
    return t("settings.plugins.importFailed");
  }

  async function upload(file: File, overwrite: boolean) {
    setImporting(true);
    setImportMessage(null);
    const result = await importPlugin(file, overwrite);
    setImporting(false);

    if (result.ok) {
      setPendingFile(null);
      setShowOverwrite(false);
      setImportMessage({
        kind: "success",
        text: t("settings.plugins.importSuccess", { id: result.id }),
      });
      await onRefresh();
      window.setTimeout(() => setImportMessage(null), 4000);
      return;
    }

    if (result.status === 409) {
      setPendingFile(file);
      setShowOverwrite(true);
      return;
    }

    setImportMessage({
      kind: "error",
      text: importErrorText(result.status, result.error),
    });
  }

  async function togglePanelVisibility(
    plugin: PluginInfo,
    panelId: string,
    visible: boolean
  ) {
    setBusy(true);
    setError(null);
    const ok = await onToggle(plugin.id, plugin.enabled, undefined, {
      [panelId]: visible,
    });
    setBusy(false);
    if (!ok) setError(t("settings.plugins.error.toggle"));
  }

  async function confirmUninstall() {
    if (!uninstallTarget) return;
    setUninstalling(true);
    const ok = await uninstallPlugin(uninstallTarget.id);
    setUninstalling(false);
    if (ok) {
      setUninstallTarget(null);
      await onRefresh();
    } else {
      setError(t("settings.plugins.uninstallFailed"));
      setUninstallTarget(null);
    }
  }

  return (
    <section className="rounded-2xl border border-card-border bg-card p-5 shadow-sm">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold tracking-tight">
          {t("settings.plugins.title")}
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted">{t("settings.plugins.importNote")}</span>
          <button
            type="button"
            onClick={() => importInputRef.current?.click()}
            disabled={importing}
            className="rounded-xl border border-card-border bg-background px-3 py-1.5 text-sm font-medium transition-colors hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50 dark:hover:bg-white/5"
          >
            {importing ? t("settings.plugins.importing") : t("settings.plugins.import")}
          </button>
          <input
            ref={importInputRef}
            type="file"
            accept=".zip"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void upload(file, false);
            }}
          />
        </div>
      </div>

      {importMessage && (
        <p
          className={`mb-3 text-xs ${
            importMessage.kind === "success" ? "text-success" : "text-danger"
          }`}
        >
          {importMessage.text}
        </p>
      )}

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

                <div className="flex shrink-0 flex-wrap items-center gap-2">
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
                  <button
                    type="button"
                    disabled={busy || uninstalling}
                    onClick={() => setUninstallTarget(plugin)}
                    className="rounded-lg px-3 py-1.5 text-xs font-medium text-danger transition-colors hover:bg-danger-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
                  >
                    {t("settings.plugins.uninstall")}
                  </button>
                </div>
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
                    {plugin.panels
                      .filter((panel) => panel.location !== "home")
                      .map((panel) => (
                        <div key={panel.id} className="space-y-2">
                          <div className="flex items-center justify-between gap-2">
                            <span className="min-w-0 truncate text-[11px] font-medium uppercase tracking-wide text-muted">
                              {panel.title}
                            </span>
                            <PanelPreviewLink
                              pluginId={plugin.id}
                              panelId={panel.id}
                              title={panel.title}
                            />
                          </div>
                          <PluginPanelFrame
                            pluginId={plugin.id}
                            panel={panel}
                            theme={theme}
                            lang={lang}
                          />
                        </div>
                      ))}
                    {plugin.panels
                      .filter((panel) => panel.location === "home")
                      .map((panel) => (
                        <div
                          key={panel.id}
                          className="flex items-center justify-between gap-2 rounded-lg border border-card-border bg-background px-2.5 py-2 text-xs"
                        >
                          <span className="min-w-0 truncate text-muted">
                            {t("settings.plugins.showOnHome", { title: panel.title })}
                          </span>
                          <div className="flex shrink-0 items-center gap-1.5">
                            <PanelPreviewLink
                              pluginId={plugin.id}
                              panelId={panel.id}
                              title={panel.title}
                            />
                            <SettingsSwitch
                              checked={panel.visible !== false}
                              disabled={busy}
                              aria-label={t("settings.plugins.showOnHome", {
                                title: panel.title,
                              })}
                              onCheckedChange={(checked) =>
                                void togglePanelVisibility(plugin, panel.id, checked)
                              }
                            />
                          </div>
                        </div>
                      ))}
                  </div>
                )}
            </div>
          ))}
        </div>
      )}

      {error && <p className="mt-3 text-xs text-danger">{error}</p>}

      <SettingsDialog
        open={showOverwrite && !!pendingFile}
        onOpenChange={(open) => {
          if (!open && !importing) {
            setShowOverwrite(false);
            setPendingFile(null);
          }
        }}
        title={t("settings.plugins.importExistsTitle")}
        description={t("settings.plugins.importExistsBody")}
        footer={
          <>
            <button
              type="button"
              onClick={() => {
                setShowOverwrite(false);
                setPendingFile(null);
              }}
              disabled={importing}
              className="rounded-xl border border-card-border bg-background px-3 py-2 text-sm font-medium transition-colors hover:bg-black/5 disabled:opacity-50 dark:hover:bg-white/5"
            >
              {t("settings.plugins.cancel")}
            </button>
            <button
              type="button"
              onClick={() => pendingFile && void upload(pendingFile, true)}
              disabled={importing}
              className="rounded-xl bg-accent px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-accent/90 disabled:opacity-50"
            >
              {importing
                ? t("settings.plugins.importing")
                : t("settings.plugins.overwrite")}
            </button>
          </>
        }
      />

      <SettingsDialog
        open={!!uninstallTarget}
        onOpenChange={(open) => {
          if (!open && !uninstalling) setUninstallTarget(null);
        }}
        title={
          uninstallTarget
            ? t("settings.plugins.uninstallTitle", { name: uninstallTarget.name })
            : ""
        }
        description={t("settings.plugins.uninstallBody")}
        footer={
          <>
            <button
              type="button"
              onClick={() => setUninstallTarget(null)}
              disabled={uninstalling}
              className="rounded-xl border border-card-border bg-background px-3 py-2 text-sm font-medium transition-colors hover:bg-black/5 disabled:opacity-50 dark:hover:bg-white/5"
            >
              {t("settings.plugins.cancel")}
            </button>
            <button
              type="button"
              onClick={() => void confirmUninstall()}
              disabled={uninstalling}
              className="rounded-xl bg-danger px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-danger/90 disabled:opacity-50"
            >
              {uninstalling
                ? t("settings.plugins.uninstalling")
                : t("settings.plugins.uninstall")}
            </button>
          </>
        }
      />

      <SettingsDialog
        open={!!consentPlugin}
        onOpenChange={(open) => {
          if (!open && !busy) setConsentPlugin(null);
        }}
        title={t("settings.plugins.consent.title")}
        description={t("settings.plugins.consent.security")}
        footer={
          <>
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
          </>
        }
      >
        {consentPlugin && consentPlugin.capabilities.length > 0 && (
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
        {error && <p className="text-xs text-danger">{error}</p>}
      </SettingsDialog>
    </section>
  );
}
