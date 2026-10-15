import { connection } from "next/server";
import { errorResponse } from "@/lib/server/llm";
import { dispatchPluginEvent } from "@/lib/server/plugins";

/**
 * POST /api/plugin-events/:id — internal host→plugin event channel.
 *
 * Called only by the Electron main process (loopback) with the shared bridge
 * bearer token. Events (region hover/select/dismiss, hotkey.trigger) are routed
 * to the plugin's registered handlers; nothing is exposed without the token.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  await connection();

  const token = process.env.SUBTR_BRIDGE_TOKEN;
  const auth = req.headers.get("authorization") ?? "";
  if (!token || auth !== `Bearer ${token}`) {
    return errorResponse("Unauthorized", 401);
  }

  const { id } = await params;
  if (!id || !/^[a-z0-9_][a-z0-9_-]*$/.test(id)) {
    return errorResponse("Unknown plugin", 404);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return errorResponse("Invalid JSON body", 400);
  }

  const result = await dispatchPluginEvent(id, body);
  if (!result.ok) return errorResponse(result.error ?? "Event rejected", 400);
  return Response.json({ ok: true });
}
