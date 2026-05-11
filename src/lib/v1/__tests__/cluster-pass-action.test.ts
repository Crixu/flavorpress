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

// next/headers is not available outside a real request scope; mock it so
// requireSession can read the cookie jar we populate per test.
let cookieJar: Map<string, string>;
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const v = cookieJar.get(name);
      return v ? { value: v } : undefined;
    },
    set: (name: string, value: string) => {
      cookieJar.set(name, value);
    },
  }),
  headers: async () => ({
    get: (name: string) => {
      if (name === "origin") return "http://localhost:3000";
      if (name === "x-forwarded-host") return "localhost:3000";
      return null;
    },
  }),
}));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`__REDIRECT__:${url}`);
  },
}));

import { runClusterPassAction } from "@/lib/v1/actions";
import { ensureSchema, db } from "@/lib/db";
import { createUser } from "@/lib/users";
import { hashPassword } from "@/lib/password";
import { loginAction } from "@/app/login/actions";

let userId: string;

async function seedAndLogin(): Promise<void> {
  await db.execute("DELETE FROM users");
  cookieJar = new Map();
  const u = await createUser({
    email: "test@example.com",
    passwordHash: await hashPassword("correct horse battery staple"),
  });
  userId = u.id;
  // Log in so the session cookie is present for requireSession().
  const formData = new FormData();
  formData.set("email", "test@example.com");
  formData.set("password", "correct horse battery staple");
  try {
    await loginAction(formData);
  } catch (err) {
    // loginAction redirects on success via next/navigation; swallow it.
    if (!(err instanceof Error && err.message.startsWith("__REDIRECT__:"))) {
      throw err;
    }
  }
}

describe("runClusterPassAction", () => {
  beforeEach(async () => {
    process.env.FLAVORPRESS_SESSION_SECRET = "test-secret-that-is-at-least-32-bytes-long!!";
    process.env.FLAVORPRESS_ALLOWED_ORIGINS = "http://localhost:3000";
    await ensureSchema();
    await seedAndLogin();
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
      args: [sourceId, userId, `https://techblog-${suffix}.example.com/feed`, now],
    });
    await db.execute({
      sql: `INSERT INTO items (id, user_id, source_id, canonical_url, content_hash, title, lede, body, published_at, fetched_at)
            VALUES (?, ?, ?, ?, ?, 'Item A', 'lede A', 'body', ?, ?)`,
      args: [
        itemIdA,
        userId,
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
        userId,
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
          args: [clusterId, userId, now, now],
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
