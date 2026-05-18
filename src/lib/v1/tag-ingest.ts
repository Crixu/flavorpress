import "server-only";

import { db } from "@/lib/db";
import { extractItemTags } from "@/lib/v1/tagger";

/**
 * Persist LLM-extracted tags for an item.
 *
 * Fire-and-forget. Returns the count of tags persisted (0 on any failure).
 * Does not throw. Caller's only obligation is `void tagItem(id)` (or `await`
 * if it cares about completion).
 */
export async function tagItem(itemId: string): Promise<number> {
  const r = await db.execute({
    sql: `SELECT user_id, title, body FROM items WHERE id = ?`,
    args: [itemId],
  });
  const row = r.rows[0];
  if (!row) return 0;
  const userId = String(row.user_id ?? "");
  const title = String(row.title ?? "");
  const body = String(row.body ?? "");
  if (!userId || (!title && !body)) return 0;

  const tags = await extractItemTags({ userId, title, body });
  if (tags.length === 0) return 0;

  const now = Date.now();
  for (const tag of tags) {
    await db.execute({
      sql: `INSERT OR REPLACE INTO item_tags (item_id, tag, confidence, created_at)
            VALUES (?, ?, ?, ?)`,
      args: [itemId, tag, 1.0, now],
    });
  }
  return tags.length;
}
