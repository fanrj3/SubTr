"use client";

import { useEffect, useRef, useState } from "react";
import { useT } from "@/lib/client";
import {
  applyImportBundle,
  buildConfigPayload,
  decryptPayload,
  downloadConfigFile,
  isConfigPayload,
  type ConfigPayload,
  type ImportBundle,
} from "@/lib/client";

type Mode = "export" | "import" | "confirm" | null;

export function ConfigTransfer() {
  const { t } = useT();
  const [mode, setMode] = useState<Mode>(null);
  const [passphrase, setPassphrase] = useState("");
  const [confirmPassphrase, setConfirmPassphrase] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pendingPayload, setPendingPayload] = useState<ConfigPayload | null>(null);
  const [pendingBundle, setPendingBundle] = useState<ImportBundle | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function close() {
    setMode(null);
    setPassphrase("");
    setConfirmPassphrase("");
    setShowPass(false);
    setError(null);
    setBusy(false);
  }

  useEffect(() => {
    if (!mode) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) close();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [mode, busy]);

  async function handleExport() {
    if (passphrase.length < 8) {
      setError(t("settings.app.config.minLength"));
      return;
    }
    if (passphrase !== confirmPassphrase) {
      setError(t("settings.app.config.mismatch"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const payload = await buildConfigPayload(passphrase);
      downloadConfigFile(payload);
      close();
    } catch {
      setError(t("settings.app.config.decryptFailed"));
      setBusy(false);
    }
  }

  async function handleFile(file: File) {
    setError(null);
    try {
      const text = await file.text();
      const parsed: unknown = JSON.parse(text);
      if (!isConfigPayload(parsed)) {
        setMode("import");
        setError(t("settings.app.config.invalidFile"));
        return;
      }
      setPendingPayload(parsed);
      setMode("import");
    } catch {
      setMode("import");
      setError(t("settings.app.config.invalidFile"));
    }
  }

  async function handleImport() {
    if (!pendingPayload) return;
    setBusy(true);
    setError(null);
    try {
      const bundle = await decryptPayload(pendingPayload, passphrase);
      setPendingBundle(bundle);
      setMode("confirm");
      setBusy(false);
    } catch {
      setError(t("settings.app.config.decryptFailed"));
      setBusy(false);
    }
  }

  async function handleConfirm() {
    if (!pendingBundle) return;
    setBusy(true);
    try {
      await applyImportBundle(pendingBundle);
      close();
      setPendingPayload(null);
      setPendingBundle(null);
    } catch {
      setError(t("settings.app.config.decryptFailed"));
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <label className="block text-sm font-medium">
        {t("settings.app.config.export")} / {t("settings.app.config.import")}
      </label>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => {
            close();
            setMode("export");
          }}
          className="rounded-xl border border-card-border bg-background px-3 py-2 text-sm font-medium transition-colors hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent dark:hover:bg-white/5"
        >
          {t("settings.app.config.export")}
        </button>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="rounded-xl border border-card-border bg-background px-3 py-2 text-sm font-medium transition-colors hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent dark:hover:bg-white/5"
        >
          {t("settings.app.config.import")}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void handleFile(file);
          }}
        />
      </div>

      {mode && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
          onClick={() => {
            if (!busy) close();
          }}
        >
          <div
            className="w-full max-w-sm rounded-2xl border border-card-border bg-card p-5 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="mb-3 text-base font-semibold tracking-tight">
              {mode === "export"
                ? t("settings.app.config.exportTitle")
                : mode === "import"
                  ? t("settings.app.config.importTitle")
                  : t("settings.app.config.confirmTitle")}
            </h3>

            {mode === "confirm" ? (
              <>
                <p className="mb-4 text-sm leading-relaxed text-muted">
                  {t("settings.app.config.confirmBody")}
                </p>
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={close}
                    disabled={busy}
                    className="rounded-xl border border-card-border bg-background px-3 py-2 text-sm font-medium transition-colors hover:bg-black/5 disabled:opacity-50 dark:hover:bg-white/5"
                  >
                    {t("settings.app.config.cancel")}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleConfirm()}
                    disabled={busy}
                    className="rounded-xl bg-accent px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-accent/90 disabled:opacity-50"
                  >
                    {busy ? t("settings.app.config.working") : t("settings.app.config.replace")}
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="mb-3 text-xs leading-relaxed text-muted">
                  {mode === "export"
                    ? t("settings.app.config.encryptNote")
                    : t("settings.app.config.importNote")}
                </p>
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <input
                      type={showPass ? "text" : "password"}
                      value={passphrase}
                      onChange={(e) => setPassphrase(e.target.value)}
                      placeholder={t("settings.app.config.passphrase")}
                      autoFocus
                      className="w-full rounded-xl border border-card-border bg-background px-3 py-2 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPass((s) => !s)}
                      className="shrink-0 rounded-lg px-2 py-1 text-xs text-muted transition-colors hover:bg-black/5 hover:text-foreground dark:hover:bg-white/5"
                    >
                      {showPass
                        ? t("settings.app.config.hide")
                        : t("settings.app.config.show")}
                    </button>
                  </div>
                  {mode === "export" && (
                    <input
                      type={showPass ? "text" : "password"}
                      value={confirmPassphrase}
                      onChange={(e) => setConfirmPassphrase(e.target.value)}
                      placeholder={t("settings.app.config.confirmPassphrase")}
                      className="w-full rounded-xl border border-card-border bg-background px-3 py-2 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent"
                    />
                  )}
                </div>

                {error && <p className="mt-3 text-xs text-danger">{error}</p>}

                <div className="mt-4 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={close}
                    disabled={busy}
                    className="rounded-xl border border-card-border bg-background px-3 py-2 text-sm font-medium transition-colors hover:bg-black/5 disabled:opacity-50 dark:hover:bg-white/5"
                  >
                    {t("settings.app.config.cancel")}
                  </button>
                  <button
                    type="button"
                    onClick={() => void (mode === "export" ? handleExport() : handleImport())}
                    disabled={busy}
                    className="rounded-xl bg-accent px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-accent/90 disabled:opacity-50"
                  >
                    {busy
                      ? t("settings.app.config.working")
                      : mode === "export"
                        ? t("settings.app.config.exportAction")
                        : t("settings.app.config.importAction")}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
