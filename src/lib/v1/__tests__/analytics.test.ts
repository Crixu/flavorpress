import { describe, expect, it } from "vitest";
import { db, ensureSchema } from "@/lib/db";
import { loadReadingToWritingMetrics } from "../analytics";

describe("reading-to-writing analytics", () => {
  it("counts distinct tracked events by user and time scope", async () => {
    await ensureSchema();
    const userId = `analytics-user-${crypto.randomUUID()}`;
    const otherUserId = `analytics-other-${crypto.randomUUID()}`;
    const sinceMs = Date.now();
    const rows = [
      ["source.added", "source.added:s1", userId],
      ["source.added", "source.added:s1", userId],
      ["source.added", "source.added:other", otherUserId],
      ["cluster.formed", "cluster.formed:c1", userId],
      ["cluster.threshold_crossed", "cluster.fired:c1", userId],
      ["draft.rendered", "draft.rendered:d1", userId],
      ["wordpress.pushed", "wordpress.pushed:d1:123", userId],
    ] as const;

    await db.batch(
      rows.map(([type, key, rowUserId], index) => ({
        sql: `INSERT INTO event_log
              (id, user_id, type, payload, idempotency_key, occurred_at)
              VALUES (?, ?, ?, '{}', ?, ?)`,
        args: [crypto.randomUUID(), rowUserId, type, key, sinceMs + index],
      })),
    );

    const metrics = await loadReadingToWritingMetrics({ userId, sinceMs });

    expect(metrics).toEqual({
      sourcesAdded: 1,
      clustersCreated: 1,
      clustersSurfaced: 1,
      draftsRendered: 1,
      wordpressPushes: 1,
    });
  });
});
