/**
 * Cross-user isolation audit for extension server entry points.
 *
 * Each test creates two users (A and B), seeds entity rows owned by A,
 * then invokes an extension function while logged in as B using A's ids.
 * The assertion is that A's rows are untouched after the call, and that
 * read-only loaders return no data for B when operating on A's draft id.
 *
 * LLM and HTTP calls are mocked so the suite runs fully offline.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { db } from "@/lib/db";
import {
  createTwoUserFixture,
  seedOutletForUser,
  seedClusterForUser,
  seedDraftForUser,
} from "@/lib/__tests__/__helpers__/two-user-fixture";
import { SESSION_COOKIE_NAME, createSessionCookie } from "@/lib/auth";
import { getSetting, setSetting } from "@/lib/v1/settings";

// ---------------------------------------------------------------------------
// Mock layer
// ---------------------------------------------------------------------------

let cookieJar: Map<string, string>;
const settingStore = vi.hoisted(() => new Map<string, string>());

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

// Anthropic SDK - mock to prevent real API calls in any test that reaches it.
vi.mock("@anthropic-ai/sdk", () => {
  const create = vi.fn().mockResolvedValue({
    stop_reason: "end_turn",
    content: [{ type: "text", text: '{"comments":[]}' }],
  });
  return {
    default: vi.fn().mockImplementation(() => ({ messages: { create } })),
  };
});

// createAnthropicClient used by comment-courtroom.
vi.mock("@/lib/anthropic", () => ({
  createAnthropicClient: vi.fn().mockResolvedValue({
    client: {
      messages: {
        create: vi.fn().mockResolvedValue({
          stop_reason: "end_turn",
          content: [{ type: "text", text: '{"comments":[]}' }],
        }),
      },
    },
    source: "api",
  }),
  extractText: vi.fn().mockReturnValue('{"comments":[]}'),
  extractJson: vi.fn().mockReturnValue({ comments: [] }),
}));

// Settings - mock to avoid DB-level settings reads for model/API key.
vi.mock("@/lib/v1/settings", () => ({
  getAnthropicDraftModel: vi.fn().mockResolvedValue("claude-3-5-sonnet-20241022"),
  getAnthropicApiKey: vi.fn().mockResolvedValue("sk-test-fake-key"),
  getEffectiveDisabledExtensionIds: vi.fn().mockResolvedValue(new Set<string>()),
  getPaidExtensionIds: vi.fn().mockResolvedValue(new Set<string>()),
  getSetting: vi.fn(
    async (key: string, userId: string) => settingStore.get(`${userId}:${key}`) ?? null,
  ),
  setSetting: vi.fn(async (key: string, userId: string, value: string | null) => {
    const scopedKey = `${userId}:${key}`;
    if (value === null) settingStore.delete(scopedKey);
    else settingStore.set(scopedKey, value);
  }),
  SETTING_KEYS: { relatedImagesLicenseFilter: "related_images_license_filter" },
}));

// Openverse HTTP - prevent real network calls from runRelatedImageSearch.
vi.mock("node-fetch", () => ({ default: vi.fn() }));
global.fetch = vi.fn().mockResolvedValue({
  ok: true,
  json: async () => ({ results: [] }),
}) as unknown as typeof fetch;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SECRET = "test-secret-that-is-at-least-32-bytes-long!!";

async function loginAs(userId: string): Promise<void> {
  const cookie = await createSessionCookie({ userId, sessionVersion: 0, secret: SECRET });
  cookieJar.set(SESSION_COOKIE_NAME, cookie.value);
}

/**
 * Seed a comment-courtroom comment row directly (bypasses the LLM call).
 */
