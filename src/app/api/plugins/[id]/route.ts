import { connection } from "next/server";
import { errorResponse } from "@/lib/server/llm";
import { setPluginConsent, uninstallPlugin } from "@/lib/server/plugins";

/**
 * POST /api/plugins/:id — enable/disable a plugin and (re)grant capabilities.
 * Body: { enabled: boolean, grantedCapabilities?: string[] }
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  await connection();
  const { id } = await params;
  if (!id || !/^[a-z0-9-]+$/.test(id)) {
    return errorResponse("invalid plugin id", 400);
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return errorResponse("Invalid JSON body", 400);
  }
  const result = await setPluginConsent(id, body);
  if (!result.ok) return errorResponse(result.error, 400);
  return Response.json({ ok: true, revision: result.revision });
}

/**
 * DELETE /api/plugins/:id — uninstall a plugin folder and clear its consent.
 */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  await connection();
  const { id } = await params;
  if (!id || !/^[a-z0-9-]+$/.test(id)) {
    return errorResponse("unknown plugin", 404);
  }
  const result = await uninstallPlugin(id);
  if (!result.ok) return errorResponse(result.error, result.status);
  return Response.json({ ok: true, revision: result.revision });
}
