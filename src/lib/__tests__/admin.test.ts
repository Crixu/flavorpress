import { describe, it, expect, beforeEach } from "vitest";
import { db, ensureSchema } from "@/lib/db";
import { loadAdminSnapshot } from "@/lib/admin";

beforeEach(async () => {
  await ensureSchema();
  await db.execute("DELETE FROM user_plans");
  await db.execute("DELETE FROM outlets");
  await db.execute("DELETE FROM sources");
  await db.execute("DELETE FROM source_folders");
  await db.execute("DELETE FROM users");
  await db.execute("DELETE FROM invites");
});

describe("admin snapshot", () => {
  it("returns connected outlet stats across the deployment", async () => {
    const now = Date.now();
    await insertUser("admin-user-a", "a@example.com", now);
    await insertUser("admin-user-b", "b@example.com", now);
    await insertOutlet({
      id: "connected-a",
      userId: "admin-user-a",
      baseUrl: "https://a.example.com",
      appPassword: true,
      createdAt: now,
    });
    await insertOutlet({
      id: "connected-b",
      userId: "admin-user-b",
      baseUrl: "https://b.example.com",
      appPassword: true,
      createdAt: now,
    });
    await insertOutlet({
      id: "staged-b",
      userId: "admin-user-b",
      baseUrl: "https://staged.example.com",
      appPassword: false,
      lastError: "Application Password missing",
      createdAt: now,
    });

    const snapshot = await loadAdminSnapshot();

    expect(snapshot.outletStats).toEqual({
      total: 3,
      connected: 2,
      staged: 1,
      withErrors: 1,
      usersWithConnectedOutlets: 2,
    });
  });

  it("returns all unused invites and the five newest used invites", async () => {
    const now = Date.now();
    await insertInvite({ token: "active-old", createdAt: now - 20_000 });
    await insertInvite({ token: "active-new", createdAt: now - 10_000 });
    await insertInvite({
      token: "expired-unused",
      createdAt: now - 9_000,
      expiresAt: now - 1_000,
    });
    await insertInvite({
      token: "revoked-unused",
      createdAt: now - 8_000,
      revokedAt: now - 500,
    });

    for (let i = 0; i < 6; i += 1) {
      await insertInvite({
        token: `used-${i}`,
        createdAt: now - 7_000 + i,
        usedAt: now - i * 1_000,
        usedByUserId: `u_${i}`,
      });
    }

    const snapshot = await loadAdminSnapshot();
    const tokens = snapshot.invites.map((invite) => invite.token);

    expect(tokens).toEqual([
      "revoked-unused",
      "expired-unused",
      "active-new",
      "active-old",
      "used-0",
      "used-1",
      "used-2",
      "used-3",
      "used-4",
    ]);
  });
});

async function insertUser(id: string, email: string, createdAt: number) {
  await db.execute({
    sql: `INSERT INTO users (id, email, status, is_admin, session_version, created_at)
          VALUES (?, ?, 'active', 0, 0, ?)`,
    args: [id, email, createdAt],
  });
}

async function insertOutlet(opts: {
  id: string;
  userId: string;
  baseUrl: string;
  appPassword: boolean;
  lastError?: string | null;
  createdAt: number;
}) {
  await db.execute({
    sql: `INSERT INTO outlets (
            id, user_id, base_url, app_password_encrypted, last_error, created_at
          )
          VALUES (?, ?, ?, ${opts.appPassword ? "X'01'" : "NULL"}, ?, ?)`,
    args: [opts.id, opts.userId, opts.baseUrl, opts.lastError ?? null, opts.createdAt],
  });
}

async function insertInvite(opts: {
  token: string;
  createdAt: number;
  expiresAt?: number | null;
  usedAt?: number | null;
  revokedAt?: number | null;
  usedByUserId?: string | null;
}) {
  await db.execute({
    sql: `INSERT INTO invites (
            token, created_by_user_id, used_by_user_id, created_at,
            expires_at, used_at, revoked_at
          )
          VALUES (?, NULL, ?, ?, ?, ?, ?)`,
    args: [
      opts.token,
      opts.usedByUserId ?? null,
      opts.createdAt,
      opts.expiresAt ?? null,
      opts.usedAt ?? null,
      opts.revokedAt ?? null,
    ],
  });
}
