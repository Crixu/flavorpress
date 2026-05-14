import { describe, it, expect, beforeEach } from "vitest";
import { db, ensureSchema } from "@/lib/db";
import { issueInvite, consumeInvite, readInvite, revokeInvite, InviteError } from "@/lib/invites";
import { hashToken } from "@/lib/token-hash";

process.env.FLAVORPRESS_SESSION_SECRET =
  process.env.FLAVORPRESS_SESSION_SECRET ?? "test-secret-that-is-at-least-32-bytes-long!!";

beforeEach(async () => {
  await ensureSchema();
  await db.execute("DELETE FROM invites");
});

describe("invites", () => {
  it("issues a token and persists a row", async () => {
    const r = await issueInvite({});
    expect(r.token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(r.token.length).toBeGreaterThan(20);
    const row = await readInvite(r.token);
    expect(row?.token).toBe(r.token);
    expect(row?.used_at).toBeNull();
  });

  it("readInvite returns null when expired", async () => {
    const r = await issueInvite({ expiresAt: Date.now() - 1000 });
    const row = await readInvite(r.token);
    expect(row).toBeNull();
  });

  it("readInvite returns null when used", async () => {
    const r = await issueInvite({});
    await consumeInvite(r.token, "u_test");
    const row = await readInvite(r.token);
    expect(row).toBeNull();
  });

  it("consumeInvite marks used", async () => {
    const r = await issueInvite({});
    await consumeInvite(r.token, "u_test");
    const raw = await db.execute({
      sql: "SELECT used_at, used_by_user_id FROM invites WHERE token = ?",
      args: [hashToken(r.token)],
    });
    expect(raw.rows[0]?.used_at).not.toBeNull();
    expect(raw.rows[0]?.used_by_user_id).toBe("u_test");
  });

  it("stores invite tokens hashed, not plaintext", async () => {
    const r = await issueInvite({});
    const direct = await db.execute({
      sql: "SELECT token FROM invites WHERE token = ?",
      args: [r.token],
    });
    expect(direct.rows.length).toBe(0);
    const hashed = await db.execute({
      sql: "SELECT token FROM invites WHERE token = ?",
      args: [hashToken(r.token)],
    });
    expect(hashed.rows.length).toBe(1);
  });

  it("does not accept the stored hash as an invite token", async () => {
    const r = await issueInvite({});
    const storedHash = hashToken(r.token);

    await expect(readInvite(storedHash)).resolves.toBeNull();
    await expect(consumeInvite(storedHash, "u_attacker")).rejects.toMatchObject({
      code: "missing",
    });
    await consumeInvite(r.token, "u_test");
  });

  it("tolerates legacy plaintext rows and upgrades on use", async () => {
    const raw = "legacy-plaintext-token-xyz";
    await db.execute({
      sql: `INSERT INTO invites (token, created_by_user_id, created_at, expires_at)
            VALUES (?, ?, ?, ?)`,
      args: [raw, null, Date.now(), null],
    });
    await consumeInvite(raw, "u_legacy");
    const row = await db.execute({
      sql: "SELECT token, used_by_user_id FROM invites WHERE token = ?",
      args: [hashToken(raw)],
    });
    expect(row.rows.length).toBe(1);
    expect(row.rows[0]?.used_by_user_id).toBe("u_legacy");
  });

  it("consumeInvite throws when token is missing", async () => {
    await expect(consumeInvite("does-not-exist", "u_x")).rejects.toBeInstanceOf(InviteError);
  });

  it("consumeInvite throws when token is already used", async () => {
    const r = await issueInvite({});
    await consumeInvite(r.token, "u_test_1");
    await expect(consumeInvite(r.token, "u_test_2")).rejects.toBeInstanceOf(InviteError);
  });

  it("consumeInvite throws when token is expired", async () => {
    const r = await issueInvite({ expiresAt: Date.now() - 1000 });
    await expect(consumeInvite(r.token, "u_test")).rejects.toBeInstanceOf(InviteError);
  });

  it("revokes an unused token", async () => {
    const r = await issueInvite({});
    await expect(revokeInvite(r.token)).resolves.toBe(true);
    await expect(readInvite(r.token)).resolves.toBeNull();
    await expect(consumeInvite(r.token, "u_test")).rejects.toMatchObject({ code: "revoked" });
  });

  it("does not revoke a used token", async () => {
    const r = await issueInvite({});
    await consumeInvite(r.token, "u_test");
    await expect(revokeInvite(r.token)).resolves.toBe(false);
  });
});
