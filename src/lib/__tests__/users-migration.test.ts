import { describe, it, expect, beforeEach } from "vitest";
import { db, ensureSchema } from "@/lib/db";
import { hashPassword } from "@/lib/password";
import { migrateDefaultUser, USER_TENANCY_TABLES, getUserById } from "@/lib/users";

beforeEach(async () => {
  await ensureSchema();
  // Wipe every tenancy table plus users so the seed below is the only state.
  for (const table of USER_TENANCY_TABLES) {
    await db.execute(`DELETE FROM ${table}`);
  }
  await db.execute("DELETE FROM users");
});

async function seedDefaultUser(): Promise<void> {
  await db.execute({
    sql: `INSERT INTO users (id, email, status, is_admin, session_version, created_at)
          VALUES ('default-user', 'you@flavorpress.local', 'active', 0, 0, ?)`,
    args: [Date.now()],
  });
  await db.execute({
    sql: `INSERT INTO outlets (id, user_id, base_url, display_name, created_at)
          VALUES ('o_seed', 'default-user', 'https://example.com', 'Example', ?)`,
    args: [Date.now()],
  });
  await db.execute({
    sql: `INSERT INTO sources (id, user_id, kind, url, created_at)
          VALUES ('s_seed', 'default-user', 'manual', 'https://example.com/feed', ?)`,
    args: [Date.now()],
  });
  await db.execute({
    sql: `INSERT INTO clusters (id, user_id, formed_at, source_count, state)
          VALUES ('c_seed', 'default-user', ?, 1, 'forming')`,
    args: [Date.now()],
  });
}

describe("migrateDefaultUser", () => {
  it("re-keys all default-user rows to the new id", async () => {
    await seedDefaultUser();
    const hash = await hashPassword("correct horse battery staple");
    const newId = "u_admin_test";
    await migrateDefaultUser({
      newId,
      email: "lucas@flavorpress.app",
      passwordHash: hash,
      isAdmin: true,
    });

    const u = await getUserById(newId);
    expect(u?.email).toBe("lucas@flavorpress.app");
    expect(u?.isAdmin).toBe(true);

    const oldRow = await db.execute({
      sql: "SELECT 1 FROM users WHERE id = ?",
      args: ["default-user"],
    });
    expect(oldRow.rows.length).toBe(0);

    const outlet = await db.execute({
      sql: "SELECT user_id FROM outlets WHERE id = 'o_seed'",
    });
    expect(String(outlet.rows[0]?.user_id)).toBe(newId);

    const source = await db.execute({
      sql: "SELECT user_id FROM sources WHERE id = 's_seed'",
    });
    expect(String(source.rows[0]?.user_id)).toBe(newId);

    const cluster = await db.execute({
      sql: "SELECT user_id FROM clusters WHERE id = 'c_seed'",
    });
    expect(String(cluster.rows[0]?.user_id)).toBe(newId);
  });

  it("is a no-op when default-user does not exist", async () => {
    const hash = await hashPassword("correct horse battery staple");
    const result = await migrateDefaultUser({
      newId: "u_admin_test",
      email: "lucas@flavorpress.app",
      passwordHash: hash,
      isAdmin: true,
    });
    expect(result.migrated).toBe(false);
  });
});
