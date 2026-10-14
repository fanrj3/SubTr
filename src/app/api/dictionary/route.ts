import { connection } from "next/server";
import { errorResponse } from "@/lib/server/llm";
import { lookupDictionary } from "@/lib/server/plugins";

/**
 * GET /api/dictionary?term=word — first non-null entry from an enabled
 * `dictionary.source` plugin. 404 when no plugin provides the term.
 */
export async function GET(req: Request): Promise<Response> {
  await connection();
  const term = new URL(req.url).searchParams.get("term");
  if (typeof term !== "string" || !term.trim()) {
    return errorResponse("term is required", 400);
  }
  const entry = await lookupDictionary(term);
  if (!entry) return errorResponse("No dictionary entry", 404);
  return Response.json(entry);
}
