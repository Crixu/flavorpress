/**
 * Settings actions are admin-only: a non-admin authenticated user must not
 * be able to mutate global app_settings (e.g., the Anthropic API key) or
 * toggle extensions for everyone.
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
  await db.execute("DELETE FROM users");
  await db.execute("DELETE FROM app_settings");
  cookieJar = new Map();
  process.env.FLAVORPRESS_SESSION_SECRET = SECRET;
  delete process.env.FLAVORPRESS_AUTH;
});

describe("saveSettingAction - admin-only", () => {
  it("non-admin user is rejected", async () => {
    const userId = await makeUser({ email: "writer@example.com", isAdmin: false });
    await loginAs(userId);
    const { saveSettingAction } = await import("@/lib/v1/settings-actions");
    const to = await callRedirect(saveSettingAction, {
      key: "anthropic_api_key",
      value: "sk-ant-fakefakefakefake",
    });
    expect(to).toMatch(/error=forbidden/);
    const r = await db.execute({
      sql: `SELECT 1 FROM app_settings WHERE key = ?`,
      args: ["anthropic_api_key"],
    });
    expect(r.rows.length).toBe(0);
  });

  it("admin user is allowed", async () => {
    const userId = await makeUser({ email: "admin@example.com", isAdmin: true });
    await loginAs(userId);
    const { saveSettingAction } = await import("@/lib/v1/settings-actions");
    const to = await callRedirect(saveSettingAction, {
      key: "anthropic_api_key",
      value: "sk-ant-fakefakefakefake",
    });
    expect(to).toMatch(/saved=/);
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
});

describe("clearSettingAction - admin-only", () => {
  it("non-admin user is rejected", async () => {
    const userId = await makeUser({ email: "writer@example.com", isAdmin: false });
    await loginAs(userId);
    const { clearSettingAction } = await import("@/lib/v1/settings-actions");
    const to = await callRedirect(clearSettingAction, { key: "anthropic_api_key" });
    expect(to).toMatch(/error=forbidden/);
  });
});

describe("toggleExtensionAction - admin-only", () => {
  it("non-admin user is rejected", async () => {
    const userId = await makeUser({ email: "writer@example.com", isAdmin: false });
    await loginAs(userId);
    const { toggleExtensionAction } = await import("@/lib/v1/settings-actions");
    const to = await callRedirect(toggleExtensionAction, {
      extensionId: "fact-check",
      enabled: "0",
    });
    expect(to).toMatch(/error=forbidden/);
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
