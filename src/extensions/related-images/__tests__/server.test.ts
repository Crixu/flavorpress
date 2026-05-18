import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSessionCookie } from "@/lib/auth";
import { db, ensureSchema } from "@/lib/db";
import {
  createTwoUserFixture,
  seedClusterForUser,
  seedDraftForUser,
  seedOutletForUser,
} from "@/lib/__tests__/__helpers__/two-user-fixture";
import {
  _resetLookupForTests,
  _resetPinnedFetchForTests,
  _setLookupForTests,
  _setPinnedFetchForTests,
} from "@/lib/v1/safe-fetch";

let cookieJar: Map<string, string>;

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = cookieJar.get(name);
      return value ? { value } : undefined;
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

const SECRET = "test-secret-that-is-at-least-32-bytes-long!!";

beforeEach(async () => {
  cookieJar = new Map();
  process.env.FLAVORPRESS_SESSION_SECRET = SECRET;
  process.env.FLAVORPRESS_ALLOWED_ORIGINS = "http://localhost:3000";
  delete process.env.FLAVORPRESS_AUTH;
  vi.clearAllMocks();
  _setLookupForTests(async () => [{ address: "8.8.8.8", family: 4 }]);
  await ensureSchema();
  await db.execute({
    sql: `DELETE FROM user_settings WHERE key = ?`,
    args: ["related_images_license_filter"],
  });
});

afterEach(() => {
  _resetLookupForTests();
  _resetPinnedFetchForTests();
});

describe("runRelatedImageSearch", () => {
  it("uses safe fetch and drops Openverse hits with non-http URLs", async () => {
    const { draftId } = await createDraftAndLogin();
    const fetchMock = vi.fn(async (target) => {
      expect(target.url.hostname).toBe("api.openverse.org");
      expect(target.url.searchParams.get("page_size")).toBe("12");
      return new Response(
        JSON.stringify({
          results: [
            openverseHit({ title: "Valid", url: "https://images.example/valid.jpg" }),
            openverseHit({ title: "Bad image", url: "javascript:alert(1)" }),
            openverseHit({ title: "Bad thumb", thumbnail: "data:image/png;base64,abc" }),
            openverseHit({ title: "Bad source", foreign_landing_url: "file:///etc/passwd" }),
            openverseHit({
              title: "Bad optional URLs",
              url: "https://images.example/optional.jpg",
              creator_url: "javascript:alert(1)",
              license_url: "ftp://licenses.example/by",
            }),
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    _setPinnedFetchForTests(fetchMock);

    const { runRelatedImageSearch } = await import("../server");
    const { results } = await runRelatedImageSearch(draftId);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(results).toHaveLength(2);
    expect(results.map((result) => result.title)).toEqual(["Valid", "Bad optional URLs"]);
    expect(results[1]!.creatorUrl).toBeNull();
    expect(results[1]!.licenseUrl).toBeNull();

    const persisted = await db.execute({
      sql: `SELECT title, image_url, thumbnail_url, source_url, creator_url, license_url
            FROM related_image_results
            WHERE draft_id = ?
            ORDER BY result_index ASC`,
      args: [draftId],
    });
    expect(persisted.rows).toHaveLength(2);
    expect(String(persisted.rows[0]!.image_url)).toBe("https://images.example/valid.jpg");
  });

  it("returns an action error when Openverse exceeds the safe body cap", async () => {
    const { draftId } = await createDraftAndLogin();
    _setPinnedFetchForTests(
      vi.fn(async () => new Response("x".repeat(2_000_001), { status: 200 })),
    );

    const { runRelatedImagesAction } = await import("../actions");
    const formData = new FormData();
    formData.set("draftId", draftId);

    await expect(runRelatedImagesAction(formData)).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining("response body exceeded 2000000 bytes"),
    });
  });
});

async function createDraftAndLogin(): Promise<{ draftId: string }> {
  const { userA } = await createTwoUserFixture();
  const outletId = await seedOutletForUser(userA.id);
  const clusterId = await seedClusterForUser(userA.id);
  const draftId = await seedDraftForUser(userA.id, { clusterId, outletId });
  const cookie = await createSessionCookie({
    userId: userA.id,
    sessionVersion: 0,
    secret: SECRET,
  });
  cookieJar.set("flavorpress_session", cookie.value);
  return { draftId };
}

function openverseHit(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    title: "Example",
    url: "https://images.example/image.jpg",
    thumbnail: "https://images.example/thumb.jpg",
    foreign_landing_url: "https://source.example/page",
    creator: "Creator",
    creator_url: "https://creator.example/",
    license: "cc0",
    license_version: "1.0",
    license_url: "https://license.example/cc0",
    source: "example",
    width: 1200,
    height: 800,
    ...overrides,
  };
}
