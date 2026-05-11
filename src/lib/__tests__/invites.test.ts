import { describe, it, expect, beforeEach } from "vitest";
import { db, ensureSchema } from "@/lib/db";
import {
  issueInvite,
  consumeInvite,
  readInvite,
  InviteError,
} from "@/lib/invites";

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
      args: [r.token],
    });
    expect(raw.rows[0]?.used_at).not.toBeNull();
    expect(raw.rows[0]?.used_by_user_id).toBe("u_test");
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
});
