import { describe, it, expect, beforeEach, vi } from "vitest";
import { db, ensureSchema } from "@/lib/db";
import { hashPassword } from "@/lib/password";
import { rateLimitKey } from "@/lib/rate-limit";
import { createUser } from "@/lib/users";

const sendCalls: { to: string; subject: string }[] = [];
let forwardedFor = "198.51.101.1";
let ipCounter = 1;
vi.mock("@/lib/email", async () => {
  const actual = await vi.importActual<typeof import("@/lib/email")>("@/lib/email");
  return {
    ...actual,
    sendEmail: async (msg: { to: string; subject: string; html: string; text: string }) => {
      sendCalls.push({ to: msg.to, subject: msg.subject });
    },
  };
});

const redirectCalls: { url: string }[] = [];
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    redirectCalls.push({ url });
    throw new Error(`__REDIRECT__:${url}`);
  },
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: () => undefined,
    set: () => {},
  }),
  headers: async () => ({
    get: (name: string) => {
      if (name === "origin") return "http://localhost:3000";
      if (name === "x-forwarded-host") return "localhost:3000";
      if (name === "x-forwarded-for") return forwardedFor;
      return null;
    },
  }),
}));

beforeEach(async () => {
  await ensureSchema();
  await db.execute("DELETE FROM users");
  await db.execute("DELETE FROM password_reset_tokens");
  await db.execute("DELETE FROM rate_buckets");
  forwardedFor = `198.51.101.${ipCounter}`;
  ipCounter += 1;
  sendCalls.length = 0;
  redirectCalls.length = 0;
  process.env.FLAVORPRESS_SESSION_SECRET = "test-secret-that-is-at-least-32-bytes-long!!";
  process.env.FLAVORPRESS_ALLOWED_ORIGINS = "http://localhost:3000";
  process.env.FLAVORPRESS_ORIGIN = "http://localhost:3000";
});

async function callRequest(email: string): Promise<string> {
  const { requestPasswordResetAction } = await import("@/app/reset-password/actions");
  const formData = new FormData();
  formData.set("email", email);
  try {
    await requestPasswordResetAction(formData);
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("__REDIRECT__:")) {
      return err.message.slice("__REDIRECT__:".length);
    }
    throw err;
  }
  return "";
}

describe("requestPasswordResetAction", () => {
  it("known email with a password: issues a token + sends email", async () => {
    await createUser({
      email: "known@example.com",
      passwordHash: await hashPassword("correct horse battery staple"),
    });
    const to = await callRequest("known@example.com");
    expect(to).toMatch(/check=1/);
    expect(sendCalls).toHaveLength(1);
    expect(sendCalls[0]!.to).toBe("known@example.com");
    const tokens = await db.execute("SELECT COUNT(*) AS n FROM password_reset_tokens");
    expect(Number(tokens.rows[0]!.n)).toBe(1);
  });

  it("unknown email: same redirect, no token, no send", async () => {
    const to = await callRequest("nobody@example.com");
    expect(to).toMatch(/check=1/);
    expect(sendCalls).toHaveLength(0);
    const tokens = await db.execute("SELECT COUNT(*) AS n FROM password_reset_tokens");
    expect(Number(tokens.rows[0]!.n)).toBe(0);
  });

  it("user without password_hash: same redirect, no token issued", async () => {
    await db.execute({
      sql: `INSERT INTO users (id, email, password_hash, status, is_admin, session_version, created_at)
            VALUES ('u_x', 'no-pw@example.com', NULL, 'active', 0, 0, ?)`,
      args: [Date.now()],
    });
    const to = await callRequest("no-pw@example.com");
    expect(to).toMatch(/check=1/);
    const tokens = await db.execute("SELECT COUNT(*) AS n FROM password_reset_tokens");
    expect(Number(tokens.rows[0]!.n)).toBe(0);
  });

  it("honors the normalized submitted email bucket before user lookup", async () => {
    await seedExhaustedBucket("reset", rateLimitKey("account", "reset-me@example.com"));
    await createUser({
      email: "reset-me@example.com",
      passwordHash: await hashPassword("correct horse battery staple"),
    });
    const to = await callRequest(" Reset-Me@Example.COM ");

    expect(to).toMatch(/check=1/);
    expect(sendCalls).toHaveLength(0);
    const tokens = await db.execute("SELECT COUNT(*) AS n FROM password_reset_tokens");
    expect(Number(tokens.rows[0]!.n)).toBe(0);
  });
});

async function seedExhaustedBucket(scope: string, key: string): Promise<void> {
  await db.execute({
    sql: `INSERT INTO rate_buckets (scope, key, tokens, refilled_at)
          VALUES (?, ?, 0, ?)
          ON CONFLICT(scope, key) DO UPDATE SET
            tokens = excluded.tokens,
            refilled_at = excluded.refilled_at`,
    args: [scope, key, Math.floor(Date.now() / 60_000) * 60_000],
  });
}
