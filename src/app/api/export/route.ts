/**
 * User-facing export. Returns the writer's drafts, voice profiles, outlets,
 * source folders, sources, and source-to-outlet assignments as a JSON
 * download. Application passwords and other secrets are stripped in
 * `buildExportEnvelope`.
 */

import { ensureSchema } from "@/lib/db";
import { AuthRequiredError, requireSession } from "@/lib/session";
import { buildExportEnvelope, exportFilename } from "@/lib/v1/export";

export const dynamic = "force-dynamic";

export async function GET() {
  let session;
  try {
    session = await requireSession();
  } catch (err) {
    if (err instanceof AuthRequiredError) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      });
    }
    throw err;
  }
  await ensureSchema();
  const envelope = await buildExportEnvelope(session.userId);
  const body = JSON.stringify(envelope, null, 2);
  return new Response(body, {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="${exportFilename(envelope.generatedAt)}"`,
      "cache-control": "no-store",
    },
  });
}
