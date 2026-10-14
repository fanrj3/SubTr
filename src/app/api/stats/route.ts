import { connection } from "next/server";
import { readStats } from "@/lib/server/stats";

/**
 * GET /api/stats — aggregate LLM usage/cost for the local cost meter.
 * Loopback-only tool: no auth. Never returns keys or translation text.
 */
export async function GET(): Promise<Response> {
  // Defer to request time so the on-disk stats are always read fresh.
  await connection();
  const stats = await readStats();
  const raw = stats.totals.costUsd;
  return Response.json({
    version: stats.version,
    costUsd: Math.round(raw * 1e6) / 1e6,
    costUsdRaw: raw,
    calls: stats.totals.calls,
    translations: stats.totals.translations,
    inTokens: stats.totals.inTokens,
    outTokens: stats.totals.outTokens,
    estimatedCount: stats.totals.estimatedCount,
    lastRecordAt: stats.recent[0]?.ts ?? null,
  });
}
