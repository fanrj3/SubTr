import { connection } from "next/server";
import { errorResponse } from "@/lib/server/llm";
import { dispatchPluginHttp } from "@/lib/server/plugins";

/**
 * /api/plugin-api/<pluginId>/<path…> — plugin-owned HTTP namespace.
 *
 * The settings panel reaches plugin endpoints here (through the host fetch
 * relay). Access is limited to loopback callers and to plugins that are enabled,
 * healthy and granted the `http.route` capability. Handlers receive method /
 * params / query / body only — never any host token.
 */
type Ctx = { params: Promise<{ pluginId: string; path?: string[] }> };

function isLoopback(host: string | null): boolean {
  if (!host) return false;
  const h = host.replace(/:\d+$/, "");
  return h === "127.0.0.1" || h === "localhost" || h === "::1" || h === "[::1]";
}

async function handle(req: Request, ctx: Ctx): Promise<Response> {
  await connection();
  if (!isLoopback(req.headers.get("host"))) {
    return errorResponse("Forbidden", 403);
  }
  const { pluginId, path } = await ctx.params;
  if (!pluginId || !/^[a-z0-9_][a-z0-9_-]*$/.test(pluginId)) {
    return errorResponse("Unknown plugin", 404);
  }

  const reqPath = (path ?? []).join("/");
  const url = new URL(req.url);
  const query: Record<string, string> = {};
  url.searchParams.forEach((value, key) => {
    query[key] = value;
  });

  let body: unknown;
  if (req.method !== "GET" && req.method !== "HEAD") {
    const text = await req.text();
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        return errorResponse("Invalid JSON body", 400);
      }
    }
  }

  const result = await dispatchPluginHttp(pluginId, req.method, reqPath, { query, body });
  return Response.json(result.body ?? { ok: true }, { status: result.status });
}

export async function GET(req: Request, ctx: Ctx): Promise<Response> {
  return handle(req, ctx);
}
export async function POST(req: Request, ctx: Ctx): Promise<Response> {
  return handle(req, ctx);
}
export async function PUT(req: Request, ctx: Ctx): Promise<Response> {
  return handle(req, ctx);
}
export async function PATCH(req: Request, ctx: Ctx): Promise<Response> {
  return handle(req, ctx);
}
export async function DELETE(req: Request, ctx: Ctx): Promise<Response> {
  return handle(req, ctx);
}
