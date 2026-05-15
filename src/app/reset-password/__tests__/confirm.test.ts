import { describe, it, expect, beforeEach, vi } from "vitest";
import { db, ensureSchema } from "@/lib/db";
import { SESSION_COOKIE_NAME } from "@/lib/auth";
import { hashPassword, verifyPassword } from "@/lib/password";
import { createUser, getUserByEmail } from "@/lib/users";
import { issuePasswordResetToken } from "@/lib/email-tokens";
import { hashToken } from "@/lib/token-hash";

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

const redirectCalls: { url: string }[] = [];
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    redirectCalls.push({ url });
    throw new Error(`__REDIRECT__:${url}`);
  },
}));

beforeEach(async () => {
  await ensureSchema();
  await db.execute("DELETE FROM users");
  await db.execute("DELETE FROM password_reset_tokens");
  cookieJar = new Map();
  redirectCalls.length = 0;
  process.env.FLAVORPRESS_SESSION_SECRET = "test-secret-that-is-at-least-32-bytes-long!!";
  process.env.FLAVORPRESS_ALLOWED_ORIGINS = "http://localhost:3000";
});

async function callConfirm(token: string, password: string): Promise<string> {
  const { confirmPasswordResetAction } = await import("@/app/reset-password/[token]/actions");
  const formData = new FormData();
  formData.set("token", token);
  formData.set("password", password);
  try {
    await confirmPasswordResetAction(formData);
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("__REDIRECT__:")) {
      return err.message.slice("__REDIRECT__:".length);
    }
    throw err;
  }
  return "";
}

describe("confirmPasswordResetAction", () => {
  it("valid token + strong password: updates hash, bumps version, sets session cookie, redirects to /", async () => {
    const u = await createUser({
      email: "a@example.com",
      passwordHash: await hashPassword("the old password long enough"),
    });
    const token = await issuePasswordResetToken(u.id);
    const before = (await getUserByEmail("a@example.com"))!.sessionVersion;

    const to = await callConfirm(token, "fresh strong new password");
    expect(to).toBe("/");

    const after = (await getUserByEmail("a@example.com"))!;
    expect(after.sessionVersion).toBe(before + 1);
    expect(after.emailVerifiedAt).not.toBeNull();
    expect(await verifyPassword("fresh strong new password", after.passwordHash!)).toBe(true);
    expect(cookieJar.get(SESSION_COOKIE_NAME)).toMatch(/^v2\./);
  });

  it("invalid token: error path, no DB mutation", async () => {
    await createUser({
      email: "a@example.com",
      passwordHash: await hashPassword("the old password long enough"),
    });
    const before = (await getUserByEmail("a@example.com"))!.sessionVersion;

    const to = await callConfirm("not-a-real-token", "fresh strong new password");
    expect(to).toMatch(/error=token/);

    const after = (await getUserByEmail("a@example.com"))!;
    expect(after.sessionVersion).toBe(before);
    expect(await verifyPassword("the old password long enough", after.passwordHash!)).toBe(true);
  });

  it("weak password: error path, token not consumed", async () => {
    const u = await createUser({
      email: "a@example.com",
      passwordHash: await hashPassword("the old password long enough"),
    });
    const token = await issuePasswordResetToken(u.id);

    const to = await callConfirm(token, "short");
    expect(to).toMatch(/error=password/);

    const used = await db.execute({
      sql: "SELECT used_at FROM password_reset_tokens WHERE token = ?",
      args: [hashToken(token)],
    });
    expect(used.rows[0]!.used_at).toBeNull();
  });

  it("used token cannot be reused", async () => {
    const u = await createUser({
      email: "a@example.com",
      passwordHash: await hashPassword("the old password long enough"),
    });
    const token = await issuePasswordResetToken(u.id);
    await callConfirm(token, "fresh strong new password");
    const to = await callConfirm(token, "another strong password here");
    expect(to).toMatch(/error=token/);
  });
});
