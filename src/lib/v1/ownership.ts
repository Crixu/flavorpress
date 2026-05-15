import { db, ensureSchema } from "../db";

async function assertOwnsRow(table: string, id: string, userId: string): Promise<void> {
  await ensureSchema();
  const r = await db.execute({
    sql: `SELECT 1 FROM ${table} WHERE id = ? AND user_id = ? LIMIT 1`,
    args: [id, userId],
  });
  if (r.rows.length === 0) throw new Error("Not found.");
}

export function assertOwnsCluster(clusterId: string, userId: string): Promise<void> {
  return assertOwnsRow("clusters", clusterId, userId);
}

export function assertOwnsDraft(draftId: string, userId: string): Promise<void> {
  return assertOwnsRow("drafts", draftId, userId);
}

export function assertOwnsOutlet(outletId: string, userId: string): Promise<void> {
  return assertOwnsRow("outlets", outletId, userId);
}

export function assertOwnsSource(sourceId: string, userId: string): Promise<void> {
  return assertOwnsRow("sources", sourceId, userId);
}

export function assertOwnsFolder(folderId: string, userId: string): Promise<void> {
  return assertOwnsRow("source_folders", folderId, userId);
}
