import { describe, expect, it, vi } from "vitest";
import { db, ensureSchema } from "@/lib/db";
import { deleteTodayCache, getTodayCachedViewState, refreshTodayCacheForUser } from "../today-view";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

describe("today view cache", () => {
  it("drops cached cluster payloads and excludes drafted clusters on rebuild", async () => {
    await ensureSchema();
    const ids = await seedTodayUser();

    const first = await refreshTodayCacheForUser(ids.userId);
    expect(first?.ready.totalPreviews).toBe(1);

    let cached = await getTodayCachedViewState(ids.userId);
    expect(cached.status).toBe("fresh");
    expect(cached.payload?.ready.totalPreviews).toBe(1);

    await db.execute({
      sql: `UPDATE clusters SET state = 'drafted' WHERE id = ? AND user_id = ?`,
      args: [ids.clusterId, ids.userId],
    });
    await deleteTodayCache(ids.userId);

    cached = await getTodayCachedViewState(ids.userId);
    expect(cached.status).toBe("missing");
    expect(cached.payload).toBeNull();

    const rebuilt = await refreshTodayCacheForUser(ids.userId);
    expect(rebuilt?.ready.totalPreviews).toBe(0);
  });
});

async function seedTodayUser(): Promise<{ userId: string; clusterId: string }> {
  const suffix = crypto.randomUUID();
  const userId = `today-cache-user-${suffix}`;
  const folderId = `today-cache-folder-${suffix}`;
  const outletId = `today-cache-outlet-${suffix}`;
  const clusterId = `today-cache-cluster-${suffix}`;
  const now = Date.now();

  await db.execute({
    sql: `INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)`,
    args: [userId, `${userId}@example.com`, now],
  });
  await db.execute({
    sql: `INSERT INTO source_folders (id, user_id, name, sort_order, created_at)
          VALUES (?, ?, 'Tech', 0, ?)`,
    args: [folderId, userId, now],
  });
  await db.execute({
    sql: `INSERT INTO outlets
            (id, user_id, base_url, display_name, app_password_encrypted, is_default, created_at)
          VALUES (?, ?, 'https://example.com', 'Example', X'01', 1, ?)`,
    args: [outletId, userId, now],
  });
  await db.execute({
    sql: `INSERT INTO voice_profiles
            (outlet_id, user_id, style_sheet_yaml, archive_index_size, signature_terms, last_rebuilt_at)
          VALUES (?, ?, 'style: test', 1, '[]', ?)`,
    args: [outletId, userId, now],
  });

  const sourceIds = Array.from(
    { length: 5 },
    (_, index) => `today-cache-source-${index}-${suffix}`,
  );
  for (const sourceId of sourceIds) {
    await db.execute({
      sql: `INSERT INTO sources
              (id, user_id, kind, url, display_name, folder_id, trust_score, active, created_at)
            VALUES (?, ?, 'rss', ?, ?, ?, 0.8, 1, ?)`,
      args: [
        sourceId,
        userId,
        `https://source-${sourceId}.example.com/feed`,
        `Source ${sourceId}`,
        folderId,
        now,
      ],
    });
  }

  await db.execute({
    sql: `INSERT INTO clusters
            (id, user_id, primary_entities, formed_at, fired_at, source_count, ranker_score, state)
          VALUES (?, ?, '["OpenAI"]', ?, ?, 1, 0.9, 'fired')`,
    args: [clusterId, userId, now, now],
  });
  await db.execute({
    sql: `INSERT INTO items
            (id, source_id, user_id, canonical_url, content_hash, title, lede,
             published_at, fetched_at, entities, primary_subject, beat_tag, cluster_id)
          VALUES (?, ?, ?, ?, 'hash', 'A story', 'A lede', ?, ?, '["OpenAI"]', 'openai', 'ai', ?)`,
    args: [
      `today-cache-item-${suffix}`,
      sourceIds[0],
      userId,
      `https://example.com/story-${suffix}`,
      now,
      now,
      clusterId,
    ],
  });

  return { userId, clusterId };
}
