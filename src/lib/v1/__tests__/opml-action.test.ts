import { beforeEach, describe, expect, it, vi } from "vitest";
import { db, ensureSchema } from "@/lib/db";
import { createTwoUserFixture } from "@/lib/__tests__/__helpers__/two-user-fixture";
import { SESSION_COOKIE_NAME, createSessionCookie } from "@/lib/auth";
import type { OpmlParseError, OpmlParseResponse } from "../actions";

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
const VALID_OPML = `<?xml version="1.0"?>
  <opml><body>
    <outline type="rss" title="Sprudge" xmlUrl="https://sprudge.com/feed" />
  </body></opml>`;

async function loginAs(userId: string): Promise<void> {
  const cookie = await createSessionCookie({ userId, sessionVersion: 0, secret: SECRET });
  cookieJar.set(SESSION_COOKIE_NAME, cookie.value);
}

async function parseUpload(file: File): Promise<OpmlParseResponse | OpmlParseError> {
  const fd = {
    get: (name: string) => (name === "file" ? file : null),
  } as unknown as FormData;
  const mod = await import("@/lib/v1/actions");
  return mod.parseOpmlAction(fd);
}

function opmlFile(name: string, type: string, body = VALID_OPML): File {
  const file = new File([body], name, { type });
  Object.defineProperty(file, "text", {
    value: async () => body,
  });
  return file;
}

beforeEach(async () => {
  cookieJar = new Map();
  process.env.FLAVORPRESS_SESSION_SECRET = SECRET;
  process.env.FLAVORPRESS_ALLOWED_ORIGINS = "http://localhost:3000";
  process.env.FLAVORPRESS_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");
  delete process.env.FLAVORPRESS_AUTH;
  await ensureSchema();
  await db.execute("DELETE FROM rate_buckets");
});

describe("parseOpmlAction", () => {
  it("rejects non-XML content before parsing", async () => {
    const { userA } = await createTwoUserFixture();
    await loginAs(userA.id);

    await expect(parseUpload(opmlFile("feeds.opml", "image/png"))).resolves.toEqual({
      ok: false,
      error: "Upload an .opml or .xml file.",
    });
  });

  it("rejects files without an OPML or XML extension", async () => {
    const { userA } = await createTwoUserFixture();
    await loginAs(userA.id);

    await expect(parseUpload(opmlFile("feeds.txt", "text/xml"))).resolves.toEqual({
      ok: false,
      error: "Upload an .opml or .xml file.",
    });
  });

  it("accepts OPML files uploaded as application/octet-stream", async () => {
    const { userA } = await createTwoUserFixture();
    await loginAs(userA.id);

    const result = await parseUpload(opmlFile("feeds.opml", "application/octet-stream"));

    if (!result.ok) throw new Error(result.error);
    expect(result.ok).toBe(true);
    expect(result.feeds).toEqual([
      {
        url: "https://sprudge.com/feed",
        title: "Sprudge",
        groupTitle: null,
        alreadyAdded: false,
      },
    ]);
  });

  it("limits each user to ten OPML parse attempts per hour", async () => {
    const { userA } = await createTwoUserFixture();
    await loginAs(userA.id);

    for (let i = 0; i < 10; i += 1) {
      const result = await parseUpload(opmlFile(`feeds-${i}.opml`, "text/xml"));
      if (!result.ok) throw new Error(result.error);
      expect(result.ok).toBe(true);
    }

    await expect(parseUpload(opmlFile("feeds-10.opml", "text/xml"))).resolves.toEqual({
      ok: false,
      error: "Too many OPML uploads. Try again in an hour.",
    });
  });
});