async function seedCourtroomComment(draftId: string): Promise<string> {
  const id = crypto.randomUUID();
  await db.execute({
    sql: `INSERT INTO comment_courtroom_comments
          (id, draft_id, parent_id, persona_key, depth, sort_order, body, created_at)
          VALUES (?, ?, NULL, 'enthusiast', 0, 0, 'Seeded comment body.', ?)`,
    args: [id, draftId, Date.now()],
  });
  await db.execute({
    sql: `INSERT INTO comment_courtroom_runs (draft_id, ran_at)
          VALUES (?, ?)
          ON CONFLICT(draft_id) DO UPDATE SET ran_at = excluded.ran_at`,
    args: [draftId, Date.now()],
  });
  return id;
}

/**
 * Seed a fact-check claim row directly (bypasses the LLM + web_search call).
 */
async function seedFactCheckClaim(draftId: string): Promise<string> {
  const id = crypto.randomUUID();
  const ranAt = Date.now();
  await db.execute({
    sql: `INSERT INTO fact_check_claims
          (id, draft_id, claim_index, claim_text, verdict, comment, source_url, source_title, created_at)
          VALUES (?, ?, 1, 'Test claim text', 'supported', 'Test comment.', NULL, NULL, ?)`,
    args: [id, draftId, ranAt],
  });
  const runId = `${draftId}::fact-check::latest`;
  await db.execute({
    sql: `INSERT OR REPLACE INTO fact_check_results
          (id, draft_id, capability_id, idempotency_key, passed, flagged_claim_ids, raw_response, computed_at)
          VALUES (?, ?, 'fact-check', 'latest', 1, '[]', NULL, ?)`,
    args: [runId, draftId, ranAt],
  });
  return id;
}

/**
 * Seed a related-image result row directly (bypasses the Openverse HTTP call).
 */
async function seedRelatedImage(
  draftId: string,
  opts?: { licenseCode?: string; resultIndex?: number },
): Promise<string> {
  const id = crypto.randomUUID();
  const ranAt = Date.now();
  const licenseCode = opts?.licenseCode ?? "cc0";
  const resultIndex = opts?.resultIndex ?? 0;
  await db.execute({
    sql: `INSERT INTO related_image_results
          (id, draft_id, result_index, image_url, thumbnail_url, source_url,
           license_code, searched_at)
          VALUES (?, ?, ?, 'https://example.com/img.jpg', 'https://example.com/thumb.jpg',
                  'https://example.com/source', ?, ?)`,
    args: [id, draftId, resultIndex, licenseCode, ranAt],
  });
  await db.execute({
    sql: `INSERT INTO related_image_runs (draft_id, searched_at, license_filter)
          VALUES (?, ?, 'cc0')
          ON CONFLICT(draft_id) DO UPDATE SET
            searched_at = excluded.searched_at,
            license_filter = excluded.license_filter`,
    args: [draftId, ranAt],
  });
  return id;
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(async () => {
  cookieJar = new Map();
  process.env.FLAVORPRESS_SESSION_SECRET = SECRET;
  process.env.FLAVORPRESS_ALLOWED_ORIGINS = "http://localhost:3000";
  delete process.env.FLAVORPRESS_AUTH;
  settingStore.clear();
  vi.clearAllMocks();
  // Re-apply the fetch mock after clearAllMocks.
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ results: [] }),
  }) as unknown as typeof fetch;
});

// ---------------------------------------------------------------------------
// comment-courtroom: runCommentCourtroom
// ---------------------------------------------------------------------------

