import { beforeEach, describe, expect, it, vi } from "vitest";

// --- hoisted mocks ---
const { executeMock, ensureSchemaMock, emitMock } = vi.hoisted(() => ({
  executeMock: vi.fn(),
  ensureSchemaMock: vi.fn(),
  emitMock: vi.fn().mockResolvedValue({}),
}));

vi.mock("../../db", () => ({
  db: { execute: executeMock },
  ensureSchema: ensureSchemaMock,
}));

vi.mock("../event-bus", () => ({
  getBus: () => ({ emit: emitMock }),
}));

vi.mock("../trace", () => ({
  traceLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
  }),
}));

vi.mock("../merge-oracle", () => ({
  askMergeOracle: vi.fn().mockResolvedValue(null),
}));

import { handleItemIngested } from "../cluster-engine";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeItemRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "item-1",
    source_id: "source-1",
    user_id: "user-1",
    canonical_url: "https://example.com/story",
    content_hash: "hash-abc",
    doi: null,
    title: "Breaking: OpenAI Releases GPT-5",
    lede: "OpenAI released GPT-5 today, marking a milestone.",
    body: null,
    authors: null,
    published_at: 1_746_500_000_000,
    fetched_at: 1_746_500_000_000,
    entities: null,
    primary_subject: null,
    beat_tag: null,
    cluster_id: null,
    marked_at: 1_746_500_001_000,
    dismissed_at: null,
    score: null,
    comment_count: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Test: single-source cluster fires
// ---------------------------------------------------------------------------

