/**
 * User-facing export. Returns the writer's drafts, voice profiles, outlets,
 * source folders, sources, and source-to-outlet assignments as a JSON
 * download. Application passwords and other secrets are stripped in
 * `buildExportEnvelope`.
 */

import { ensureSchema, ensureSingleUser } from "@/lib/db";
import { buildExportEnvelope, exportFilename } from "@/lib/v1/export";

export const dynamic = "force-dynamic";

export async function GET() {
  await ensureSchema();
  await ensureSingleUser();
  const envelope = await buildExportEnvelope();
  const body = JSON.stringify(envelope, null, 2);
  return new Response(body, {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="${exportFilename(envelope.generatedAt)}"`,
      "cache-control": "no-store",
    },
  });
}
