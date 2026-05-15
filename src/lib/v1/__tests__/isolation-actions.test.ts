/**
 * Cross-user isolation audit for v1 server actions.
 *
 * Each test creates two users (A and B), seeds entity rows owned by A, then
 * invokes an action while logged in as B using A's entity ids. The assertion
 * is that A's rows are untouched after the call.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { db } from "@/lib/db";
import {
  createTwoUserFixture,
  seedOutletForUser,
  seedSourceForUser,
  seedClusterForUser,
  seedDraftForUser,
  seedFolderForUser,
} from "@/lib/__tests__/__helpers__/two-user-fixture";
import { SESSION_COOKIE_NAME, createSessionCookie } from "@/lib/auth";

const { publishToWordPressMock } = vi.hoisted(() => ({
  publishToWordPressMock: vi.fn(),
}));

vi.mock("@/lib/wordpress", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...(actual as object),
    publishToWordPress: publishToWordPressMock,
  };
});

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

const SECRET = "test-secret-that-is-at-least-32-bytes-long!!";

async function loginAs(userId: string): Promise<void> {
  const cookie = await createSessionCookie({ userId, sessionVersion: 0, secret: SECRET });
  cookieJar.set(SESSION_COOKIE_NAME, cookie.value);
}

async function callAction(name: string, form: Record<string, string>): Promise<void> {
  const mod = (await import("@/lib/v1/actions")) as unknown as Record<
    string,
    (f: FormData) => Promise<unknown>
  >;
  const fn = mod[name];
  if (!fn) throw new Error(`Action ${name} not found`);
  const fd = new FormData();
  for (const [k, v] of Object.entries(form)) fd.set(k, v);
  try {
    await fn(fd);
  } catch (err) {
    // Redirects, AuthRequiredError, and "not found" errors are all acceptable
    // rejection signals - they indicate the action refused to operate on the
    // entity, which is the correct isolation behavior.
    if (err instanceof Error && err.message.startsWith("__REDIRECT__:")) return;
    if (err instanceof Error && err.name === "AuthRequiredError") return;
    if (err instanceof Error && /not found/i.test(err.message)) return;
    throw err;
  }
}

beforeEach(async () => {
  cookieJar = new Map();
  publishToWordPressMock.mockReset();
  process.env.FLAVORPRESS_SESSION_SECRET = SECRET;
  process.env.FLAVORPRESS_ALLOWED_ORIGINS = "http://localhost:3000";
  process.env.FLAVORPRESS_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");
  delete process.env.FLAVORPRESS_AUTH;
});

// ---------------------------------------------------------------------------
// disconnectOutletAction
// ---------------------------------------------------------------------------

describe("disconnectOutletAction - cross-user isolation", () => {
  it("does not disconnect user A's outlet when called by user B", async () => {
    const { userA, userB } = await createTwoUserFixture();

    // Seed a connected outlet for A with mock credentials.
    const outletId = await seedOutletForUser(userA.id);
    await db.execute({
      sql: `UPDATE outlets SET username = 'alice', app_password_encrypted = 'fake', connected_at = ? WHERE id = ?`,
      args: [Date.now(), outletId],
    });

    // Log in as B and attempt to disconnect A's outlet.
    await loginAs(userB.id);
    await callAction("disconnectOutletAction", { outletId, purge: "0" });

    // A's outlet credentials must still be present.
    const r = await db.execute({
      sql: `SELECT username, app_password_encrypted FROM outlets WHERE id = ?`,
      args: [outletId],
    });
    expect(r.rows.length).toBe(1);
    expect(r.rows[0]!.username).toBe("alice");
    expect(r.rows[0]!.app_password_encrypted).toBeTruthy();
  });

  it("does not purge user A's outlet when called with purge=1 by user B", async () => {
    const { userA, userB } = await createTwoUserFixture();
    const outletId = await seedOutletForUser(userA.id);
    const sourceId = await seedSourceForUser(userA.id);
    await db.execute({
      sql: `INSERT INTO voice_profiles
            (outlet_id, user_id, style_sheet_yaml, archive_index_size, last_rebuilt_at)
            VALUES (?, ?, ?, 0, ?)`,
      args: [outletId, userA.id, "style: test", Date.now()],
    });
    await db.execute({
      sql: `INSERT INTO outlet_sources (outlet_id, source_id, created_at) VALUES (?, ?, ?)`,
      args: [outletId, sourceId, Date.now()],
    });

    await loginAs(userB.id);
    await callAction("disconnectOutletAction", { outletId, purge: "1" });

    const outlet = await db.execute({
      sql: `SELECT id FROM outlets WHERE id = ?`,
      args: [outletId],
    });
    const profile = await db.execute({
      sql: `SELECT outlet_id FROM voice_profiles WHERE outlet_id = ?`,
      args: [outletId],
    });
    const assignment = await db.execute({
      sql: `SELECT outlet_id FROM outlet_sources WHERE outlet_id = ?`,
      args: [outletId],
    });
    expect(outlet.rows.length).toBe(1);
    expect(profile.rows.length).toBe(1);
    expect(assignment.rows.length).toBe(1);
  });

  it("purges the current user's outlet setup rows", async () => {
    const { userA } = await createTwoUserFixture();
    const outletId = await seedOutletForUser(userA.id);
    const sourceId = await seedSourceForUser(userA.id);
    await db.execute({
      sql: `INSERT INTO voice_profiles
            (outlet_id, user_id, style_sheet_yaml, archive_index_size, last_rebuilt_at)
            VALUES (?, ?, ?, 0, ?)`,
      args: [outletId, userA.id, "style: test", Date.now()],
    });
    await db.execute({
      sql: `INSERT INTO outlet_sources (outlet_id, source_id, created_at) VALUES (?, ?, ?)`,
      args: [outletId, sourceId, Date.now()],
    });
    await db.execute({
      sql: `INSERT INTO wp_authorize_states
            (state, user_id, outlet_id, expected_site_url, expected_site_origin, created_at, expires_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [
        "state-test",
        userA.id,
        outletId,
        "https://example.com",
        "https://example.com",
        Date.now(),
        Date.now() + 60_000,
      ],
    });

    await loginAs(userA.id);
    await callAction("disconnectOutletAction", {
      outletId,
      purge: "1",
      redirectTo: "/voice",
    });

    const outlet = await db.execute({
      sql: `SELECT id FROM outlets WHERE id = ?`,
      args: [outletId],
    });
    const profile = await db.execute({
      sql: `SELECT outlet_id FROM voice_profiles WHERE outlet_id = ?`,
      args: [outletId],
    });
    const assignment = await db.execute({
      sql: `SELECT outlet_id FROM outlet_sources WHERE outlet_id = ?`,
      args: [outletId],
    });
    const authState = await db.execute({
      sql: `SELECT outlet_id FROM wp_authorize_states WHERE outlet_id = ?`,
      args: [outletId],
    });
    expect(outlet.rows.length).toBe(0);
    expect(profile.rows.length).toBe(0);
    expect(assignment.rows.length).toBe(0);
    expect(authState.rows.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// setDefaultOutletAction
// ---------------------------------------------------------------------------

describe("setDefaultOutletAction - cross-user isolation", () => {
  it("does not mark user A's outlet as default when called by user B", async () => {
    const { userA, userB } = await createTwoUserFixture();
    const outletA = await seedOutletForUser(userA.id);

    // A's outlet starts as not-default (0).
    const before = await db.execute({
      sql: `SELECT is_default FROM outlets WHERE id = ?`,
      args: [outletA],
    });
    expect(Number(before.rows[0]!.is_default)).toBe(0);

    // Log in as B and try to promote A's outlet.
    await loginAs(userB.id);
    await callAction("setDefaultOutletAction", { outletId: outletA });

    const after = await db.execute({
      sql: `SELECT is_default FROM outlets WHERE id = ?`,
      args: [outletA],
    });
    expect(Number(after.rows[0]!.is_default)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// deleteDraftAction
// ---------------------------------------------------------------------------

describe("deleteDraftAction - cross-user isolation", () => {
  it("does not delete user A's draft when called by user B", async () => {
    const { userA, userB } = await createTwoUserFixture();
    const outletId = await seedOutletForUser(userA.id);
    const clusterId = await seedClusterForUser(userA.id);
    const draftId = await seedDraftForUser(userA.id, { clusterId, outletId });

    await loginAs(userB.id);
    // deleteDraftAction throws "Draft not found" when userId doesn't match;
    // callAction swallows all non-redirect/auth errors, so this must not delete.
    await callAction("deleteDraftAction", { draftId });

    const r = await db.execute({
      sql: `SELECT id FROM drafts WHERE id = ?`,
      args: [draftId],
    });
    expect(r.rows.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// publishDraftToWPAction
// ---------------------------------------------------------------------------

describe("publishDraftToWPAction - outlet isolation", () => {
  it("does not publish a user B draft through user A's outlet", async () => {
    const { userA, userB } = await createTwoUserFixture();
    const outletA = await seedOutletForUser(userA.id);
    await db.execute({
      sql: `UPDATE outlets
            SET username = ?, app_password_encrypted = ?, connected_at = ?
            WHERE id = ?`,
      args: [
        "alice",
        new Uint8Array(Buffer.from("alice:application-password", "utf8")),
        Date.now(),
        outletA,
      ],
    });
    const clusterB = await seedClusterForUser(userB.id);
    const draftB = await seedDraftForUser(userB.id, { clusterId: clusterB, outletId: outletA });

    await loginAs(userB.id);
    const fd = new FormData();
    fd.set("draftId", draftB);
    const mod = (await import("@/lib/v1/actions")) as unknown as Record<
      string,
      (f: FormData) => Promise<unknown>
    >;

    await expect(mod.publishDraftToWPAction!(fd)).rejects.toThrow(/stored credentials/i);
    expect(publishToWordPressMock).not.toHaveBeenCalled();

    const r = await db.execute({
      sql: `SELECT wp_post_id, wp_edit_link FROM drafts WHERE id = ?`,
      args: [draftB],
    });
    expect(r.rows[0]!.wp_post_id).toBeNull();
    expect(r.rows[0]!.wp_edit_link).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// dismissClusterAction
// ---------------------------------------------------------------------------

describe("dismissClusterAction - cross-user isolation", () => {
  it("does not dismiss user A's cluster when called by user B", async () => {
    const { userA, userB } = await createTwoUserFixture();
    const clusterId = await seedClusterForUser(userA.id, { state: "fired" });

    await loginAs(userB.id);
    await callAction("dismissClusterAction", { clusterId });

    const r = await db.execute({
      sql: `SELECT state FROM clusters WHERE id = ?`,
      args: [clusterId],
    });
    expect(String(r.rows[0]!.state)).toBe("fired");
  });
});

// ---------------------------------------------------------------------------
// generateDraftAction
// ---------------------------------------------------------------------------

describe("generateDraftAction - cross-user isolation", () => {
  it("rejects a foreign cluster before creating a draft", async () => {
    const { userA, userB } = await createTwoUserFixture();
    const clusterA = await seedClusterForUser(userA.id, { state: "fired" });
    const outletB = await seedOutletForUser(userB.id);

    await loginAs(userB.id);
    const fd = new FormData();
    fd.set("clusterId", clusterA);
    fd.set("outletId", outletB);
    const mod = (await import("@/lib/v1/actions")) as unknown as Record<
      string,
      (f: FormData) => Promise<unknown>
    >;
    await expect(mod.generateDraftAction!(fd)).rejects.toThrow(/not found/i);

    const drafts = await db.execute({
      sql: `SELECT id FROM drafts WHERE user_id = ?`,
      args: [userB.id],
    });
    expect(drafts.rows.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// deleteSourceAction
// ---------------------------------------------------------------------------

describe("deleteSourceAction - cross-user isolation", () => {
  it("does not delete user A's source when called by user B", async () => {
    const { userA, userB } = await createTwoUserFixture();
    const sourceId = await seedSourceForUser(userA.id);

    await loginAs(userB.id);
    await callAction("deleteSourceAction", { sourceId });

    const r = await db.execute({
      sql: `SELECT id FROM sources WHERE id = ?`,
      args: [sourceId],
    });
    expect(r.rows.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// renameFolderAction
// ---------------------------------------------------------------------------

describe("renameFolderAction - cross-user isolation", () => {
  it("does not rename user A's folder when called by user B", async () => {
    const { userA, userB } = await createTwoUserFixture();
    const folderId = await seedFolderForUser(userA.id, { name: "original-name" });

    await loginAs(userB.id);
    await callAction("renameFolderAction", { folderId, name: "attacker-rename" });

    const r = await db.execute({
      sql: `SELECT name FROM source_folders WHERE id = ?`,
      args: [folderId],
    });
    expect(String(r.rows[0]!.name)).toBe("original-name");
  });
});

// ---------------------------------------------------------------------------
// assignSourceOutletsAction
// ---------------------------------------------------------------------------

describe("assignSourceOutletsAction - cross-user isolation", () => {
  it("user B cannot rewrite the outlet assignment of user A's source", async () => {
    const { userA, userB } = await createTwoUserFixture();
    const sourceA = await seedSourceForUser(userA.id);
    const outletA = await seedOutletForUser(userA.id);
    await db.execute({
      sql: `INSERT INTO outlet_sources (outlet_id, source_id, created_at) VALUES (?, ?, ?)`,
      args: [outletA, sourceA, Date.now()],
    });
    const outletB = await seedOutletForUser(userB.id);

    await loginAs(userB.id);
    const fd = new FormData();
    fd.set("sourceId", sourceA);
    fd.append("outletIds", outletB);
    const mod = (await import("@/lib/v1/actions")) as unknown as Record<
      string,
      (f: FormData) => Promise<unknown>
    >;
    await expect(mod.assignSourceOutletsAction!(fd)).rejects.toThrow(/not found/i);

    // Original assignment preserved.
    const r = await db.execute({
      sql: `SELECT outlet_id FROM outlet_sources WHERE source_id = ?`,
      args: [sourceA],
    });
    expect(r.rows.length).toBe(1);
    expect(String(r.rows[0]!.outlet_id)).toBe(outletA);
  });

  it("user B cannot attach their own outlet to user A's source", async () => {
    const { userA, userB } = await createTwoUserFixture();
    const sourceA = await seedSourceForUser(userA.id);
    const outletB = await seedOutletForUser(userB.id);

    await loginAs(userB.id);
    const fd = new FormData();
    fd.set("sourceId", sourceA);
    fd.append("outletIds", outletB);
    const mod = (await import("@/lib/v1/actions")) as unknown as Record<
      string,
      (f: FormData) => Promise<unknown>
    >;
    await expect(mod.assignSourceOutletsAction!(fd)).rejects.toThrow(/not found/i);

    const r = await db.execute({
      sql: `SELECT 1 FROM outlet_sources WHERE source_id = ? AND outlet_id = ?`,
      args: [sourceA, outletB],
    });
    expect(r.rows.length).toBe(0);
  });

  it("user A cannot attach a foreign outlet (belonging to user B) to their own source", async () => {
    const { userA, userB } = await createTwoUserFixture();
    const sourceA = await seedSourceForUser(userA.id);
    const outletA = await seedOutletForUser(userA.id);
    const outletB = await seedOutletForUser(userB.id);

    await loginAs(userA.id);
    const fd = new FormData();
    fd.set("sourceId", sourceA);
    fd.append("outletIds", outletA);
    fd.append("outletIds", outletB);
    const mod = (await import("@/lib/v1/actions")) as unknown as Record<
      string,
      (f: FormData) => Promise<unknown>
    >;
    await expect(mod.assignSourceOutletsAction!(fd)).rejects.toThrow(/not found/i);

    const r = await db.execute({
      sql: `SELECT outlet_id FROM outlet_sources WHERE source_id = ?`,
      args: [sourceA],
    });
    expect(r.rows.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// pollSourceAction
// ---------------------------------------------------------------------------

describe("pollSourceAction - cross-user isolation", () => {
  it("user B cannot trigger a poll of user A's source", async () => {
    const { userA, userB } = await createTwoUserFixture();
    const sourceA = await seedSourceForUser(userA.id);

    await loginAs(userB.id);
    const fd = new FormData();
    fd.set("sourceId", sourceA);
    const mod = (await import("@/lib/v1/actions")) as unknown as Record<
      string,
      (f: FormData) => Promise<unknown>
    >;
    await expect(mod.pollSourceAction!(fd)).rejects.toThrow(/not found/i);
  });
});

describe("pollAllSourcesAction - plan gate", () => {
  it("rejects non-admin writers without a Custom plan", async () => {
    const { userA } = await createTwoUserFixture();
    await seedSourceForUser(userA.id);

    await loginAs(userA.id);
    const mod = (await import("@/lib/v1/actions")) as unknown as Record<
      string,
      () => Promise<unknown>
    >;
    await expect(mod.pollAllSourcesAction!()).rejects.toThrow(/custom plan/i);
  });
});

describe("startWPAuthorizeAction - plan gate", () => {
  it("redirects outlet cap failures to a user-visible notice", async () => {
    const { userA } = await createTwoUserFixture();
    await seedOutletForUser(userA.id);

    await loginAs(userA.id);
    const fd = new FormData();
    fd.set("baseUrl", "https://new-site.example");
    const mod = (await import("@/lib/v1/actions")) as unknown as Record<
      string,
      (f: FormData) => Promise<unknown>
    >;

    await expect(mod.startWPAuthorizeAction!(fd)).rejects.toThrow(
      "__REDIRECT__:/voice?plan_limit=outlets&limit=1",
    );
  });
});

// ---------------------------------------------------------------------------
// getJobProgressAction (maintenance jobs)
// ---------------------------------------------------------------------------

describe("job_progress - cross-user isolation", () => {
  it("getRunningJob is scoped per user (user A's job does not block user B)", async () => {
    const { userA, userB } = await createTwoUserFixture();
    const { getRunningJob } = await import("@/lib/v1/maintenance");

    // Seed an in-flight job for user A.
    await db.execute({
      sql: `INSERT INTO job_progress (id, user_id, kind, total, completed, started_at)
            VALUES (?, ?, ?, ?, 0, ?)`,
      args: ["job_a_running", userA.id, "reextract-entities", 100, Date.now()],
    });

    expect(await getRunningJob("reextract-entities", userA.id)).not.toBeNull();
    expect(await getRunningJob("reextract-entities", userB.id)).toBeNull();
  });

  it("getJobProgressAction returns null for another user's job id", async () => {
    const { userA, userB } = await createTwoUserFixture();
    await db.execute({
      sql: `INSERT INTO job_progress (id, user_id, kind, total, completed, started_at)
            VALUES (?, ?, ?, ?, 0, ?)`,
      args: ["job_a_progress", userA.id, "reextract-entities", 100, Date.now()],
    });

    await loginAs(userB.id);
    const { getJobProgressAction } = await import("@/lib/v1/actions");
    const r = await getJobProgressAction("job_a_progress");
    expect(r).toBeNull();
  });

  it("getJobProgressAction returns the job for its owner", async () => {
    const { userA } = await createTwoUserFixture();
    await db.execute({
      sql: `INSERT INTO job_progress (id, user_id, kind, total, completed, started_at)
            VALUES (?, ?, ?, ?, ?, ?)`,
      args: ["job_a_self", userA.id, "reextract-entities", 100, 42, Date.now()],
    });

    await loginAs(userA.id);
    const { getJobProgressAction } = await import("@/lib/v1/actions");
    const r = await getJobProgressAction("job_a_self");
    expect(r).not.toBeNull();
    expect(r?.total).toBe(100);
    expect(r?.completed).toBe(42);
  });
});
