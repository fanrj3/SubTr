"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useT } from "@/lib/client";
import type {
  VoiceDownloadProgress,
  VoiceModel,
  VoiceSetup,
  VoiceSnapshot,
} from "@/lib/client/desktop";
import {
  SettingsRow,
  SettingsRowFull,
  SettingsSurface,
  SettingsSwitch,
} from "./settings-ui";

function useIsMounted(): boolean {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );
}

function formatMb(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(1);
}

export function VoiceSettings() {
  const { t } = useT();
  const mounted = useIsMounted();
  const [setup, setSetup] = useState<VoiceSetup | null>(null);
  const [snapshot, setSnapshot] = useState<VoiceSnapshot | null>(null);
  const [models, setModels] = useState<VoiceModel[]>([]);
  const [progress, setProgress] = useState<VoiceDownloadProgress | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [pending, setPending] = useState(false);
  const [toggleError, setToggleError] = useState<string | null>(null);

  const bridge = mounted && typeof window !== "undefined" ? window.subtrDesktop : undefined;
  const desktopVoice = !!bridge?.voiceSetup && !!bridge?.voiceModels;
  const canToggle = desktopVoice && !!bridge?.voiceSetEnabled;

  const applySnapshot = useCallback((snap: VoiceSnapshot) => {
    setSnapshot(snap);
    if (snap.setup) setSetup(snap.setup);
    setEnabled(snap.active === true || snap.wanted === true);
  }, []);

  const refresh = useCallback(async () => {
    const b = typeof window !== "undefined" ? window.subtrDesktop : undefined;
    if (!b?.voiceSetup || !b?.voiceModels) return;
    try {
      const [nextSetup, nextModels] = await Promise.all([b.voiceSetup(), b.voiceModels()]);
      setSetup(nextSetup);
      setModels(nextModels);
    } catch {
      setSetup(null);
    }
  }, []);

  useEffect(() => {
    if (!desktopVoice) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
    const b = window.subtrDesktop;
    const offProgress = b?.onVoiceDownloadProgress?.((p) => {
      setProgress(p);
      if (!p.active) void refresh();
    });
    const offToggle = b?.onVoiceToggle?.((on) => {
      // The tray already applied the change; this is idempotent and returns
      // the fresh snapshot so the status row stays accurate.
      setEnabled(on);
      const b2 = window.subtrDesktop;
      if (!b2?.voiceSetEnabled) return;
      void b2
        .voiceSetEnabled(on)
        .then((snap) => {
          setSnapshot(snap);
          if (snap.setup) setSetup(snap.setup);
        })
        .catch(() => {
          /* keep local state; status row will refresh on next action */
        });
    });
    return () => {
      offProgress?.();
      offToggle?.();
    };
  }, [desktopVoice, refresh]);

  async function handleToggle(next: boolean) {
    const b = typeof window !== "undefined" ? window.subtrDesktop : undefined;
    if (!b?.voiceSetEnabled) {
      setToggleError(t("settings.voice.toggleFailed"));
      return;
    }
    const previous = enabled;
    setEnabled(next);
    setPending(true);
    setToggleError(null);
    try {
      const snap = await b.voiceSetEnabled(next);
      applySnapshot(snap);
    } catch {
      setEnabled(previous);
      setToggleError(t("settings.voice.toggleFailed"));
    } finally {
      setPending(false);
    }
  }

  const status = useMemo(() => {
    if (!desktopVoice) return t("settings.voice.status.off");
    const raw = snapshot?.status;
    if (raw === "listening") return t("settings.voice.status.listening");
    if (raw === "starting") return t("settings.voice.status.starting");
    if (raw === "error") return t("settings.voice.status.error");
    if (raw === "off") return t("settings.voice.status.off");
    if (snapshot) return snapshot.serverReady ? t("settings.voice.status.ready") : t("settings.voice.status.setupNeeded");
    if (!setup) return t("settings.voice.status.starting");
    return setup.ready ? t("settings.voice.status.ready") : t("settings.voice.status.setupNeeded");
  }, [desktopVoice, snapshot, setup, t]);

  if (!mounted) return null;

  if (!desktopVoice) {
    return (
      <SettingsSurface>
        <SettingsRow title={t("settings.voice.title")} description={t("settings.voice.desktopOnly")} />
      </SettingsSurface>
    );
  }

  return (
    <SettingsSurface>
      <SettingsRow
        title={t("settings.voice.enable")}
        description={t("settings.voice.trayNote")}
      >
        <SettingsSwitch
          checked={enabled}
          disabled={!canToggle || pending}
          aria-label={t("settings.voice.enable")}
          onCheckedChange={(next) => void handleToggle(next)}
        />
      </SettingsRow>

      <SettingsRow title={t("settings.voice.status")}>
        <span className="text-[13px] text-muted">{pending ? t("settings.voice.status.starting") : status}</span>
      </SettingsRow>

      {toggleError && (
        <SettingsRow title={t("settings.voice.enable")}>
          <span className="text-xs text-danger">{toggleError}</span>
        </SettingsRow>
      )}

      {setup?.ready && (
        <SettingsRow title={t("settings.voice.readyInfo")}>
          <button
            type="button"
            onClick={() => void refresh()}
            className="rounded-lg border border-card-border bg-background px-2.5 py-1 text-xs font-medium transition-colors hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent dark:hover:bg-white/5"
          >
            {t("settings.voice.refresh")}
          </button>
        </SettingsRow>
      )}

      {models.map((model) => {
        const downloading = progress?.active && progress.id === model.id;
        return (
          <SettingsRow
            key={model.id}
            title={model.label}
            description={`${t("settings.voice.size", { n: formatMb(model.bytes) })} · ${
              model.present ? t("settings.voice.installed") : t("settings.voice.notInstalled")
            }`}
          >
            {model.present ? (
              <span className="text-xs text-success">{t("settings.voice.installed")}</span>
            ) : downloading ? (
              <div className="w-40 min-w-0">
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted/30">
                  <div
                    className="h-full rounded-full bg-accent transition-[width] duration-150"
                    style={{ width: `${Math.max(0, Math.min(100, progress?.percent ?? 0))}%` }}
                  />
                </div>
                <p className="mt-1 text-right text-[11px] tabular-nums text-muted">
                  {Math.round(progress?.percent ?? 0)}%
                </p>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => void window.subtrDesktop?.downloadVoiceModel?.(model.id)}
                className="rounded-lg border border-card-border bg-background px-2.5 py-1 text-xs font-medium transition-colors hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent dark:hover:bg-white/5"
              >
                {t("settings.voice.download")}
              </button>
            )}
          </SettingsRow>
        );
      })}

      {progress?.active && (
        <SettingsRow title={t("settings.voice.downloading")}>
          <span className="text-xs tabular-nums text-muted">
            {Math.round(progress.percent)}%
          </span>
        </SettingsRow>
      )}

      {progress?.error && (
        <SettingsRow title={t("settings.voice.downloadFailed")}>
          <span className="text-xs text-danger">{progress.error}</span>
        </SettingsRow>
      )}

      {setup && !setup.ready && (
        <SettingsRowFull
          title={t("settings.voice.setup")}
          description={
            setup.missing.length > 0
              ? t("settings.voice.setupMissing", { items: setup.missing.join(", ") })
              : undefined
          }
        >
          <div className="space-y-1 font-mono text-[11px] text-muted">
            <p className="break-words">
              <span className="text-foreground">{t("settings.voice.setupBinary")}</span>
              {": "}
              {setup.server}
            </p>
            <p className="break-words">
              <span className="text-foreground">{t("settings.voice.setupModel")}</span>
              {": "}
              {setup.model}
            </p>
          </div>
          <p className="mt-2 text-xs text-muted">{t("settings.voice.screenRecording")}</p>
        </SettingsRowFull>
      )}
    </SettingsSurface>
  );
}
