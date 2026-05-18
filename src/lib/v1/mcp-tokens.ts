import "server-only";

import { randomBytes } from "node:crypto";
import { db, ensureSchema } from "@/lib/db";
import { hashToken } from "@/lib/token-hash";

const TOKEN_PREFIX = "fp_mcp_";

export interface IssuedMcpToken {
  token: string;
  userId: string;
  label: string | null;
  createdAt: number;
}

export interface ConsumedMcpToken {
  userId: string;
}

export class McpTokenSecretError extends Error {
  constructor() {
    super("MCP token secret is not configured");
    this.name = "McpTokenSecretError";
  }
}

export async function issueMcpToken(
  userId: string,
  label?: string | null,
): Promise<IssuedMcpToken> {
  await ensureSchema();

  const token = `${TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
  const tokenHash = hashMcpToken(token);
  const createdAt = Date.now();
  const normalizedLabel = normalizeLabel(label);

  await db.execute({
    sql: `INSERT INTO user_mcp_tokens (token_hash, user_id, label, created_at)
          VALUES (?, ?, ?, ?)`,
    args: [tokenHash, userId, normalizedLabel, createdAt],
  });

  return { token, userId, label: normalizedLabel, createdAt };
}

export async function consumeMcpToken(token: string): Promise<ConsumedMcpToken | null> {
  const trimmed = token.trim();
  if (!trimmed) return null;

  await ensureSchema();
  const tokenHash = hashMcpToken(trimmed);
  const now = Date.now();
  const row = await db.execute({
    sql: `UPDATE user_mcp_tokens
          SET last_used_at = ?
          WHERE token_hash = ?
            AND revoked_at IS NULL
            AND EXISTS (
              SELECT 1 FROM users
              WHERE users.id = user_mcp_tokens.user_id
                AND users.status = 'active'
            )
          RETURNING user_id`,
    args: [now, tokenHash],
  });
  if (row.rows.length === 0) return null;
  return { userId: String(row.rows[0]!.user_id) };
}

export async function revokeMcpToken(token: string): Promise<boolean> {
  const trimmed = token.trim();
  if (!trimmed) return false;

  await ensureSchema();
  const revoked = await db.execute({
    sql: `UPDATE user_mcp_tokens
          SET revoked_at = ?
          WHERE token_hash = ?
            AND revoked_at IS NULL`,
    args: [Date.now(), hashMcpToken(trimmed)],
  });
  return Number(revoked.rowsAffected ?? 0) > 0;
}

function hashMcpToken(token: string): string {
  try {
    return hashToken(token);
  } catch (err) {
    if (err instanceof Error && err.message.includes("FLAVORPRESS_SESSION_SECRET")) {
      throw new McpTokenSecretError();
    }
    throw err;
  }
}

function normalizeLabel(label: string | null | undefined): string | null {
  const normalized = label?.trim();
  return normalized ? normalized : null;
}
