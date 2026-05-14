import "server-only";
import { randomBytes } from "node:crypto";
import { db } from "./db";
import { hashToken, isStoredTokenHash } from "./token-hash";

const VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;
const RESET_TTL_MS = 60 * 60 * 1000;

function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

async function consumeFromTable(
  table: "email_verification_tokens" | "password_reset_tokens",
  token: string,
): Promise<string | null> {
  const now = Date.now();
  const hashed = hashToken(token);
  const r = await db.execute({
    sql: `UPDATE ${table}
          SET used_at = ?
          WHERE token = ?
            AND used_at IS NULL
            AND expires_at > ?
          RETURNING user_id`,
    args: [now, hashed, now],
  });
  if (r.rows.length > 0) {
    return String(r.rows[0]!.user_id);
  }
  if (isStoredTokenHash(token)) return null;
  // Backward compat: tolerate plaintext rows from before hashing rolled out.
  // Remove this fallback after the verification/reset TTL window has elapsed.
  const legacy = await db.execute({
    sql: `UPDATE ${table}
          SET used_at = ?, token = ?
          WHERE token = ?
            AND used_at IS NULL
            AND expires_at > ?
          RETURNING user_id`,
    args: [now, hashed, token, now],
  });
  if (legacy.rows.length > 0) {
    return String(legacy.rows[0]!.user_id);
  }
  return null;
}

export async function issueVerificationToken(userId: string): Promise<string> {
  const token = generateToken();
  const now = Date.now();
  await db.execute({
    sql: `INSERT INTO email_verification_tokens (token, user_id, created_at, expires_at)
          VALUES (?, ?, ?, ?)`,
    args: [hashToken(token), userId, now, now + VERIFICATION_TTL_MS],
  });
  return token;
}

export async function consumeVerificationToken(token: string): Promise<string | null> {
  return consumeFromTable("email_verification_tokens", token);
}

export async function issuePasswordResetToken(userId: string): Promise<string> {
  const token = generateToken();
  const now = Date.now();
  await db.execute({
    sql: `INSERT INTO password_reset_tokens (token, user_id, created_at, expires_at)
          VALUES (?, ?, ?, ?)`,
    args: [hashToken(token), userId, now, now + RESET_TTL_MS],
  });
  return token;
}

export async function consumePasswordResetToken(token: string): Promise<string | null> {
  return consumeFromTable("password_reset_tokens", token);
}
