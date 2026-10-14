import { connection } from "next/server";
import { MAX_PLUGIN_ZIP_BYTES, importPluginZip } from "@/lib/server/plugins";

/**
 * POST /api/plugins/import — install a plugin from a .zip upload.
 *
 * multipart/form-data: `file` (.zip, <= 20 MB) and optional `overwrite`
 * ("true"/"false", default false). See importPluginZip for the layout rules.
 */
export async function POST(req: Request): Promise<Response> {
  await connection();

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ error: "invalid multipart body" }, { status: 400 });
  }

  const file = form.get("file");
  if (
    !file ||
    typeof file !== "object" ||
    typeof (file as Blob).arrayBuffer !== "function"
  ) {
    return Response.json({ error: "file is required" }, { status: 400 });
  }

  const size = typeof (file as Blob).size === "number" ? (file as Blob).size : 0;
  if (size > MAX_PLUGIN_ZIP_BYTES) {
    return Response.json({ error: "too large" }, { status: 413 });
  }

  const overwriteRaw = form.get("overwrite");
  // multipart values are always strings
  const overwrite = overwriteRaw === "true";

  let data: Uint8Array;
  try {
    data = new Uint8Array(await (file as Blob).arrayBuffer());
  } catch {
    return Response.json({ error: "could not read upload" }, { status: 400 });
  }
  if (data.byteLength > MAX_PLUGIN_ZIP_BYTES) {
    return Response.json({ error: "too large" }, { status: 413 });
  }

  const result = await importPluginZip(data, { overwrite });
  if (!result.ok) {
    return Response.json({ error: result.error }, { status: result.status });
  }
  return Response.json({ ok: true, id: result.id, revision: result.revision });
}
