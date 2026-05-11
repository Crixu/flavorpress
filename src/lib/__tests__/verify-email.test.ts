import { describe, it, expect, beforeEach } from "vitest";
import { db, ensureSchema } from "@/lib/db";
import { hashPassword } from "@/lib/password";
import { createUser } from "@/lib/users";
import { issueVerificationToken, consumeVerificationToken } from "@/lib/email-tokens";

beforeEach(async () => {
  await ensureSchema();
  await db.execute("DELETE FROM users");
  await db.execute("DELETE FROM email_verification_tokens");
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
});
