import { connection } from "next/server";
import { errorResponse } from "@/lib/server/llm";
import { readPanelFile } from "@/lib/server/plugins";

/**
 * GET /api/plugins/:id/panel/:panelId — serve a plugin's panel HTML.
 *
 * Only files declared in the manifest are served, only while the plugin is
 * enabled and healthy, and only from inside the plugin folder (traversal-safe).
 * Everything else (unknown plugin, disabled plugin, unknown panel, escaping
 * path) returns 404.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; panelId: string }> },
): Promise<Response> {
  await connection();
  const { id, panelId } = await params;
  if (!id || !/^[a-z0-9_][a-z0-9_-]*$/.test(id) || !panelId) {
    return errorResponse("Panel not found", 404);
  }

  const html = await readPanelFile(id, panelId);
  if (html === null) {
    return errorResponse("Panel not found", 404);
  }

  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
