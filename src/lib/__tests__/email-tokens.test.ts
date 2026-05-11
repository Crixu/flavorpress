import { describe, it, expect, beforeEach } from "vitest";
import { db, ensureSchema } from "@/lib/db";
import {
  issueVerificationToken,
  consumeVerificationToken,
  issuePasswordResetToken,
  consumePasswordResetToken,
} from "@/lib/email-tokens";

beforeEach(async () => {
  await ensureSchema();
  await db.execute("DELETE FROM email_verification_tokens");
  await db.execute("DELETE FROM password_reset_tokens");
});

describe("verification tokens", () => {
  it("round-trip: issue then consume returns the user id", async () => {
    const token = await issueVerificationToken("u_a");
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    const userId = await consumeVerificationToken(token);
    expect(userId).toBe("u_a");
  });

  it("second consume returns null (single-use)", async () => {
    const token = await issueVerificationToken("u_a");
    await consumeVerificationToken(token);
    expect(await consumeVerificationToken(token)).toBeNull();
  });

  it("expired token returns null", async () => {
    const token = "expired-token";
    await db.execute({
      sql: `INSERT INTO email_verification_tokens (token, user_id, created_at, expires_at)
            VALUES (?, ?, ?, ?)`,
      args: [token, "u_a", Date.now() - 10_000, Date.now() - 1_000],
    });
    expect(await consumeVerificationToken(token)).toBeNull();
  });

  it("unknown token returns null", async () => {
    expect(await consumeVerificationToken("never-issued")).toBeNull();
  });

  it("issuance sets 24h expiry", async () => {
    const before = Date.now();
    const token = await issueVerificationToken("u_a");
    const r = await db.execute({
      sql: "SELECT created_at, expires_at FROM email_verification_tokens WHERE token = ?",
      args: [token],
    });
    const row = r.rows[0]!;
    const created = Number(row.created_at);
    const expires = Number(row.expires_at);
    expect(created).toBeGreaterThanOrEqual(before);
    expect(expires - created).toBe(24 * 60 * 60 * 1000);
  });
});

describe("password reset tokens", () => {
  it("round-trip", async () => {
    const token = await issuePasswordResetToken("u_b");
    const userId = await consumePasswordResetToken(token);
    expect(userId).toBe("u_b");
  });

  it("issuance sets 1h expiry", async () => {
    const before = Date.now();
    const token = await issuePasswordResetToken("u_b");
    const r = await db.execute({
      sql: "SELECT created_at, expires_at FROM password_reset_tokens WHERE token = ?",
      args: [token],
    });
    const row = r.rows[0]!;
    expect(Number(row.expires_at) - Number(row.created_at)).toBe(60 * 60 * 1000);
    expect(Number(row.created_at)).toBeGreaterThanOrEqual(before);
  });

  it("single-use", async () => {
    const token = await issuePasswordResetToken("u_b");
    await consumePasswordResetToken(token);
    expect(await consumePasswordResetToken(token)).toBeNull();
  });
});
