import { describe, it, expect, beforeEach, vi } from "vitest";
import { backfillLegacyPasswordVerification, db, ensureSchema } from "@/lib/db";
import { SESSION_COOKIE_NAME } from "@/lib/auth";
import { hashPassword } from "@/lib/password";
import { createUser } from "@/lib/users";
import { issueVerificationToken, consumeVerificationToken } from "@/lib/email-tokens";

const { cookieJar } = vi.hoisted(() => ({
  cookieJar: new Map<string, string>(),
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    set: (name: string, value: string) => {
      cookieJar.set(name, value);
    },
  }),
}));

beforeEach(async () => {
  await ensureSchema();
  await db.execute("DELETE FROM users");
  await db.execute("DELETE FROM email_verification_tokens");
  cookieJar.clear();
  process.env.FLAVORPRESS_SESSION_SECRET = "test-secret-that-is-at-least-32-bytes-long!!";
  process.env.FLAVORPRESS_ORIGIN = "http://localhost:3000";
});

describe("verify-email flow", () => {
  it("a fresh user has no email_verified_at", async () => {
    const u = await createUser({
      email: "a@example.com",
      passwordHash: await hashPassword("correct horse battery staple"),
    });
    const r = await db.execute({
      sql: "SELECT email_verified_at FROM users WHERE id = ?",
      args: [u.id],
    });
    expect(r.rows[0]?.email_verified_at).toBeNull();
  });

  it("token can be issued and consumed once, then user marked verified", async () => {
    const u = await createUser({
      email: "a@example.com",
      passwordHash: await hashPassword("correct horse battery staple"),
    });
    const token = await issueVerificationToken(u.id);
    const verifiedUserId = await consumeVerificationToken(token);
    expect(verifiedUserId).toBe(u.id);
    if (verifiedUserId) {
      await db.execute({
        sql: "UPDATE users SET email_verified_at = ? WHERE id = ?",
        args: [Date.now(), verifiedUserId],
      });
    }
    const r = await db.execute({
      sql: "SELECT email_verified_at FROM users WHERE id = ?",
      args: [u.id],
    });
    expect(Number(r.rows[0]?.email_verified_at)).toBeGreaterThan(0);
  });

  it("route verifies the user and issues a session cookie", async () => {
    const u = await createUser({
      email: "route@example.com",
      passwordHash: await hashPassword("correct horse battery staple"),
    });
    const token = await issueVerificationToken(u.id);
    const { GET } = await import("@/app/verify-email/[token]/route");

    const res = await GET(new Request(`http://localhost:3000/verify-email/${token}`), {
      params: Promise.resolve({ token }),
    });

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://localhost:3000/?verified=1");
    expect(cookieJar.get(SESSION_COOKIE_NAME)).toMatch(/^v2\./);
  });

  it("backfills legacy password users without verifying future signups", async () => {
    const now = Date.now();
    await db.execute({
      sql: "DELETE FROM deployment_state WHERE key = 'legacy_password_email_verification_backfilled_at'",
    });
    await db.execute({
      sql: `INSERT INTO users (id, email, password_hash, status, is_admin, session_version, created_at)
            VALUES ('u_legacy_password', 'legacy@example.com', ?, 'active', 0, 0, ?)`,
      args: [await hashPassword("correct horse battery staple"), now - 1000],
    });

    await backfillLegacyPasswordVerification();
    const legacy = await db.execute({
      sql: "SELECT email_verified_at FROM users WHERE id = 'u_legacy_password'",
    });
    expect(Number(legacy.rows[0]?.email_verified_at)).toBe(now - 1000);

    const fresh = await createUser({
      email: "fresh@example.com",
      passwordHash: await hashPassword("correct horse battery staple"),
    });
    await backfillLegacyPasswordVerification();
    const freshRow = await db.execute({
      sql: "SELECT email_verified_at FROM users WHERE id = ?",
      args: [fresh.id],
    });
    expect(freshRow.rows[0]?.email_verified_at).toBeNull();
  });
});
