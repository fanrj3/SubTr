import { connection } from "next/server";
import { getPluginsSnapshot } from "@/lib/server/plugins";

/**
 * GET /api/plugins — installed plugins + consent state.
 * Loopback-only tool; never returns secrets (plugins are described, not executed here).
 */
export async function GET(): Promise<Response> {
  // Defer to request time so the on-disk plugin dir is always scanned fresh.
  await connection();
  const snapshot = await getPluginsSnapshot();
  return Response.json(snapshot);
}
