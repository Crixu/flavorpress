import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import {
  createTwoUserFixture,
  seedClusterForUser,
} from "@/lib/__tests__/__helpers__/two-user-fixture";
import { SESSION_COOKIE_NAME, createSessionCookie } from "@/lib/auth";

let cookieJar: Map<string, string>;

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (n: string) => {
      const v = cookieJar.get(n);
      return v ? { value: v } : undefined;
    },
    set: (n: string, v: string) => {
      cookieJar.set(n, v);
    },
  }),
  headers: async () => ({
    get: (n: string) => {
      if (n === "origin") return "http://localhost:3000";
      if (n === "x-forwarded-host") return "localhost:3000";
      return null;
    },
  }),
}));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`__REDIRECT__:${url}`);
  },
}));

vi.mock("next/cache", () => ({
  revalidatePath: () => {},
}));

vi.mock("next/server", () => ({
  after: () => {},
}));

const SECRET = "test-secret-that-is-at-least-32-bytes-long!!";

async function loginAs(userId: string): Promise<void> {
  const cookie = await createSessionCookie({ userId, sessionVersion: 0, secret: SECRET });
  cookieJar.set(SESSION_COOKIE_NAME, cookie.value);
}

async function actions(): Promise<Record<string, (f: FormData) => Promise<unknown>>> {
  return (await import("@/lib/v1/actions")) as unknown as Record<
    string,
    (f: FormData) => Promise<unknown>
  >;
}

async function userSourceUrls(userId: string): Promise<string[]> {
  const r = await db.execute({
    sql: `SELECT url FROM sources WHERE user_id = ? ORDER BY created_at ASC`,
    args: [userId],
  });
  return r.rows.map((row) => String(row.url));
}

beforeEach(() => {
  cookieJar = new Map();
  process.env.FLAVORPRESS_SESSION_SECRET = SECRET;
  process.env.FLAVORPRESS_ALLOWED_ORIGINS = "http://localhost:3000";
  process.env.FLAVORPRESS_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");
  delete process.env.FLAVORPRESS_AUTH;
});

describe("source URL validation", () => {
  it.each([
    "javascript:alert(1)",
    "file:///etc/passwd",
    "gopher://example.com/feed",
    "http://user:pass@example.com/feed",
    "data:text/html,<p>bad</p>",
  ])("rejects %s in addSourceAction without inserting", async (url) => {
    const { userA } = await createTwoUserFixture();
    await loginAs(userA.id);
    const fd = new FormData();
    fd.set("urls", url);

    const mod = await actions();
    await mod.addSourceAction!(fd);

    expect(await userSourceUrls(userA.id)).toEqual([]);
  });

  it("keeps the valid URL from a mixed source paste", async () => {
    const { userA } = await createTwoUserFixture();
    await loginAs(userA.id);
    const fd = new FormData();
    fd.set("urls", "https://good.example/feed javascript:alert(1)");

    const mod = await actions();
    await mod.addSourceAction!(fd);

    expect(await userSourceUrls(userA.id)).toEqual(["https://good.example/feed"]);
  });

  it("filters unsafe URLs from OPML selection import before inserting", async () => {
    const { userA } = await createTwoUserFixture();
    await loginAs(userA.id);
    const fd = new FormData();
    fd.append("url", "https://good.example/opml.xml");
    fd.append("title", "Good Feed");
    fd.append("url", "http://user:pass@example.com/feed");
    fd.append("title", "Bad Feed");

    const mod = await actions();
    await mod.importOpmlSelectionAction!(fd);

    expect(await userSourceUrls(userA.id)).toEqual(["https://good.example/opml.xml"]);
  });

  it("rejects unsafe cluster source URLs before creating rows", async () => {
    const { userA } = await createTwoUserFixture();
    const clusterId = await seedClusterForUser(userA.id);
    await loginAs(userA.id);
    const fd = new FormData();
    fd.set("clusterId", clusterId);
    fd.set("url", "http://user:pass@example.com/story");

    const mod = await actions();
    await expect(mod.addSourceToClusterAction!(fd)).rejects.toThrow(/URL/i);

    const items = await db.execute({
      sql: `SELECT id FROM items WHERE user_id = ?`,
      args: [userA.id],
    });
    expect(items.rows).toHaveLength(0);
    expect(await userSourceUrls(userA.id)).toEqual([]);
  });
});
