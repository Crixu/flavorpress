import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/v1/tagger", () => ({
  extractItemTags: vi.fn(),
}));

import { extractItemTags } from "@/lib/v1/tagger";
import { ensureSchema, db } from "@/lib/db";
import { createUser } from "@/lib/users";
import { hashPassword } from "@/lib/password";
import { tagItem } from "@/lib/v1/tag-ingest";

let userId: string;

describe("tagItem", () => {
  beforeEach(async () => {
    await ensureSchema();
    await db.execute("DELETE FROM users");
    const u = await createUser({
      email: "test@example.com",
      passwordHash: await hashPassword("correct horse battery staple"),
    });
    userId = u.id;
    vi.mocked(extractItemTags).mockReset();
  });

  it("returns 0 when item not found", async () => {
    const count = await tagItem("missing-id");
    expect(count).toBe(0);
    expect(extractItemTags).not.toHaveBeenCalled();
  });

  it("persists extracted tags into item_tags", async () => {
    const sourceId = `s-${Math.random().toString(36).slice(2, 10)}`;
    const itemId = `i-${Math.random().toString(36).slice(2, 10)}`;
    await db.execute({
      sql: `INSERT INTO sources (id, user_id, kind, url, active, created_at)
            VALUES (?, ?, 'rss', 'https://example.com/feed', 1, ?)`,
      args: [sourceId, userId, Date.now()],
    });
    await db.execute({
      sql: `INSERT INTO items (id, user_id, source_id, canonical_url, content_hash, title, lede, body, published_at, fetched_at)
            VALUES (?, ?, ?, ?, ?, 'Slow espresso', 'Lede about coffee', 'Body about coffee', ?, ?)`,
      args: [
        itemId,
        userId,
        sourceId,
        `https://example.com/${itemId}`,
        `hash-${itemId}`,
        Date.now(),
        Date.now(),
      ],
    });
    vi.mocked(extractItemTags).mockResolvedValue(["espresso", "coffee"]);
    const count = await tagItem(itemId);
    expect(count).toBe(2);

    const r = await db.execute({
      sql: `SELECT tag FROM item_tags WHERE item_id = ? ORDER BY tag`,
      args: [itemId],
    });
    const tags = r.rows.map((row) => row.tag);
    expect(tags).toEqual(["coffee", "espresso"]);
  });

  it("returns 0 when extractor returns empty", async () => {
    const sourceId = `s-${Math.random().toString(36).slice(2, 10)}`;
    const itemId = `i-${Math.random().toString(36).slice(2, 10)}`;
    await db.execute({
      sql: `INSERT INTO sources (id, user_id, kind, url, active, created_at)
            VALUES (?, ?, 'rss', 'https://example.com/feed', 1, ?)`,
      args: [sourceId, userId, Date.now()],
    });
    await db.execute({
      sql: `INSERT INTO items (id, user_id, source_id, canonical_url, content_hash, title, lede, body, published_at, fetched_at)
            VALUES (?, ?, ?, ?, ?, 'x', 'lede-x', 'y', ?, ?)`,
      args: [
        itemId,
        userId,
        sourceId,
        `https://example.com/${itemId}`,
        `hash-${itemId}`,
        Date.now(),
        Date.now(),
      ],
    });
    vi.mocked(extractItemTags).mockResolvedValue([]);
    const count = await tagItem(itemId);
    expect(count).toBe(0);

    const r = await db.execute({
      sql: `SELECT COUNT(*) AS n FROM item_tags WHERE item_id = ?`,
      args: [itemId],
    });
    expect(Number(r.rows[0]!.n)).toBe(0);
  });
});
