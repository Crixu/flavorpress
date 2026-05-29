import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import {
  createTwoUserFixture,
  seedClusterForUser,
  seedFolderForUser,
} from "@/lib/__tests__/__helpers__/two-user-fixture";
import { SESSION_COOKIE_NAME, createSessionCookie } from "@/lib/auth";
import { setUserPlan } from "@/lib/plans";

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

async function sourceFolderIds(sourceId: string): Promise<string[]> {
  const r = await db.execute({
    sql: `SELECT folder_id FROM source_folder_assignments
          WHERE source_id = ?
          ORDER BY folder_id ASC`,
    args: [sourceId],
  });
  return r.rows.map((row) => String(row.folder_id));
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

  it("returns a visible plan limit error from source result actions", async () => {
    const { userA } = await createTwoUserFixture();
    await loginAs(userA.id);
    await setUserPlan(userA.id, "custom", { sources: 1 });
    await db.execute({
      sql: `INSERT INTO sources (id, user_id, kind, url, created_at)
            VALUES ('s_existing', ?, 'rss', 'https://existing.example/feed', ?)`,
      args: [userA.id, Date.now()],
    });
    const fd = new FormData();
    fd.set("urls", "https://new.example/feed");

    const mod = await actions();
    const result = (await mod.addSourceResultAction!(fd)) as {
      ok: boolean;
      error?: string;
      code?: string;
      limit?: number;
    };

    expect(result).toEqual({
      ok: false,
      error: "This plan allows 1 source. Remove a source or ask an admin to raise the cap.",
      code: "plan_limit",
      limit: 1,
    });
    expect(await userSourceUrls(userA.id)).toEqual(["https://existing.example/feed"]);
  });

  it("reuses an existing feed row when adding it to another folder", async () => {
    const { userA } = await createTwoUserFixture();
    const folderA = await seedFolderForUser(userA.id, { name: "Coffee" });
    const folderB = await seedFolderForUser(userA.id, { name: "Tech" });
    await loginAs(userA.id);
    const mod = await actions();

    const first = new FormData();
    first.set("urls", "https://good.example/feed");
    first.set("folderId", folderA);
    await mod.addSourceAction!(first);

    const second = new FormData();
    second.set("urls", "https://good.example/feed");
    second.set("folderId", folderB);
    await mod.addSourceAction!(second);

    const sources = await db.execute({
      sql: `SELECT id, folder_id FROM sources WHERE user_id = ? AND url = ?`,
      args: [userA.id, "https://good.example/feed"],
    });
    expect(sources.rows).toHaveLength(1);
    expect(await sourceFolderIds(String(sources.rows[0]!.id))).toEqual([folderA, folderB].sort());
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
