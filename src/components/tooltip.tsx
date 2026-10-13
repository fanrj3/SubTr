"use client";

import { useId, useState } from "react";
import { useT } from "@/lib/client";

export function HelpTooltip({ children }: { children: string }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const id = useId();

  return (
    <span className="relative inline-flex align-middle">
      <button
        type="button"
        aria-describedby={open ? id : undefined}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        className="ml-1 inline-flex h-4 w-4 items-center justify-center rounded-full border border-card-border bg-background text-[10px] leading-none text-muted transition-colors hover:border-accent hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        aria-label={t("tooltip.moreInfo")}
      >
        ?
      </button>
      {open && (
        <span
          id={id}
          role="tooltip"
          className="absolute left-1/2 top-full z-50 mt-1.5 w-56 -translate-x-1/2 rounded-lg border border-card-border bg-card px-3 py-2 text-xs leading-snug text-foreground shadow-md"
        >
          {children}
        </span>
      )}
    </span>
  );
}