describe("handleItemIngested - single-source firing", () => {
  beforeEach(() => {
    executeMock.mockReset();
    ensureSchemaMock.mockReset();
    emitMock.mockReset().mockResolvedValue({});
  });

  it("fires a cluster with source_count=1 without requiring 2+ distinct domains", async () => {
    const itemRow = makeItemRow();

    executeMock.mockImplementation((query: { sql: string; args?: unknown[] }) => {
      const sql = query.sql ?? "";

      // 1. Fetch the incoming item by id.
      if (sql.includes("SELECT * FROM items WHERE id =")) {
        return Promise.resolve({ rows: [itemRow] });
      }

      // 2. Window query - no other items in the window so no Layer 1/2/3 merges.
      if (sql.includes("SELECT * FROM items") && sql.includes("AND id !=")) {
        return Promise.resolve({ rows: [] });
      }

      // 3. maybeFireCluster SELECT - returns a cluster with source_count=1,
      //    distinct_domains=1, trust_sum=0.9 (single high-trust source).
      if (sql.includes("SELECT c.id, c.state") && sql.includes("FROM clusters c WHERE c.id =")) {
        return Promise.resolve({
          rows: [
            {
              id: "cluster-1",
              state: "forming",
              source_count: 1,
              primary_entities: JSON.stringify(["OpenAI", "GPT-5"]),
              distinct_domains: 1,
              trust_sum: 0.9,
            },
          ],
        });
      }

      // 4. All other writes (UPDATE clusters state, INSERT cluster, etc.) succeed.
      return Promise.resolve({ rows: [], rowsAffected: 1 });
    });

    // The item has no cluster yet and no window peers, so handleItemIngested
    // returns { clusterId: null, layer: null } - it does not form a new cluster
    // on its own via layers 1/2/3 (those need a peer to merge with). The
    // single-source firing path is exercised via maybeFireCluster, which is
    // called after any layer assigns an item to an existing cluster.
    //
    // To unit-test maybeFireCluster in isolation we seed an item that already
    // has a cluster_id so Layer 1 (exact-URL match) can pick it up and
    // trigger maybeFireCluster on the existing cluster.

    const itemWithCluster = makeItemRow({ cluster_id: "cluster-1" });
    const windowPeer = {
      ...itemWithCluster,
      id: "item-peer",
      canonical_url: "https://example.com/story", // same URL triggers Layer 1
      cluster_id: "cluster-1",
    };

    executeMock.mockReset();
    executeMock.mockImplementation((query: { sql: string; args?: unknown[] }) => {
      const sql = query.sql ?? "";

      if (sql.includes("SELECT * FROM items WHERE id =")) {
        return Promise.resolve({
          rows: [makeItemRow({ id: "item-2", canonical_url: "https://example.com/story" })],
        });
      }

      if (sql.includes("SELECT * FROM items") && sql.includes("AND id !=")) {
        return Promise.resolve({ rows: [windowPeer] });
      }

      if (sql.includes("SELECT c.id, c.state") && sql.includes("FROM clusters c WHERE c.id =")) {
        return Promise.resolve({
          rows: [
            {
              id: "cluster-1",
              state: "forming",
              source_count: 1,
              primary_entities: JSON.stringify(["OpenAI", "GPT-5"]),
              distinct_domains: 1,
              trust_sum: 0.9,
            },
          ],
        });
      }

      if (sql.includes("SELECT primary_entities FROM clusters WHERE id =")) {
        return Promise.resolve({
          rows: [{ primary_entities: JSON.stringify(["OpenAI", "GPT-5"]) }],
        });
      }

      return Promise.resolve({ rows: [], rowsAffected: 1 });
    });

    const result = await handleItemIngested(
      {
        itemId: "item-2",
        sourceId: "source-1",
        canonicalUrl: "https://example.com/story",
        contentHash: "hash-abc",
      },
      { traceId: "trace-test", userId: "user-1" },
    );

    // Layer 1 should have matched via exact URL.
    expect(result.layer).toBe(1);
    expect(result.clusterId).toBe("cluster-1");

    // The cluster.threshold_crossed event should have been emitted, meaning
    // maybeFireCluster decided to fire despite distinct_domains=1.
    expect(emitMock).toHaveBeenCalledWith(
      "cluster.threshold_crossed",
      expect.objectContaining({ clusterId: "cluster-1", sourceCount: 1 }),
      expect.objectContaining({ idempotencyKey: "cluster.fired:cluster-1" }),
    );
  });

  it("still fires multi-source clusters when trust sum and domain guard pass", async () => {
    const windowPeer = makeItemRow({
      id: "item-peer",
      canonical_url: "https://other.com/story",
      cluster_id: "cluster-multi",
    });

    executeMock.mockImplementation((query: { sql: string; args?: unknown[] }) => {
      const sql = query.sql ?? "";

      if (sql.includes("SELECT * FROM items WHERE id =")) {
        return Promise.resolve({
          rows: [makeItemRow({ id: "item-3", canonical_url: "https://other.com/story" })],
        });
      }

      if (sql.includes("SELECT * FROM items") && sql.includes("AND id !=")) {
        return Promise.resolve({ rows: [windowPeer] });
      }

      if (sql.includes("SELECT c.id, c.state") && sql.includes("FROM clusters c WHERE c.id =")) {
        return Promise.resolve({
          rows: [
            {
              id: "cluster-multi",
              state: "forming",
              source_count: 2,
              primary_entities: JSON.stringify(["OpenAI"]),
              distinct_domains: 2,
              trust_sum: 1.0,
            },
          ],
        });
      }

      if (sql.includes("SELECT primary_entities FROM clusters WHERE id =")) {
        return Promise.resolve({
          rows: [{ primary_entities: JSON.stringify(["OpenAI"]) }],
        });
      }

      return Promise.resolve({ rows: [], rowsAffected: 1 });
    });

    const result = await handleItemIngested(
      {
        itemId: "item-3",
        sourceId: "source-1",
        canonicalUrl: "https://other.com/story",
        contentHash: "hash-def",
      },
      { traceId: "trace-multi", userId: "user-1" },
    );

    expect(result.layer).toBe(1);
    expect(result.clusterId).toBe("cluster-multi");
    expect(emitMock).toHaveBeenCalledWith(
      "cluster.threshold_crossed",
      expect.objectContaining({ clusterId: "cluster-multi", sourceCount: 2 }),
      expect.anything(),
    );
  });

  it("does not fire a multi-source cluster when trust sum is below threshold", async () => {
    const windowPeer = makeItemRow({
      id: "item-peer-low",
      canonical_url: "https://lowsignal.com/story",
      cluster_id: "cluster-low",
    });

    executeMock.mockImplementation((query: { sql: string; args?: unknown[] }) => {
      const sql = query.sql ?? "";

      if (sql.includes("SELECT * FROM items WHERE id =")) {
        return Promise.resolve({
          rows: [makeItemRow({ id: "item-4", canonical_url: "https://lowsignal.com/story" })],
        });
      }

      if (sql.includes("SELECT * FROM items") && sql.includes("AND id !=")) {
        return Promise.resolve({ rows: [windowPeer] });
      }

      if (sql.includes("SELECT c.id, c.state") && sql.includes("FROM clusters c WHERE c.id =")) {
        return Promise.resolve({
          rows: [
            {
              id: "cluster-low",
              state: "forming",
              source_count: 2,
              primary_entities: JSON.stringify([]),
              distinct_domains: 2,
              trust_sum: 0.4, // below CLUSTER_TRUST_FIRE_SUM=1.0
            },
          ],
        });
      }

      if (sql.includes("SELECT primary_entities FROM clusters WHERE id =")) {
        return Promise.resolve({ rows: [{ primary_entities: JSON.stringify([]) }] });
      }

      return Promise.resolve({ rows: [], rowsAffected: 1 });
    });

    await handleItemIngested(
      {
        itemId: "item-4",
        sourceId: "source-1",
        canonicalUrl: "https://lowsignal.com/story",
        contentHash: "hash-ghi",
      },
      { traceId: "trace-low", userId: "user-1" },
    );

    expect(emitMock).not.toHaveBeenCalled();
  });
});
