"use client";

import { useEffect, useState } from "react";
import { useT } from "@/lib/client";
import {
  checkForUpdate,
  clearAvailableUpdate,
  dismissVersion,
  markChecked,
  readAvailableUpdate,
  readDismissedVersion,
  shouldAutoCheck,
  writeAvailableUpdate,
} from "@/lib/client";
import { RELEASES_URL } from "@/lib/version";
import { RefreshIcon, XIcon } from "./icons";

export function UpdateBanner() {
  const { t } = useT();
  const [update, setUpdate] = useState<{ version: string; url: string } | null>(null);

  useEffect(() => {
    const cached = readAvailableUpdate();
    if (cached && readDismissedVersion() !== cached.version) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setUpdate(cached);
    }

    if (!shouldAutoCheck()) return;
    markChecked();
    void checkForUpdate().then((result) => {
      if (result.status === "available" && readDismissedVersion() !== result.version) {
        const next = { version: result.version, url: result.url };
        writeAvailableUpdate(next);
        setUpdate(next);
      } else if (result.status !== "error") {
        clearAvailableUpdate();
        setUpdate(null);
      }
    });
  }, []);

  if (!update) return null;

  function dismiss() {
    if (update) dismissVersion(update.version);
    setUpdate(null);
  }

  return (
    <div className="px-3 pt-2.5 sm:px-4">
      <div className="mx-auto flex max-w-[75rem] items-center justify-between gap-3 rounded-xl border border-accent/20 bg-accent-dim/50 px-3 py-2 text-[11px] shadow-sm sm:px-4">
        <span className="flex min-w-0 items-center gap-2 text-foreground/80">
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent">
            <RefreshIcon className="h-3 w-3" />
          </span>
          <span className="min-w-0 truncate">
            {t("update.banner.available", { version: update.version })}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-1.5">
          <a
            href={update.url || RELEASES_URL}
            target="_blank"
            rel="noreferrer"
            className="rounded-md px-2 py-1 font-semibold text-accent transition-colors hover:bg-accent/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            {t("update.banner.view")}
          </a>
          <button
            type="button"
            onClick={dismiss}
            aria-label={t("update.banner.dismissAria")}
            className="rounded-md p-1 text-muted transition-colors hover:bg-black/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent dark:hover:bg-white/5"
          >
            <XIcon className="h-3.5 w-3.5" />
          </button>
        </span>
      </div>
    </div>
  );
}
