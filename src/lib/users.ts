import "server-only";
import { randomBytes } from "node:crypto";
import { db } from "./db";

export interface User {
  id: string;
  email: string;
  passwordHash: string | null;
  wpcomId: string | null;
  wpcomUsername: string | null;
  emailVerifiedAt: number | null;
  status: "active" | "suspended";
  isAdmin: boolean;
  sessionVersion: number;
  createdAt: number;
  lastActiveAt: number | null;
}

function generateUserId(): string {
  return `u_${randomBytes(12).toString("base64url")}`;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function rowToUser(row: Record<string, unknown>): User {
  return {
    id: String(row.id),
    email: String(row.email),
    passwordHash: row.password_hash == null ? null : String(row.password_hash),
    wpcomId: row.wpcom_id == null ? null : String(row.wpcom_id),
    wpcomUsername: row.wpcom_username == null ? null : String(row.wpcom_username),
    emailVerifiedAt: row.email_verified_at == null ? null : Number(row.email_verified_at),
    status: String(row.status) === "suspended" ? "suspended" : "active",
    isAdmin: Number(row.is_admin) === 1,
    sessionVersion: Number(row.session_version),
    createdAt: Number(row.created_at),
    lastActiveAt: row.last_active_at == null ? null : Number(row.last_active_at),
  };
}

export async function createUser(opts: {
  email: string;
  passwordHash: string | null;
  wpcomId?: string | null;
  wpcomUsername?: string | null;
  isAdmin?: boolean;
  claimFirstAdmin?: boolean;
  emailVerifiedAt?: number | null;
  id?: string;
}): Promise<User> {
  const id = opts.id ?? generateUserId();
  const email = normalizeEmail(opts.email);
  const now = Date.now();
  const insertUser = {
    sql: `INSERT INTO users (
            id, email, password_hash, wpcom_id, wpcom_username,
            email_verified_at, status, is_admin, session_version,
            created_at, last_active_at
          ) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, 0, ?, ?)`,
    args: [
      id,
      email,
      opts.passwordHash,
      opts.wpcomId ?? null,
      opts.wpcomUsername ?? null,
      opts.emailVerifiedAt ?? null,
      opts.isAdmin ? 1 : 0,
      now,
      now,
    ],
  };
  if (opts.claimFirstAdmin) {
    await db.batch([
      insertUser,
      {
        sql: `INSERT OR IGNORE INTO deployment_state (key, value)
              VALUES ('first_admin_user_id', NULL)`,
        args: [],
      },
      {
        sql: `UPDATE deployment_state
              SET value = ?
              WHERE key = 'first_admin_user_id'
                AND value IS NULL
                AND EXISTS (SELECT 1 FROM users WHERE id = ?)`,
        args: [id, id],
      },
      {
        sql: `UPDATE users
              SET is_admin = CASE
                WHEN (SELECT value FROM deployment_state WHERE key = 'first_admin_user_id') = ?
                THEN 1
                ELSE is_admin
              END
              WHERE id = ?`,
        args: [id, id],
      },
    ]);
  } else {
    await db.execute(insertUser);
  }
  const u = await getUserById(id);
  if (!u) throw new Error("createUser: row not found after insert");
  return u;
}

export async function getUserByEmail(email: string): Promise<User | null> {
  const r = await db.execute({
    sql: "SELECT * FROM users WHERE email = ?",
    args: [normalizeEmail(email)],
  });
  const row = r.rows[0];
  return row ? rowToUser(row as Record<string, unknown>) : null;
}

export async function getUserById(id: string): Promise<User | null> {
  const r = await db.execute({
    sql: "SELECT * FROM users WHERE id = ?",
    args: [id],
  });
  const row = r.rows[0];
  return row ? rowToUser(row as Record<string, unknown>) : null;
}

function startOfUtcDay(ms: number): number {
  const date = new Date(ms);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

export async function touchUserActiveDay(userId: string, activeAt = Date.now()): Promise<void> {
  const dayStart = startOfUtcDay(activeAt);
  await db.execute({
    sql: `UPDATE users
          SET last_active_at = ?
          WHERE id = ?
            AND (last_active_at IS NULL OR last_active_at < ?)`,
    args: [activeAt, userId, dayStart],
  });
}

export async function updatePassword(userId: string, passwordHash: string): Promise<void> {
  await db.execute({
    sql: `UPDATE users
          SET password_hash = ?, session_version = session_version + 1
          WHERE id = ?`,
    args: [passwordHash, userId],
  });
}

export async function markEmailVerified(userId: string, verifiedAt = Date.now()): Promise<void> {
  await db.execute({
    sql: `UPDATE users
          SET email_verified_at = COALESCE(email_verified_at, ?)
          WHERE id = ?`,
    args: [verifiedAt, userId],
  });
}

export async function setStatus(userId: string, status: "active" | "suspended"): Promise<void> {
  await db.execute({
    sql: "UPDATE users SET status = ?, session_version = session_version + 1 WHERE id = ?",
    args: [status, userId],
  });
}

export async function bumpSessionVersion(userId: string): Promise<void> {
  await db.execute({
    sql: "UPDATE users SET session_version = session_version + 1 WHERE id = ?",
    args: [userId],
  });
}

export async function bumpSessionVersionIfActiveAndCurrent(
  userId: string,
  sessionVersion: number,
): Promise<boolean> {
  const r = await db.execute({
    sql: `UPDATE users
          SET session_version = session_version + 1
          WHERE id = ?
            AND status = 'active'
            AND session_version = ?`,
    args: [userId, sessionVersion],
  });
  return r.rowsAffected > 0;
}

export async function claimFirstAdmin(userId: string): Promise<boolean> {
  await db.batch([
    {
      sql: `INSERT OR IGNORE INTO deployment_state (key, value)
            VALUES ('first_admin_user_id', NULL)`,
      args: [],
    },
    {
      sql: `UPDATE deployment_state
            SET value = ?
            WHERE key = 'first_admin_user_id'
              AND value IS NULL
              AND EXISTS (SELECT 1 FROM users WHERE id = ?)`,
      args: [userId, userId],
    },
    {
      sql: `UPDATE users
            SET is_admin = CASE
              WHEN (SELECT value FROM deployment_state WHERE key = 'first_admin_user_id') = ?
              THEN 1
              ELSE is_admin
            END
            WHERE id = ?`,
      args: [userId, userId],
    },
  ]);
  const r = await db.execute({
    sql: "SELECT value FROM deployment_state WHERE key = 'first_admin_user_id'",
  });
  return r.rows.length > 0 && String(r.rows[0]!.value) === userId;
}

/**
 * Tables that carry user_id and must be re-keyed when the default-user
 * row is claimed by a real account. Add new tables here as the schema grows.
 */
export const USER_TENANCY_TABLES = [
  "outlets",
  "wp_authorize_states",
  "source_folders",
  "source_folder_assignments",
  "sources",
  "items",
  "clusters",
  "drafts",
  "voice_profiles",
  "ranker_signals",
  "ranker_corrections",
  "event_log",
  "notification_webhook_deliveries",
  "trace_log",
  "user_plans",
] as const;
