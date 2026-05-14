import "server-only";
import { randomBytes } from "node:crypto";
import { db } from "./db";
import { hashToken, isStoredTokenHash } from "./token-hash";

export interface InviteRow {
  token: string;
  created_by_user_id: string | null;
  used_by_user_id: string | null;
  created_at: number;
  expires_at: number | null;
  used_at: number | null;
  revoked_at: number | null;
}

export class InviteError extends Error {
  readonly code: "missing" | "used" | "expired" | "revoked";
  constructor(code: "missing" | "used" | "expired" | "revoked", message: string) {
    super(message);
    this.name = "InviteError";
    this.code = code;
  }
}

function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

// Backward compat: legacy rows may have stored the plaintext token. Try the
// hashed lookup first, then fall back to plaintext. Remove the fallback after
// the longest invite TTL has elapsed.
async function findInviteRowRaw(
  token: string,
): Promise<{ row: Record<string, unknown> | undefined; legacy: boolean }> {
  const hashed = hashToken(token);
  const r = await db.execute({
    sql: `SELECT token, created_by_user_id, used_by_user_id, created_at, expires_at, used_at, revoked_at
          FROM invites WHERE token = ?`,
    args: [hashed],
  });
  if (r.rows[0]) return { row: r.rows[0] as Record<string, unknown>, legacy: false };
  if (isStoredTokenHash(token)) return { row: undefined, legacy: false };
  const legacy = await db.execute({
    sql: `SELECT token, created_by_user_id, used_by_user_id, created_at, expires_at, used_at, revoked_at
          FROM invites WHERE token = ?`,
    args: [token],
  });
  return { row: legacy.rows[0] as Record<string, unknown> | undefined, legacy: true };
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
    args: [hashToken(token), opts.createdByUserId ?? null, now, expiresAt],
  });
  return { token, expiresAt };
}

export async function readInvite(token: string): Promise<InviteRow | null> {
  const { row, legacy } = await findInviteRowRaw(token);
  if (!row) return null;
  const revokedAt = row.revoked_at == null ? null : Number(row.revoked_at);
  if (revokedAt != null) return null;
  const usedAt = row.used_at == null ? null : Number(row.used_at);
  if (usedAt != null) return null;
  const expiresAt = row.expires_at == null ? null : Number(row.expires_at);
  if (expiresAt != null && expiresAt <= Date.now()) return null;
  if (legacy) {
    // Opportunistically upgrade legacy plaintext rows to the hashed format.
    await db.execute({
      sql: `UPDATE invites SET token = ? WHERE token = ?`,
      args: [hashToken(token), token],
    });
  }
  return {
    token,
    created_by_user_id: row.created_by_user_id == null ? null : String(row.created_by_user_id),
    used_by_user_id: row.used_by_user_id == null ? null : String(row.used_by_user_id),
    created_at: Number(row.created_at),
    expires_at: expiresAt,
    used_at: usedAt,
    revoked_at: revokedAt,
  };
}

export async function consumeInvite(token: string, userId: string): Promise<void> {
  const now = Date.now();
  const hashed = hashToken(token);
  const r = await db.execute({
    sql: `UPDATE invites
          SET used_at = ?, used_by_user_id = ?
          WHERE token = ?
            AND used_at IS NULL
            AND revoked_at IS NULL
            AND (expires_at IS NULL OR expires_at > ?)
          RETURNING token`,
    args: [now, userId, hashed, now],
  });
  if (r.rows.length > 0) return;
  if (isStoredTokenHash(token)) throw new InviteError("missing", "Invite token does not exist.");
  // Backward compat: try the plaintext row and upgrade to hashed on success.
  const legacy = await db.execute({
    sql: `UPDATE invites
          SET used_at = ?, used_by_user_id = ?, token = ?
          WHERE token = ?
            AND used_at IS NULL
            AND revoked_at IS NULL
            AND (expires_at IS NULL OR expires_at > ?)
          RETURNING token`,
    args: [now, userId, hashed, token, now],
  });
  if (legacy.rows.length > 0) return;
  const raw = await db.execute({
    sql: `SELECT used_at, expires_at, revoked_at FROM invites WHERE token = ? OR token = ?`,
    args: [hashed, token],
  });
  const row = raw.rows[0];
  if (!row) throw new InviteError("missing", "Invite token does not exist.");
  if (row.used_at != null) throw new InviteError("used", "Invite token has already been used.");
  if (row.revoked_at != null) throw new InviteError("revoked", "Invite token has been revoked.");
  throw new InviteError("expired", "Invite token has expired.");
}

export async function revokeInvite(token: string): Promise<boolean> {
  const now = Date.now();
  const hashed = hashToken(token);
  const r = await db.execute({
    sql: `UPDATE invites
          SET revoked_at = ?
          WHERE (token = ? OR token = ?)
            AND used_at IS NULL
            AND revoked_at IS NULL`,
    args: [now, hashed, token],
  });
  return Number(r.rowsAffected ?? 0) > 0;
}
