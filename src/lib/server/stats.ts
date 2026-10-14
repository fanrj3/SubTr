import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Server-side LLM cost meter store.
 *
 * Persists to `~/.subtr/stats.json`. Writes are atomic (tmp + rename) and
 * serialized through a promise queue so a single process never interleaves
 * writes. Never stores keys or translation text.
 *
 * v2 adds `daily` buckets keyed by LOCAL calendar date (YYYY-MM-DD). v1 files
 * are migrated on read (daily starts empty; totals/recent are preserved).
 */

export type StatsRecord = {
  /** ISO timestamp of the request. */
  ts: string;
  model: string;
  presetId?: string;
  inTok: number;
  outTok: number;
  /** USD, or null when pricing is unknown. */
  costUsd: number | null;
  /** True when token counts were estimated (provider emitted no usage). */
  estimated: boolean;
};

export type StatsTotals = {
  costUsd: number;
  calls: number;
  translations: number;
  inTokens: number;
  outTokens: number;
  estimatedCount: number;
};

/** One local-calendar-day bucket. */
export type DailyEntry = {
  calls: number;
  translations: number;
  inTok: number;
  outTok: number;
  costUsd: number;
};

export type StatsFile = {
  version: 2;
  totals: StatsTotals;
  /** Newest first, capped at MAX_RECENT. */
  recent: StatsRecord[];
  /** Keyed by local date (YYYY-MM-DD), capped at MAX_DAILY_DAYS. */
  daily: Record<string, DailyEntry>;
};

/** Sorted shape returned by GET /api/stats. */
export type DailyPoint = DailyEntry & { date: string };

const MAX_RECENT = 200;
const MAX_DAILY_DAYS = 730;
const VERSION = 2 as const;

function statsDir(): string {
  return path.join(os.homedir(), ".subtr");
}

function statsPath(): string {
  return path.join(statsDir(), "stats.json");
}

/** Local calendar date as YYYY-MM-DD. */
export function localDateKey(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function emptyStats(): StatsFile {
  return {
    version: VERSION,
    totals: {
      costUsd: 0,
      calls: 0,
      translations: 0,
      inTokens: 0,
      outTokens: 0,
      estimatedCount: 0,
    },
    recent: [],
    daily: {},
  };
}

function num(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Keep only the most recent MAX_DAILY_DAYS buckets. */
function trimDaily(daily: Record<string, DailyEntry>): void {
  const keys = Object.keys(daily);
  if (keys.length <= MAX_DAILY_DAYS) return;
  keys.sort((a, b) => b.localeCompare(a));
  for (const key of keys.slice(MAX_DAILY_DAYS)) {
    delete daily[key];
  }
}

/**
 * Coerce an untrusted parsed file into the current shape. v1 files (no `daily`)
 * migrate cleanly: totals/recent are preserved and `daily` starts empty.
 */
function normalize(raw: unknown): StatsFile {
  if (!raw || typeof raw !== "object") return emptyStats();
  const record = raw as Record<string, unknown>;
  const totalsRaw = (record.totals ?? {}) as Record<string, unknown>;
  const recentRaw = Array.isArray(record.recent) ? record.recent : [];
  const recent: StatsRecord[] = [];
  for (const item of recentRaw.slice(0, MAX_RECENT)) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    if (typeof r.model !== "string") continue;
    recent.push({
      ts: typeof r.ts === "string" ? r.ts : new Date(0).toISOString(),
      model: r.model,
      ...(typeof r.presetId === "string" ? { presetId: r.presetId } : {}),
      inTok: num(r.inTok),
      outTok: num(r.outTok),
      costUsd: typeof r.costUsd === "number" && Number.isFinite(r.costUsd) ? r.costUsd : null,
      estimated: r.estimated === true,
    });
  }

  const daily: Record<string, DailyEntry> = {};
  const dailyRaw = record.daily;
  if (dailyRaw && typeof dailyRaw === "object" && !Array.isArray(dailyRaw)) {
    for (const [date, value] of Object.entries(dailyRaw as Record<string, unknown>)) {
      if (!DATE_RE.test(date) || !value || typeof value !== "object") continue;
      const v = value as Record<string, unknown>;
      daily[date] = {
        calls: num(v.calls),
        translations: num(v.translations),
        inTok: num(v.inTok),
        outTok: num(v.outTok),
        costUsd: num(v.costUsd),
      };
    }
    trimDaily(daily);
  }

  return {
    version: VERSION,
    totals: {
      costUsd: num(totalsRaw.costUsd),
      calls: num(totalsRaw.calls),
      translations: num(totalsRaw.translations),
      inTokens: num(totalsRaw.inTokens),
      outTokens: num(totalsRaw.outTokens),
      estimatedCount: num(totalsRaw.estimatedCount),
    },
    recent,
    daily,
  };
}

let cache: StatsFile | null = null;
let loadPromise: Promise<StatsFile> | null = null;

async function load(): Promise<StatsFile> {
  if (cache) return cache;
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    try {
      const text = await fs.readFile(statsPath(), "utf8");
      cache = normalize(JSON.parse(text));
    } catch {
      cache = emptyStats();
    }
    return cache;
  })();
  return loadPromise;
}

