import "server-only";
import { randomBytes } from "node:crypto";
import { db } from "./db";

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
  const r = await db.execute({
    sql: `UPDATE ${table}
          SET used_at = ?
          WHERE token = ?
            AND used_at IS NULL
            AND expires_at > ?`,
    args: [now, token, now],
  });
  if (Number(r.rowsAffected ?? 0) === 0) return null;
  const row = await db.execute({
    sql: `SELECT user_id FROM ${table} WHERE token = ?`,
    args: [token],
  });
  if (row.rows.length === 0) return null;
  return String(row.rows[0]!.user_id);
}

export async function issueVerificationToken(userId: string): Promise<string> {
  const token = generateToken();
  const now = Date.now();
  await db.execute({
    sql: `INSERT INTO email_verification_tokens (token, user_id, created_at, expires_at)
          VALUES (?, ?, ?, ?)`,
    args: [token, userId, now, now + VERIFICATION_TTL_MS],
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
    args: [token, userId, now, now + RESET_TTL_MS],
  });
  return token;
}

export async function consumePasswordResetToken(token: string): Promise<string | null> {
  return consumeFromTable("password_reset_tokens", token);
}
