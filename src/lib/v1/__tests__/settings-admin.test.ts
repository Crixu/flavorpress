/**
 * Settings actions are per-user: a writer can edit their own model, API
 * key, and extension toggles without mutating another tenant's settings.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { db, ensureSchema } from "@/lib/db";
import { hashPassword } from "@/lib/password";
import { createUser } from "@/lib/users";
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

async function makeUser(opts: { email: string; isAdmin?: boolean }): Promise<string> {
  const user = await createUser({
    email: opts.email,
    passwordHash: await hashPassword("correct horse battery staple"),
    isAdmin: opts.isAdmin ?? false,
    emailVerifiedAt: Date.now(),
  });
  return user.id;
}

async function callRedirect(
  fn: (f: FormData) => Promise<void>,
  form: Record<string, string>,
): Promise<string> {
  const fd = new FormData();
  for (const [k, v] of Object.entries(form)) fd.set(k, v);
  try {
    await fn(fd);
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("__REDIRECT__:")) {
      return err.message.slice("__REDIRECT__:".length);
    }
    throw err;
  }
  return "";
}

beforeEach(async () => {
  await ensureSchema();
  await db.execute("DELETE FROM user_settings");
  await db.execute("DELETE FROM users");
  await db.execute("DELETE FROM app_settings");
  cookieJar = new Map();
  process.env.FLAVORPRESS_SESSION_SECRET = SECRET;
  delete process.env.FLAVORPRESS_AUTH;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_DRAFT_MODEL;
});

describe("saveSettingAction - per-user", () => {
  it("non-admin user saves their own setting without writing app_settings", async () => {
    const userId = await makeUser({ email: "writer@example.com", isAdmin: false });
    await loginAs(userId);
    const { saveSettingAction } = await import("@/lib/v1/settings-actions");
    const to = await callRedirect(saveSettingAction, {
      key: "anthropic_api_key",
      value: "sk-ant-writerfakefakefake",
    });
    expect(to).toMatch(/saved=/);
    const userSetting = await db.execute({
      sql: `SELECT 1 FROM user_settings WHERE user_id = ? AND key = ?`,
      args: [userId, "anthropic_api_key"],
    });
    expect(userSetting.rows.length).toBe(1);
    const legacy = await db.execute({
      sql: `SELECT 1 FROM app_settings WHERE key = ?`,
      args: ["anthropic_api_key"],
    });
    expect(legacy.rows.length).toBe(0);
  });

  it("keeps two users' draft model settings isolated", async () => {
    const userA = await makeUser({ email: "a@example.com" });
    const userB = await makeUser({ email: "b@example.com" });
    const { saveSettingAction } = await import("@/lib/v1/settings-actions");
    const { getAnthropicDraftModel } = await import("@/lib/v1/settings");

    await loginAs(userA);
    await callRedirect(saveSettingAction, {
      key: "anthropic_draft_model",
      value: "claude-user-a",
    });
    await loginAs(userB);
    await callRedirect(saveSettingAction, {
      key: "anthropic_draft_model",
      value: "claude-user-b",
    });

    await expect(getAnthropicDraftModel(userA)).resolves.toBe("claude-user-a");
    await expect(getAnthropicDraftModel(userB)).resolves.toBe("claude-user-b");
  });

  it("keeps the submitted settings section after saving", async () => {
    const userId = await makeUser({ email: "admin@example.com", isAdmin: true });
    await loginAs(userId);
    const { saveSettingAction } = await import("@/lib/v1/settings-actions");
    const to = await callRedirect(saveSettingAction, {
      section: "models",
      key: "anthropic_draft_model",
      value: "claude-haiku-4-5",
    });
    expect(to).toBe("/settings?section=models&saved=anthropic_draft_model");
  });

  it("falls back to the deployment env key when the user has no DB value", async () => {
    const userId = await makeUser({ email: "writer@example.com", isAdmin: false });
    process.env.ANTHROPIC_API_KEY = "sk-ant-envfakefakefake";
    const { getAnthropicApiKey } = await import("@/lib/v1/settings");
    await expect(getAnthropicApiKey(userId)).resolves.toBe("sk-ant-envfakefakefake");
  });
});

describe("clearSettingAction - per-user", () => {
  it("clears only the current user's row", async () => {
    const userId = await makeUser({ email: "writer@example.com", isAdmin: false });
    const otherId = await makeUser({ email: "other@example.com", isAdmin: false });
    await db.execute({
      sql: `INSERT INTO user_settings (user_id, key, value, updated_at) VALUES (?, ?, ?, ?)`,
      args: [userId, "anthropic_draft_model", "claude-user", Date.now()],
    });
    await db.execute({
      sql: `INSERT INTO user_settings (user_id, key, value, updated_at) VALUES (?, ?, ?, ?)`,
      args: [otherId, "anthropic_draft_model", "claude-other", Date.now()],
    });
    await loginAs(userId);
    const { clearSettingAction } = await import("@/lib/v1/settings-actions");
    const to = await callRedirect(clearSettingAction, { key: "anthropic_draft_model" });
    expect(to).toMatch(/cleared=/);
    const r = await db.execute({
      sql: `SELECT user_id FROM user_settings WHERE key = ? ORDER BY user_id`,
      args: ["anthropic_draft_model"],
    });
    expect(r.rows.map((row) => String(row.user_id))).toEqual([otherId]);
  });
});

describe("toggleExtensionAction - per-user", () => {
  it("disabling an extension for user A leaves user B enabled", async () => {
    const userA = await makeUser({ email: "a@example.com", isAdmin: false });
    const userB = await makeUser({ email: "b@example.com", isAdmin: false });
    await loginAs(userA);
    const { toggleExtensionAction } = await import("@/lib/v1/settings-actions");
    const { getDisabledExtensionIds } = await import("@/lib/v1/settings");
    const to = await callRedirect(toggleExtensionAction, {
      extensionId: "fact-check",
      enabled: "0",
    });
    expect(to).toMatch(/state=disabled/);
    await expect(getDisabledExtensionIds(userA)).resolves.toEqual(new Set(["fact-check"]));
    await expect(getDisabledExtensionIds(userB)).resolves.toEqual(new Set());
  });

  it("stays on the extensions section after toggling", async () => {
    const userId = await makeUser({ email: "admin@example.com", isAdmin: true });
    await loginAs(userId);
    const { toggleExtensionAction } = await import("@/lib/v1/settings-actions");
    const to = await callRedirect(toggleExtensionAction, {
      section: "extensions",
      extensionId: "fact-check",
      enabled: "0",
    });
    expect(to).toBe("/settings?section=extensions&extension=fact-check&state=disabled");
  });
});

describe("toggleUserExtensionForAdminAction", () => {
  it("admin toggles a selected user's extension without changing their own", async () => {
    const adminId = await makeUser({ email: "admin@example.com", isAdmin: true });
    const userId = await makeUser({ email: "writer@example.com", isAdmin: false });
    await loginAs(adminId);

    const { toggleUserExtensionForAdminAction } = await import("@/app/settings/admin/actions");
    const { getDisabledExtensionIds } = await import("@/lib/v1/settings");
    const to = await callRedirect(toggleUserExtensionForAdminAction, {
      userId,
      extensionId: "fact-check",
      enabled: "0",
    });

    expect(to).toBe(
      `/settings/admin/users/${userId}?saved=extension&extension=fact-check&state=disabled`,
    );
    await expect(getDisabledExtensionIds(userId)).resolves.toEqual(new Set(["fact-check"]));
    await expect(getDisabledExtensionIds(adminId)).resolves.toEqual(new Set());
  });
});