/** Serialize all mutations through a single promise chain. */
let writeQueue: Promise<void> = Promise.resolve();

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = writeQueue.then(task, task);
  // Keep the chain alive even if a write rejects.
  writeQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function persist(stats: StatsFile): Promise<void> {
  const dir = statsDir();
  const file = statsPath();
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.mkdir(dir, { recursive: true });
  try {
    await fs.writeFile(tmp, JSON.stringify(stats), "utf8");
    await fs.rename(tmp, file);
  } catch (error) {
    try {
      await fs.rm(tmp, { force: true });
    } catch {
      // ignore cleanup failure
    }
    throw error;
  }
}

/**
 * Append a usage record and fold it into the totals + today's daily bucket.
 * `translated` increments the translations counter (a non-empty translation
 * was produced).
 */
export function recordUsage(
  record: StatsRecord,
  opts?: { translated?: boolean },
): Promise<void> {
  return enqueue(async () => {
    const stats = await load();
    const inTok = Math.max(0, record.inTok);
    const outTok = Math.max(0, record.outTok);
    const translated = opts?.translated === true;
    const cost = typeof record.costUsd === "number" ? record.costUsd : 0;

    stats.totals.calls += 1;
    if (translated) stats.totals.translations += 1;
    stats.totals.inTokens += inTok;
    stats.totals.outTokens += outTok;
    if (record.estimated) stats.totals.estimatedCount += 1;
    if (typeof record.costUsd === "number") stats.totals.costUsd += record.costUsd;

    const key = localDateKey();
    const bucket = stats.daily[key] ?? {
      calls: 0,
      translations: 0,
      inTok: 0,
      outTok: 0,
      costUsd: 0,
    };
    bucket.calls += 1;
    if (translated) bucket.translations += 1;
    bucket.inTok += inTok;
    bucket.outTok += outTok;
    bucket.costUsd += cost;
    stats.daily[key] = bucket;
    trimDaily(stats.daily);

    stats.recent.unshift(record);
    if (stats.recent.length > MAX_RECENT) {
      stats.recent.length = MAX_RECENT;
    }
    await persist(stats);
  });
}

/** Read the current stats (aggregates + recent records + daily buckets). */
export async function readStats(): Promise<StatsFile> {
  const stats = await load();
  return {
    version: stats.version,
    totals: { ...stats.totals },
    recent: [...stats.recent],
    daily: { ...stats.daily },
  };
}

/** Daily buckets as an array sorted oldest → newest (for GET /api/stats). */
export function dailySeries(stats: StatsFile): DailyPoint[] {
  return Object.entries(stats.daily)
    .map(([date, entry]) => ({ date, ...entry }))
    .sort((a, b) => a.date.localeCompare(b.date));
}
