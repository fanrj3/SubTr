"use client";

import { useRef, useState } from "react";
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
import { SettingsDialog } from "./settings-ui";

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

  const passField = (
    <div className="flex items-center gap-2">
      <input
        type={showPass ? "text" : "password"}
        value={passphrase}
        onChange={(e) => setPassphrase(e.target.value)}
        placeholder={t("settings.app.config.passphrase")}
        autoFocus
        className="w-full rounded-lg border border-card-border bg-background px-2.5 py-2 text-[13px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent"
      />
      <button
        type="button"
        onClick={() => setShowPass((s) => !s)}
        className="shrink-0 rounded-md px-2 py-1 text-xs text-muted transition-colors hover:bg-black/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent dark:hover:bg-white/5"
      >
        {showPass ? t("settings.app.config.hide") : t("settings.app.config.show")}
      </button>
    </div>
  );

  const cancelButton = (
    <button
      type="button"
      onClick={close}
      disabled={busy}
      className="rounded-lg border border-card-border bg-background px-3 py-1.5 text-[13px] font-medium transition-colors hover:bg-black/5 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent dark:hover:bg-white/5"
    >
      {t("settings.app.config.cancel")}
    </button>
  );

  return (
    <div className="flex flex-wrap gap-2">
      <button
        type="button"
        onClick={() => {
          close();
          setMode("export");
        }}
        className="rounded-lg border border-card-border bg-background px-2.5 py-1.5 text-xs font-medium transition-colors hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent dark:hover:bg-white/5"
      >
        {t("settings.app.config.export")}
      </button>
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        className="rounded-lg border border-card-border bg-background px-2.5 py-1.5 text-xs font-medium transition-colors hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent dark:hover:bg-white/5"
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

      <SettingsDialog
        open={mode === "export"}
        onOpenChange={(open) => {
          if (!open && !busy) close();
        }}
        title={t("settings.app.config.exportTitle")}
        description={t("settings.app.config.encryptNote")}
        footer={
          <>
            {cancelButton}
            <button
              type="button"
              onClick={() => void handleExport()}
              disabled={busy}
              className="rounded-lg bg-accent px-3 py-1.5 text-[13px] font-medium text-white transition-colors hover:bg-accent/90 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              {busy
                ? t("settings.app.config.working")
                : t("settings.app.config.exportAction")}
            </button>
          </>
        }
      >
        {passField}
        <input
          type={showPass ? "text" : "password"}
          value={confirmPassphrase}
          onChange={(e) => setConfirmPassphrase(e.target.value)}
          placeholder={t("settings.app.config.confirmPassphrase")}
          className="w-full rounded-lg border border-card-border bg-background px-2.5 py-2 text-[13px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent"
        />
        {error && <p className="text-xs text-danger">{error}</p>}
      </SettingsDialog>

      <SettingsDialog
        open={mode === "import"}
        onOpenChange={(open) => {
          if (!open && !busy) close();
        }}
        title={t("settings.app.config.importTitle")}
        description={t("settings.app.config.importNote")}
        footer={
          <>
            {cancelButton}
            <button
              type="button"
              onClick={() => void handleImport()}
              disabled={busy}
              className="rounded-lg bg-accent px-3 py-1.5 text-[13px] font-medium text-white transition-colors hover:bg-accent/90 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              {busy
                ? t("settings.app.config.working")
                : t("settings.app.config.importAction")}
            </button>
          </>
        }
      >
        {passField}
        {error && <p className="text-xs text-danger">{error}</p>}
      </SettingsDialog>

      <SettingsDialog
        open={mode === "confirm"}
        onOpenChange={(open) => {
          if (!open && !busy) close();
        }}
        title={t("settings.app.config.confirmTitle")}
        description={t("settings.app.config.confirmBody")}
        footer={
          <>
            {cancelButton}
            <button
              type="button"
              onClick={() => void handleConfirm()}
              disabled={busy}
              className="rounded-lg bg-accent px-3 py-1.5 text-[13px] font-medium text-white transition-colors hover:bg-accent/90 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              {busy
                ? t("settings.app.config.working")
                : t("settings.app.config.replace")}
            </button>
          </>
        }
      />
    </div>
  );
}
