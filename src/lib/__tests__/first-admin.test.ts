import { describe, it, expect, beforeEach } from "vitest";
import { db, ensureSchema } from "@/lib/db";
import { hashPassword } from "@/lib/password";
import { claimFirstAdmin, createUser, getUserById } from "@/lib/users";

beforeEach(async () => {
  await ensureSchema();
  await db.execute("DELETE FROM users");
  await db.execute("DELETE FROM deployment_state");
});

describe("first admin claim", () => {
  it("promotes exactly one claimant", async () => {
    const hash = await hashPassword("correct horse battery staple");
    const first = await createUser({
      id: "u_first",
      email: "first@example.com",
      passwordHash: hash,
    });
    const second = await createUser({
      id: "u_second",
      email: "second@example.com",
      passwordHash: hash,
    });

    const results = await Promise.all([claimFirstAdmin(first.id), claimFirstAdmin(second.id)]);

    expect(results.filter(Boolean)).toHaveLength(1);
    const firstAfter = await getUserById(first.id);
    const secondAfter = await getUserById(second.id);
    expect([firstAfter?.isAdmin, secondAfter?.isAdmin].filter(Boolean)).toHaveLength(1);
  });

  it("claims first admin inside createUser when requested", async () => {
    const hash = await hashPassword("correct horse battery staple");
    const first = await createUser({
      id: "u_first",
      email: "first@example.com",
      passwordHash: hash,
      claimFirstAdmin: true,
    });
    const second = await createUser({
      id: "u_second",
      email: "second@example.com",
      passwordHash: hash,
      claimFirstAdmin: true,
    });

    expect(first.isAdmin).toBe(true);
    expect(second.isAdmin).toBe(false);
  });

  it("does not claim a missing user id", async () => {
    await expect(claimFirstAdmin("u_missing")).resolves.toBe(false);
    const row = await db.execute({
      sql: "SELECT value FROM deployment_state WHERE key = 'first_admin_user_id'",
    });
    expect(row.rows[0]?.value).toBeNull();
  });
});
