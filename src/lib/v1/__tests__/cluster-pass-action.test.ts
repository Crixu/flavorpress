import { describe, expect, it, vi, beforeEach } from "vitest";

// Mock the cluster engine so tests don't process the full local item DB.
// The engine's behavior is tested separately in cluster-engine.test.ts.
const { handleItemIngestedMock } = vi.hoisted(() => ({
  handleItemIngestedMock: vi.fn().mockResolvedValue({ clusterId: null, layer: null }),
}));

vi.mock("@/lib/v1/cluster-engine", async (importOriginal) => {
  const original = await importOriginal();
  return {
    ...(original as object),
    handleItemIngested: handleItemIngestedMock,
  };
});

// Mock event-bus so cluster handlers don't run during test.
vi.mock("@/lib/v1/event-bus", () => ({
  getBus: () => ({ emit: vi.fn().mockResolvedValue({}) }),
}));

import { runClusterPassAction } from "@/lib/v1/actions";
import { ensureSchema, ensureSingleUser, db, SINGLE_USER_ID } from "@/lib/db";

describe("runClusterPassAction", () => {
  beforeEach(async () => {
    await ensureSchema();
    await ensureSingleUser();
    handleItemIngestedMock.mockReset().mockResolvedValue({ clusterId: null, layer: null });
  });

  it("returns a result with clustersFired and itemsClustered counts", async () => {
    const result = await runClusterPassAction();
    expect(result).toHaveProperty("clustersFired");
    expect(result).toHaveProperty("itemsClustered");
    expect(typeof result.clustersFired).toBe("number");
    expect(typeof result.itemsClustered).toBe("number");
    expect(result.clustersFired).toBeGreaterThanOrEqual(0);
    expect(result.itemsClustered).toBeGreaterThanOrEqual(0);
  });

  it("counts new fired clusters and newly clustered items as a delta", async () => {
    // Seed a source and two unclustered items published within the 72h window.
    const suffix = Math.random().toString(36).slice(2, 10);
    const sourceId = `s-${suffix}`;
    const itemIdA = `i-a-${suffix}`;
    const itemIdB = `i-b-${suffix}`;
    const now = Date.now();

    await db.execute({
      sql: `INSERT INTO sources (id, user_id, kind, url, active, trust_score, created_at)
            VALUES (?, ?, 'rss', ?, 1, 0.9, ?)`,
      args: [sourceId, SINGLE_USER_ID, `https://techblog-${suffix}.example.com/feed`, now],
    });
    await db.execute({
      sql: `INSERT INTO items (id, user_id, source_id, canonical_url, content_hash, title, lede, body, published_at, fetched_at)
            VALUES (?, ?, ?, ?, ?, 'Item A', 'lede A', 'body', ?, ?)`,
      args: [
        itemIdA,
        SINGLE_USER_ID,
        sourceId,
        `https://techblog-${suffix}.example.com/${itemIdA}`,
        `hash-${itemIdA}`,
        now - 1000,
        now - 1000,
      ],
    });
    await db.execute({
      sql: `INSERT INTO items (id, user_id, source_id, canonical_url, content_hash, title, lede, body, published_at, fetched_at)
            VALUES (?, ?, ?, ?, ?, 'Item B', 'lede B', 'body', ?, ?)`,
      args: [
        itemIdB,
        SINGLE_USER_ID,
        sourceId,
        `https://techblog-${suffix}.example.com/${itemIdB}`,
        `hash-${itemIdB}`,
        now - 500,
        now - 500,
      ],
    });

    // Simulate the engine forming and firing a cluster when item B is ingested:
    // set a cluster_id on both items (as the real engine would via DB writes)
    // and insert a fired cluster row so the after-count is higher.
    const clusterId = `clus-${suffix}`;
    let callCount = 0;
    handleItemIngestedMock.mockImplementation(async (_payload) => {
      callCount++;
      if (callCount === 2) {
        // Second item ingested triggers cluster formation and firing.
        await db.execute({
          sql: `INSERT INTO clusters (id, user_id, primary_entities, formed_at, fired_at, source_count, state)
                VALUES (?, ?, '[]', ?, ?, 1, 'fired')`,
          args: [clusterId, SINGLE_USER_ID, now, now],
        });
        await db.execute({
          sql: `UPDATE items SET cluster_id = ? WHERE id IN (?, ?)`,
          args: [clusterId, itemIdA, itemIdB],
        });
      }
      return { clusterId: callCount === 2 ? clusterId : null, layer: null };
    });

    const result = await runClusterPassAction();

    // Both new items should have been processed.
    expect(handleItemIngestedMock).toHaveBeenCalledWith(
      expect.objectContaining({ itemId: itemIdA }),
      expect.any(Object),
    );
    expect(handleItemIngestedMock).toHaveBeenCalledWith(
      expect.objectContaining({ itemId: itemIdB }),
      expect.any(Object),
    );

    // Delta counts reflect the cluster + items created by the mock engine.
    expect(result.clustersFired).toBeGreaterThanOrEqual(1);
    expect(result.itemsClustered).toBeGreaterThanOrEqual(2);
  });
});
