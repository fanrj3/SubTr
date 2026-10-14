"use client";

import { useEffect, useState } from "react";
import { useT } from "@/lib/client";

type StatsTotals = {
  costUsd: number;
  calls: number;
  translations: number;
  inTokens: number;
  outTokens: number;
  estimatedCount: number;
};

type Stats = {
  version: number;
  totals: StatsTotals;
  lastRecordAt?: string;
};

function normalizeStats(data: unknown): Stats | null {
  if (!data || typeof data !== "object") return null;
  const record = data as Record<string, unknown>;
  if (record.totals && typeof record.totals === "object") {
    const totals = record.totals as Record<string, unknown>;
    return {
      version: typeof record.version === "number" ? record.version : 1,
      totals: {
        costUsd: Number(totals.costUsd ?? 0),
        calls: Number(totals.calls ?? 0),
        translations: Number(totals.translations ?? 0),
        inTokens: Number(totals.inTokens ?? 0),
        outTokens: Number(totals.outTokens ?? 0),
        estimatedCount: Number(totals.estimatedCount ?? 0),
      },
      lastRecordAt:
        typeof record.lastRecordAt === "string" ? record.lastRecordAt : undefined,
    };
  }
  if (typeof record.costUsd === "number") {
    return {
      version: typeof record.version === "number" ? record.version : 1,
      totals: {
        costUsd: record.costUsd,
        calls: Number(record.calls ?? 0),
        translations: Number(record.translations ?? 0),
        inTokens: Number(record.inTokens ?? 0),
        outTokens: Number(record.outTokens ?? 0),
        estimatedCount: Number(record.estimatedCount ?? 0),
      },
      lastRecordAt:
        typeof record.lastRecordAt === "string" ? record.lastRecordAt : undefined,
    };
  }
  return null;
}

function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function DollarIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5" aria-hidden="true">
      <path d="M12 2v20" />
      <path d="M17 6H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H7" />
    </svg>
  );
}

function CallIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5" aria-hidden="true">
      <path d="M4 4h4l2 5-2.5 1.5a12 12 0 0 0 6 6L15 14l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 2 6a2 2 0 0 1 2-2Z" />
    </svg>
  );
}

function TranslateIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5" aria-hidden="true">
      <path d="M4 5h8" />
      <path d="M8 3v2c0 4-1.5 7-4 9" />
      <path d="M6 9c1.5 3 4 5 6 6" />
      <path d="M14 21l4-9 4 9" />
      <path d="M15.5 17h5" />
    </svg>
  );
}

function TokenIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5" aria-hidden="true">
      <rect x="3" y="6" width="18" height="12" rx="2" />
      <path d="M3 10h18" />
    </svg>
  );
}

export function StatusBar() {
  const { t } = useT();
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch("/api/stats", { cache: "no-store" });
        if (!res.ok) throw new Error("bad status");
        const data = normalizeStats(await res.json());
        if (!cancelled) setStats(data);
      } catch {
        if (!cancelled) setStats(null);
      }
    }

    void load();
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 5000);
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  const totals = stats?.totals;
  const estimated = (totals?.estimatedCount ?? 0) > 0;
  const prefix = estimated ? "~" : "";
  const dash = "—";

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-20 border-t border-card-border bg-background/85 backdrop-blur-md">
      <div className="mx-auto flex max-w-[75rem] flex-wrap items-center justify-center gap-x-4 gap-y-0.5 px-4 py-1.5 text-[11px] text-muted sm:justify-between sm:px-6">
        <span className="inline-flex items-center gap-1">
          <DollarIcon />
          <span className="text-muted">{t("status.cost")}</span>
          <span className="font-medium tabular-nums text-foreground">
            {totals ? `${prefix}$${totals.costUsd.toFixed(4)}` : dash}
          </span>
        </span>
        <span className="inline-flex items-center gap-1">
          <CallIcon />
          <span className="text-muted">{t("status.calls")}</span>
          <span className="font-medium tabular-nums text-foreground">
            {totals ? compact(totals.calls) : dash}
          </span>
        </span>
        <span className="inline-flex items-center gap-1">
          <TranslateIcon />
          <span className="text-muted">{t("status.translations")}</span>
          <span className="font-medium tabular-nums text-foreground">
            {totals ? compact(totals.translations) : dash}
          </span>
        </span>
        <span className="inline-flex items-center gap-1">
          <TokenIcon />
          <span className="text-muted">{t("status.tokens")}</span>
          <span className="font-medium tabular-nums text-foreground">
            {totals ? `${prefix}${compact(totals.inTokens + totals.outTokens)}` : dash}
          </span>
        </span>
        {estimated && (
          <span className="text-[10px] italic text-muted">{t("status.estimated")}</span>
        )}
      </div>
    </div>
  );
}
