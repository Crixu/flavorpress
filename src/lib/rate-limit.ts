import { createHash } from "node:crypto";
import { db, ensureSchema } from "./db";

const HOUR_MS = 60 * 60 * 1000;
const STALE_BUCKET_MS = 24 * HOUR_MS;

export const AUTH_IP_RATE_LIMIT = {
  limit: 10,
  windowMs: 60_000,
} as const;

export const AUTH_ACCOUNT_RATE_LIMIT = {
  limit: 5,
  windowMs: 60_000,
} as const;

export const AUTH_FAILURE_SESSION_BUMP_THRESHOLD = 5;

export const OPML_UPLOAD_RATE_LIMIT = {
  limit: 10,
  windowMs: HOUR_MS,
} as const;

export interface RateLimitOptions {
  scope: string;
  key: string;
  limit: number;
  windowMs?: number;
  now?: number;
}

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  retryAfterMs: number;
  resetAt: number;
}

interface HeaderLike {
  get(name: string): string | null;
}

export function getClientIp(headers: HeaderLike): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return (
    forwarded ||
    headers.get("cf-connecting-ip")?.trim() ||
    headers.get("x-real-ip")?.trim() ||
    "unknown"
  );
}

export function rateLimitKey(kind: string, value: string): string {
  const normalized = value.trim().toLowerCase() || "unknown";
  const hash = createHash("sha256").update(`${kind}:${normalized}`, "utf8").digest("hex");
  return `${kind}:${hash}`;
}

export async function consumeRateLimit({
  scope,
  key,
  limit,
  windowMs = HOUR_MS,
  now = Date.now(),
}: RateLimitOptions): Promise<RateLimitResult> {
  if (!scope) throw new Error("Rate limit scope required.");
  if (!key) throw new Error("Rate limit key required.");
  if (!Number.isInteger(limit) || limit < 1) throw new Error("Rate limit must be positive.");
  if (!Number.isInteger(windowMs) || windowMs < 1) throw new Error("Rate limit window invalid.");

  await ensureSchema();
  await pruneStaleRateBuckets(now);
  const windowStart = Math.floor(now / windowMs) * windowMs;
  const resetAt = windowStart + windowMs;
  await db.execute({
    sql: `INSERT INTO rate_buckets (scope, key, tokens, refilled_at)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(scope, key) DO NOTHING`,
    args: [scope, key, limit, windowStart],
  });

  const consumed = await db.execute({
    sql: `UPDATE rate_buckets
          SET tokens = CASE
                WHEN refilled_at < ? THEN ?
                ELSE tokens - 1
              END,
              refilled_at = CASE
                WHEN refilled_at < ? THEN ?
                ELSE refilled_at
              END
          WHERE scope = ?
            AND key = ?
            AND (refilled_at < ? OR tokens > 0)
          RETURNING tokens, refilled_at`,
    args: [windowStart, limit - 1, windowStart, windowStart, scope, key, windowStart],
  });
  const row = consumed.rows[0];
  if (row) {
    const refilledAt = Number(row.refilled_at);
    return {
      ok: true,
      remaining: Number(row.tokens),
      retryAfterMs: 0,
      resetAt: refilledAt + windowMs,
    };
  }

  const existing = await db.execute({
    sql: `SELECT tokens, refilled_at FROM rate_buckets WHERE scope = ? AND key = ?`,
    args: [scope, key],
  });
  const existingRow = existing.rows[0];
  const existingResetAt = existingRow ? Number(existingRow.refilled_at) + windowMs : resetAt;
  return {
    ok: false,
    remaining: existingRow ? Math.max(0, Number(existingRow.tokens)) : 0,
    retryAfterMs: Math.max(0, existingResetAt - now),
    resetAt: existingResetAt,
  };
}

export async function recordAuthFailure({
  scope,
  key,
  now = Date.now(),
}: Pick<RateLimitOptions, "scope" | "key" | "now">): Promise<number> {
  await ensureSchema();
  await pruneStaleRateBuckets(now);
  const result = await db.execute({
    sql: `INSERT INTO rate_buckets (scope, key, tokens, refilled_at)
          VALUES (?, ?, 1, ?)
          ON CONFLICT(scope, key)
          DO UPDATE SET
            tokens = rate_buckets.tokens + 1,
            refilled_at = excluded.refilled_at
          RETURNING tokens`,
    args: [scope, key, now],
  });
  return Number(result.rows[0]?.tokens ?? 1);
}

async function pruneStaleRateBuckets(now: number): Promise<void> {
  await db.execute({
    sql: "DELETE FROM rate_buckets WHERE refilled_at < ?",
    args: [now - STALE_BUCKET_MS],
  });
}

export async function clearAuthFailures({
  scope,
  key,
}: Pick<RateLimitOptions, "scope" | "key">): Promise<void> {
  await ensureSchema();
  await db.execute({
    sql: `DELETE FROM rate_buckets WHERE scope = ? AND key = ?`,
    args: [scope, key],
  });
}
