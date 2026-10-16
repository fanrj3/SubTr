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
import { XIcon } from "./icons";

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
    <div className="border-b border-card-border bg-card">
      <div className="mx-auto flex h-9 max-w-[75rem] items-center justify-between gap-3 px-4 text-xs sm:px-6">
        <span className="min-w-0 truncate text-muted">
          {t("update.banner.available", { version: update.version })}
        </span>
        <span className="flex shrink-0 items-center gap-2">
          <a
            href={update.url || RELEASES_URL}
            target="_blank"
            rel="noreferrer"
            className="font-medium text-accent underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
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
