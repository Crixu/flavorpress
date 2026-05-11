import "server-only";
import { randomBytes } from "node:crypto";
import { db } from "./db";

export interface InviteRow {
  token: string;
  created_by_user_id: string | null;
  used_by_user_id: string | null;
  created_at: number;
  expires_at: number | null;
  used_at: number | null;
}

export class InviteError extends Error {
  readonly code: "missing" | "used" | "expired";
  constructor(code: "missing" | "used" | "expired", message: string) {
    super(message);
    this.name = "InviteError";
    this.code = code;
  }
}

function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

export async function issueInvite(opts: {
  createdByUserId?: string | null;
  expiresAt?: number | null;
}): Promise<{ token: string; expiresAt: number | null }> {
  const token = generateToken();
  const now = Date.now();
  const expiresAt = opts.expiresAt ?? null;
  await db.execute({
    sql: `INSERT INTO invites (token, created_by_user_id, created_at, expires_at)
          VALUES (?, ?, ?, ?)`,
    args: [token, opts.createdByUserId ?? null, now, expiresAt],
  });
  return { token, expiresAt };
}

export async function readInvite(token: string): Promise<InviteRow | null> {
  const r = await db.execute({
    sql: `SELECT token, created_by_user_id, used_by_user_id, created_at, expires_at, used_at
          FROM invites WHERE token = ?`,
    args: [token],
  });
  const row = r.rows[0];
  if (!row) return null;
  const usedAt = row.used_at == null ? null : Number(row.used_at);
  if (usedAt != null) return null;
  const expiresAt = row.expires_at == null ? null : Number(row.expires_at);
  if (expiresAt != null && expiresAt <= Date.now()) return null;
  return {
    token: String(row.token),
    created_by_user_id: row.created_by_user_id == null ? null : String(row.created_by_user_id),
    used_by_user_id: row.used_by_user_id == null ? null : String(row.used_by_user_id),
    created_at: Number(row.created_at),
    expires_at: expiresAt,
    used_at: usedAt,
  };
}

export async function consumeInvite(token: string, userId: string): Promise<void> {
  const now = Date.now();
  const r = await db.execute({
    sql: `UPDATE invites
          SET used_at = ?, used_by_user_id = ?
          WHERE token = ?
            AND used_at IS NULL
            AND (expires_at IS NULL OR expires_at > ?)`,
    args: [now, userId, token, now],
  });
  if (Number(r.rowsAffected ?? 0) === 0) {
    const raw = await db.execute({
      sql: `SELECT used_at, expires_at FROM invites WHERE token = ?`,
      args: [token],
    });
    const row = raw.rows[0];
    if (!row) throw new InviteError("missing", "Invite token does not exist.");
    if (row.used_at != null) throw new InviteError("used", "Invite token has already been used.");
    throw new InviteError("expired", "Invite token has expired.");
  }
}