describe("runCommentCourtroom - cross-user isolation", () => {
  it("does not run courtroom against user A's draft when called by user B", async () => {
    const { userA, userB } = await createTwoUserFixture();
    const outletId = await seedOutletForUser(userA.id);
    const clusterId = await seedClusterForUser(userA.id);
    const draftId = await seedDraftForUser(userA.id, { clusterId, outletId });
    await seedCourtroomComment(draftId);

    await loginAs(userB.id);

    const { runCommentCourtroom } = await import("../comment-courtroom/server");

    await expect(runCommentCourtroom(draftId)).rejects.toThrow(/draft not found/i);

    // A's comment row must still be present.
    const r = await db.execute({
      sql: `SELECT id FROM comment_courtroom_comments WHERE draft_id = ?`,
      args: [draftId],
    });
    expect(r.rows.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// comment-courtroom: loadCourtroomComments
// ---------------------------------------------------------------------------

describe("loadCourtroomComments - cross-user isolation", () => {
  it("returns empty results for user B reading user A's draft id", async () => {
    const { userA, userB } = await createTwoUserFixture();
    const outletId = await seedOutletForUser(userA.id);
    const clusterId = await seedClusterForUser(userA.id);
    const draftId = await seedDraftForUser(userA.id, { clusterId, outletId });
    await seedCourtroomComment(draftId);

    await loginAs(userB.id);

    const { loadCourtroomComments } = await import("../comment-courtroom/server");

    const result = await loadCourtroomComments(draftId);

    // B must see nothing from A's draft.
    expect(result.comments).toHaveLength(0);
    expect(result.ranAt).toBeNull();

    // A's row must still exist in the DB.
    const r = await db.execute({
      sql: `SELECT id FROM comment_courtroom_comments WHERE draft_id = ?`,
      args: [draftId],
    });
    expect(r.rows.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// comment-courtroom: clearCommentCourtroom
// ---------------------------------------------------------------------------

describe("clearCommentCourtroom - cross-user isolation", () => {
  it("does not delete user A's courtroom data when called by user B", async () => {
    const { userA, userB } = await createTwoUserFixture();
    const outletId = await seedOutletForUser(userA.id);
    const clusterId = await seedClusterForUser(userA.id);
    const draftId = await seedDraftForUser(userA.id, { clusterId, outletId });
    await seedCourtroomComment(draftId);

    await loginAs(userB.id);

    const { clearCommentCourtroom } = await import("../comment-courtroom/server");

    // Should throw rather than silently deleting when the draft doesn't
    // belong to the session user.
    await expect(clearCommentCourtroom(draftId)).rejects.toThrow();

    // A's data must still exist.
    const r = await db.execute({
      sql: `SELECT id FROM comment_courtroom_comments WHERE draft_id = ?`,
      args: [draftId],
    });
    expect(r.rows.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// fact-check: runFactCheck
// ---------------------------------------------------------------------------

describe("runFactCheck - cross-user isolation", () => {
  it("does not run fact-check against user A's draft when called by user B", async () => {
    const { userA, userB } = await createTwoUserFixture();
    const outletId = await seedOutletForUser(userA.id);
    const clusterId = await seedClusterForUser(userA.id);
    const draftId = await seedDraftForUser(userA.id, { clusterId, outletId });
    await seedFactCheckClaim(draftId);

    await loginAs(userB.id);

    const { runFactCheck } = await import("../fact-check/server");

    await expect(runFactCheck(draftId)).rejects.toThrow(/draft not found/i);

    // A's claim row must still exist.
    const r = await db.execute({
      sql: `SELECT id FROM fact_check_claims WHERE draft_id = ?`,
      args: [draftId],
    });
    expect(r.rows.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// fact-check: loadFactCheckRunAt
// ---------------------------------------------------------------------------

describe("loadFactCheckRunAt - cross-user isolation", () => {
  it("returns null for user B reading user A's fact-check run timestamp", async () => {
    const { userA, userB } = await createTwoUserFixture();
    const outletId = await seedOutletForUser(userA.id);
    const clusterId = await seedClusterForUser(userA.id);
    const draftId = await seedDraftForUser(userA.id, { clusterId, outletId });
    await seedFactCheckClaim(draftId);

    await loginAs(userB.id);

    const { loadFactCheckRunAt } = await import("../fact-check/server");

    const ranAt = await loadFactCheckRunAt(draftId);

    // B must not see A's run timestamp.
    expect(ranAt).toBeNull();

    // A's run row must still exist.
    const r = await db.execute({
      sql: `SELECT id FROM fact_check_results WHERE draft_id = ?`,
      args: [draftId],
    });
    expect(r.rows.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// fact-check: loadFactCheckClaims
// ---------------------------------------------------------------------------

describe("loadFactCheckClaims - cross-user isolation", () => {
  it("returns empty claims for user B reading user A's draft id", async () => {
    const { userA, userB } = await createTwoUserFixture();
    const outletId = await seedOutletForUser(userA.id);
    const clusterId = await seedClusterForUser(userA.id);
    const draftId = await seedDraftForUser(userA.id, { clusterId, outletId });
    await seedFactCheckClaim(draftId);

    await loginAs(userB.id);

    const { loadFactCheckClaims } = await import("../fact-check/server");

    const claims = await loadFactCheckClaims(draftId);

    // B must see no claims from A's draft.
    expect(claims).toHaveLength(0);

    // A's claim must still exist.
    const r = await db.execute({
      sql: `SELECT id FROM fact_check_claims WHERE draft_id = ?`,
      args: [draftId],
    });
    expect(r.rows.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// fact-check: suggestFactCheckFix (already scoped via loadDraftAndClaim)
// ---------------------------------------------------------------------------

describe("suggestFactCheckFix - cross-user isolation", () => {
  it("does not generate a fix for user A's claim when called by user B", async () => {
    const { userA, userB } = await createTwoUserFixture();
    const outletId = await seedOutletForUser(userA.id);
    const clusterId = await seedClusterForUser(userA.id);
    const draftId = await seedDraftForUser(userA.id, { clusterId, outletId });
    const claimId = await seedFactCheckClaim(draftId);

    // Override claim verdict to 'disputed' so the function doesn't reject for that reason.
    await db.execute({
      sql: `UPDATE fact_check_claims SET verdict = 'disputed' WHERE id = ?`,
      args: [claimId],
    });

    await loginAs(userB.id);

    const { suggestFactCheckFix } = await import("../fact-check/server");

    await expect(suggestFactCheckFix(draftId, claimId)).rejects.toThrow(/draft not found/i);
  });
});

// ---------------------------------------------------------------------------
// fact-check: applyFactCheckFix (already scoped via loadDraftAndClaim)
// ---------------------------------------------------------------------------

describe("applyFactCheckFix - cross-user isolation", () => {
  it("does not apply a fix to user A's draft when called by user B", async () => {
    const { userA, userB } = await createTwoUserFixture();
    const outletId = await seedOutletForUser(userA.id);
    const clusterId = await seedClusterForUser(userA.id);
    const draftId = await seedDraftForUser(userA.id, { clusterId, outletId });
    const claimId = await seedFactCheckClaim(draftId);

    await db.execute({
      sql: `UPDATE fact_check_claims SET verdict = 'disputed', claim_text = 'Test claim text' WHERE id = ?`,
      args: [claimId],
    });
    await db.execute({
      sql: `UPDATE drafts SET body = '<p>Test claim text goes here.</p>' WHERE id = ?`,
      args: [draftId],
    });

    await loginAs(userB.id);

    const { applyFactCheckFix } = await import("../fact-check/server");

    await expect(
      applyFactCheckFix(draftId, claimId, "Test claim text goes here.", "<p>Fixed.</p>"),
    ).rejects.toThrow(/draft not found/i);

    // A's draft body must be unchanged.
    const r = await db.execute({
      sql: `SELECT body FROM drafts WHERE id = ?`,
      args: [draftId],
    });
    expect(String(r.rows[0]!.body)).toContain("Test claim text");
  });
});

// ---------------------------------------------------------------------------
// fact-check: clearFactCheckClaims
// ---------------------------------------------------------------------------

describe("clearFactCheckClaims - cross-user isolation", () => {
  it("does not delete user A's claims when called by user B", async () => {
    const { userA, userB } = await createTwoUserFixture();
    const outletId = await seedOutletForUser(userA.id);
    const clusterId = await seedClusterForUser(userA.id);
    const draftId = await seedDraftForUser(userA.id, { clusterId, outletId });
    await seedFactCheckClaim(draftId);

    await loginAs(userB.id);

    const { clearFactCheckClaims } = await import("../fact-check/server");

    // Should throw rather than silently deleting when the draft doesn't
    // belong to the session user.
    await expect(clearFactCheckClaims(draftId)).rejects.toThrow();

    // A's claim must still exist.
    const r = await db.execute({
      sql: `SELECT id FROM fact_check_claims WHERE draft_id = ?`,
      args: [draftId],
    });
    expect(r.rows.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// related-images: runRelatedImageSearch
// ---------------------------------------------------------------------------

describe("runRelatedImageSearch - cross-user isolation", () => {
  it("does not run image search against user A's draft when called by user B", async () => {
    const { userA, userB } = await createTwoUserFixture();
    const outletId = await seedOutletForUser(userA.id);
    const clusterId = await seedClusterForUser(userA.id);
    const draftId = await seedDraftForUser(userA.id, { clusterId, outletId });
    await seedRelatedImage(draftId);

    await loginAs(userB.id);

    const { runRelatedImageSearch } = await import("../related-images/server");

    await expect(runRelatedImageSearch(draftId)).rejects.toThrow(/draft not found/i);

    // A's image row must still exist.
    const r = await db.execute({
      sql: `SELECT id FROM related_image_results WHERE draft_id = ?`,
      args: [draftId],
    });
    expect(r.rows.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// related-images: loadRelatedImages
// ---------------------------------------------------------------------------

describe("loadRelatedImages - cross-user isolation", () => {
  it("returns empty results for user B reading user A's draft id", async () => {
    const { userA, userB } = await createTwoUserFixture();
    const outletId = await seedOutletForUser(userA.id);
    const clusterId = await seedClusterForUser(userA.id);
    const draftId = await seedDraftForUser(userA.id, { clusterId, outletId });
    await seedRelatedImage(draftId);

    await loginAs(userB.id);

    const { loadRelatedImages } = await import("../related-images/server");

    const result = await loadRelatedImages(draftId);

    // B must see no images from A's draft.
    expect(result.results).toHaveLength(0);
    expect(result.ranAt).toBeNull();

    // A's image row must still exist.
    const r = await db.execute({
      sql: `SELECT id FROM related_image_results WHERE draft_id = ?`,
      args: [draftId],
    });
    expect(r.rows.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// related-images: clearRelatedImages
// ---------------------------------------------------------------------------

describe("clearRelatedImages - cross-user isolation", () => {
  it("does not delete user A's image results when called by user B", async () => {
    const { userA, userB } = await createTwoUserFixture();
    const outletId = await seedOutletForUser(userA.id);
    const clusterId = await seedClusterForUser(userA.id);
    const draftId = await seedDraftForUser(userA.id, { clusterId, outletId });
    await seedRelatedImage(draftId);

    await loginAs(userB.id);

    const { clearRelatedImages } = await import("../related-images/server");

    // Should throw rather than silently deleting when the draft doesn't
    // belong to the session user.
    await expect(clearRelatedImages(draftId)).rejects.toThrow();

    // A's image row must still exist.
    const r = await db.execute({
      sql: `SELECT id FROM related_image_results WHERE draft_id = ?`,
      args: [draftId],
    });
    expect(r.rows.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// related-images: getLicenseFilter / setLicenseFilter
// ---------------------------------------------------------------------------

describe("setLicenseFilterAction - cross-user isolation", () => {
  it("returns an auth error and does not write when called without a session", async () => {
    const { userA } = await createTwoUserFixture();
    const outletId = await seedOutletForUser(userA.id);
    const clusterId = await seedClusterForUser(userA.id);
    const draftId = await seedDraftForUser(userA.id, { clusterId, outletId });
    await seedRelatedImage(draftId, { licenseCode: "by" });

    const { setLicenseFilterAction } = await import("../related-images/actions");

    const formData = new FormData();
    formData.set("codes", "cc0");
    const result = await setLicenseFilterAction(formData);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/authentication required/i);
    expect(vi.mocked(setSetting)).not.toHaveBeenCalled();

    const r = await db.execute({
      sql: `SELECT id FROM related_image_results WHERE draft_id = ?`,
      args: [draftId],
    });
    expect(r.rows.length).toBe(1);
  });

  it("does not delete user B's image results when user A narrows their filter", async () => {
    const { userA, userB } = await createTwoUserFixture();
    const outletA = await seedOutletForUser(userA.id);
    const clusterA = await seedClusterForUser(userA.id);
    const draftA = await seedDraftForUser(userA.id, { clusterId: clusterA, outletId: outletA });
    await seedRelatedImage(draftA, { licenseCode: "by" });

    const outletB = await seedOutletForUser(userB.id);
    const clusterB = await seedClusterForUser(userB.id);
    const draftB = await seedDraftForUser(userB.id, { clusterId: clusterB, outletId: outletB });
    await seedRelatedImage(draftB, { licenseCode: "by" });

    await loginAs(userA.id);

    const { setLicenseFilterAction } = await import("../related-images/actions");

    const formData = new FormData();
    formData.set("codes", "cc0");
    const result = await setLicenseFilterAction(formData);

    expect(result.ok).toBe(true);

    const userAResults = await db.execute({
      sql: `SELECT id FROM related_image_results WHERE draft_id = ?`,
      args: [draftA],
    });
    expect(userAResults.rows.length).toBe(0);

    const userBResults = await db.execute({
      sql: `SELECT id FROM related_image_results WHERE draft_id = ?`,
      args: [draftB],
    });
    expect(userBResults.rows.length).toBe(1);
  });

  it("does not change user B's license filter when user A narrows theirs", async () => {
    const { userA, userB } = await createTwoUserFixture();
    const outletA = await seedOutletForUser(userA.id);
    const clusterA = await seedClusterForUser(userA.id);
    const draftA = await seedDraftForUser(userA.id, { clusterId: clusterA, outletId: outletA });
    await seedRelatedImage(draftA, { licenseCode: "by" });

    const outletB = await seedOutletForUser(userB.id);
    const clusterB = await seedClusterForUser(userB.id);
    const draftB = await seedDraftForUser(userB.id, { clusterId: clusterB, outletId: outletB });
    await seedRelatedImage(draftB, { licenseCode: "by" });

    await loginAs(userA.id);

    const { loadRelatedImagesAction, setLicenseFilterAction } =
      await import("../related-images/actions");

    const setFormData = new FormData();
    setFormData.set("draftId", draftA);
    setFormData.set("codes", "cc0");
    const setResult = await setLicenseFilterAction(setFormData);

    expect(setResult.ok).toBe(true);
    expect(vi.mocked(setSetting)).toHaveBeenCalledWith(
      "related_images_license_filter",
      userA.id,
      JSON.stringify(["cc0"]),
    );
    expect(vi.mocked(getSetting)).not.toHaveBeenCalledWith("related_images_license_filter");

    await loginAs(userB.id);

    const loadFormData = new FormData();
    loadFormData.set("draftId", draftB);
    const loadResult = await loadRelatedImagesAction(loadFormData);

    expect(loadResult.ok).toBe(true);
    if (!loadResult.ok) return;
    expect(vi.mocked(getSetting)).toHaveBeenCalledWith("related_images_license_filter", userB.id);
    expect(loadResult.payload.licenseFilter).toContain("by");
    expect(loadResult.payload.results).toHaveLength(1);
  });
});
