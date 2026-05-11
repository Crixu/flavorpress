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
  id?: string;
}): Promise<User> {
  const id = opts.id ?? generateUserId();
  const email = normalizeEmail(opts.email);
  const now = Date.now();
  await db.execute({
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
      null,
      opts.isAdmin ? 1 : 0,
      now,
      now,
    ],
  });
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

export async function updatePassword(userId: string, passwordHash: string): Promise<void> {
  await db.execute({
    sql: `UPDATE users
          SET password_hash = ?, session_version = session_version + 1
          WHERE id = ?`,
    args: [passwordHash, userId],
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

export async function hasAdmin(): Promise<boolean> {
  const r = await db.execute("SELECT 1 FROM users WHERE is_admin = 1 LIMIT 1");
  return r.rows.length > 0;
}
