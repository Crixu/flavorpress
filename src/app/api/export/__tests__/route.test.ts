import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { db, ensureSchema } from "@/lib/db";
import {
  createTwoUserFixture,
  seedOutletForUser,
  seedSourceForUser,
} from "@/lib/__tests__/__helpers__/two-user-fixture";
import { SESSION_COOKIE_NAME, createSessionCookie } from "@/lib/auth";

let cookieJar: Map<string, string>;

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (n: string) => {
      const v = cookieJar.get(n);
      return v ? { value: v } : undefined;
    },
    set: () => {},
  }),
  headers: async () => ({
    get: () => null,
  }),
}));

const SECRET = "test-secret-that-is-at-least-32-bytes-long!!";

beforeEach(async () => {
  await ensureSchema();
  await db.execute("DELETE FROM users");
  cookieJar = new Map();
  process.env.FLAVORPRESS_SESSION_SECRET = SECRET;
  delete process.env.FLAVORPRESS_AUTH;
});

afterEach(() => {
  delete process.env.FLAVORPRESS_SESSION_SECRET;
  delete process.env.FLAVORPRESS_AUTH;
});

async function loginAs(userId: string): Promise<void> {
  const c = await createSessionCookie({ userId, sessionVersion: 0, secret: SECRET });
  cookieJar.set(SESSION_COOKIE_NAME, c.value);
}

describe("GET /api/export isolation", () => {
  it("returns 401 when not authenticated", async () => {
    const { GET } = await import("@/app/api/export/route");
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("returns only the calling user's data, not data belonging to another user", async () => {
    const { userA, userB } = await createTwoUserFixture();
    await seedOutletForUser(userA.id, {
      id: "o_a_isolated",
      baseUrl: "https://a.test",
      displayName: "A site",
    });
    await seedSourceForUser(userA.id, { id: "s_a_isolated", url: "https://a.test/feed" });

    await loginAs(userB.id);
    const { GET } = await import("@/app/api/export/route");
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    const ser = JSON.stringify(body);

    // User B's export must not contain any of user A's identifiers
    expect(ser).not.toContain("o_a_isolated");
    expect(ser).not.toContain("s_a_isolated");
    expect(ser).not.toContain("A site");
    expect(ser).not.toContain("a@example.com");

    // User B's record must be present
    expect(body.user?.id).toBe(userB.id);
    expect(body.user?.email).toBe("b@example.com");
    // User B has no outlets or sources seeded
    expect(body.outlets).toHaveLength(0);
    expect(body.sources).toHaveLength(0);
  });
});
