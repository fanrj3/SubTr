import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Server-side LLM cost meter store.
 *
 * Persists to `~/.subtr/stats.json`. Writes are atomic (tmp + rename) and
 * serialized through a promise queue so a single process never interleaves
 * writes. Never stores keys or translation text.
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

export type StatsFile = {
  version: 1;
  totals: StatsTotals;
  /** Newest first, capped at MAX_RECENT. */
  recent: StatsRecord[];
};

const MAX_RECENT = 200;
const VERSION = 1 as const;

function statsDir(): string {
  return path.join(os.homedir(), ".subtr");
}

function statsPath(): string {
  return path.join(statsDir(), "stats.json");
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
  };
}

function num(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/** Coerce an untrusted parsed file into the expected shape. */
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
 * Append a usage record and fold it into the totals. `translated` increments the
 * translations counter (a non-empty translation was produced).
 */
export function recordUsage(
  record: StatsRecord,
  opts?: { translated?: boolean },
): Promise<void> {
  return enqueue(async () => {
    const stats = await load();
    stats.totals.calls += 1;
    if (opts?.translated) stats.totals.translations += 1;
    stats.totals.inTokens += Math.max(0, record.inTok);
    stats.totals.outTokens += Math.max(0, record.outTok);
    if (record.estimated) stats.totals.estimatedCount += 1;
    if (typeof record.costUsd === "number") stats.totals.costUsd += record.costUsd;
    stats.recent.unshift(record);
    if (stats.recent.length > MAX_RECENT) {
      stats.recent.length = MAX_RECENT;
    }
    await persist(stats);
  });
}

/** Read the current stats (aggregates + recent records). */
export async function readStats(): Promise<StatsFile> {
  const stats = await load();
  return { ...stats, totals: { ...stats.totals }, recent: [...stats.recent] };
}
