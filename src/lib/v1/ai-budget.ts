import "server-only";

import { db, ensureSchema } from "../db";
import { getUserPlan, type PlanKey } from "../plans";
import { getSetting } from "./settings";

const DEFAULT_DAILY_TOKEN_LIMITS = {
  free: 200_000,
  pro: 2_000_000,
  studio: 6_000_000,
} as const;

const APP_SETTING_KEYS = {
  free: "ai_daily_tokens_free",
  pro: "ai_daily_tokens_pro",
  studio: "ai_daily_tokens_studio",
} as const;

const ENV_KEYS = {
  free: "FLAVORPRESS_DAILY_TOKENS_FREE",
  pro: "FLAVORPRESS_DAILY_TOKENS_PRO",
  studio: "FLAVORPRESS_DAILY_TOKENS_STUDIO",
} as const;

type BudgetTier = keyof typeof DEFAULT_DAILY_TOKEN_LIMITS;

export interface AiBudgetReservation {
  userId: string;
  dayUtc: string;
  estimatedTokens: number;
  tokensLimit: number;
}

export interface AiBudgetSnapshot {
  userId: string;
  dayUtc: string;
  tokensRemaining: number;
  tokensLimit: number;
}

export class AiBudgetExceeded extends Error {
  readonly code = "ai_budget_exceeded";

  constructor(
    readonly userId: string,
    readonly requestedTokens: number,
    readonly tokensRemaining: number,
    readonly tokensLimit: number,
    readonly dayUtc: string,
  ) {
    super(
      `Daily Anthropic token budget exhausted for this user; requested ${requestedTokens} tokens with ${tokensRemaining} of ${tokensLimit} remaining for ${dayUtc} UTC.`,
    );
    this.name = "AiBudgetExceeded";
  }
}

export async function reserveTokens(
  userId: string,
  estimatedTokens: number,
): Promise<AiBudgetReservation> {
  const tokens = normalizeTokens(estimatedTokens);
  const dayUtc = currentUtcDay();
  const tokensLimit = await dailyLimitForUser(userId);
  await ensureBudgetRow(userId, dayUtc, tokensLimit);

  const debit = await db.execute({
    sql: `UPDATE user_ai_budget
          SET tokens_remaining = tokens_remaining - ?,
              tokens_limit = ?,
              updated_at = ?
          WHERE user_id = ?
            AND day_utc = ?
            AND tokens_remaining >= ?`,
    args: [tokens, tokensLimit, Date.now(), userId, dayUtc, tokens],
  });

  if (Number(debit.rowsAffected ?? 0) === 0) {
    const snapshot = await getRemainingTokens(userId);
    throw new AiBudgetExceeded(
      userId,
      tokens,
      snapshot.tokensRemaining,
      snapshot.tokensLimit,
      snapshot.dayUtc,
    );
  }

  return { userId, dayUtc, estimatedTokens: tokens, tokensLimit };
}

export async function refundTokens(
  userId: string,
  deltaTokens: number,
  dayUtc = currentUtcDay(),
): Promise<AiBudgetSnapshot> {
  const tokens = Math.max(0, Math.floor(deltaTokens));
  const tokensLimit = await dailyLimitForUser(userId);
  await ensureBudgetRow(userId, dayUtc, tokensLimit);
  if (tokens > 0) {
    await db.execute({
      sql: `UPDATE user_ai_budget
            SET tokens_remaining = MIN(?, tokens_remaining + ?),
                tokens_limit = ?,
                updated_at = ?
            WHERE user_id = ? AND day_utc = ?`,
      args: [tokensLimit, tokens, tokensLimit, Date.now(), userId, dayUtc],
    });
  }
  return getRemainingTokens(userId, dayUtc);
}

export async function refundReservation(
  reservation: AiBudgetReservation,
  actualTokens: number | null,
): Promise<void> {
  if (actualTokens === null) return;
  const actual = Math.max(0, Math.ceil(actualTokens));
  const refund = reservation.estimatedTokens - actual;
  if (refund <= 0) return;
  await refundTokens(reservation.userId, refund, reservation.dayUtc);
}

export async function getRemainingTokens(
  userId: string,
  dayUtc = currentUtcDay(),
): Promise<AiBudgetSnapshot> {
  const tokensLimit = await dailyLimitForUser(userId);
  await ensureBudgetRow(userId, dayUtc, tokensLimit);
  const r = await db.execute({
    sql: `SELECT tokens_remaining, tokens_limit
          FROM user_ai_budget
          WHERE user_id = ? AND day_utc = ?`,
    args: [userId, dayUtc],
  });
  const row = r.rows[0];
  return {
    userId,
    dayUtc,
    tokensRemaining: Number(row?.tokens_remaining ?? tokensLimit),
    tokensLimit: Number(row?.tokens_limit ?? tokensLimit),
  };
}

function currentUtcDay(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

async function ensureBudgetRow(userId: string, dayUtc: string, tokensLimit: number): Promise<void> {
  await ensureSchema();
  const now = Date.now();
  await db.execute({
    sql: `INSERT OR IGNORE INTO user_ai_budget
          (user_id, day_utc, tokens_remaining, tokens_limit, updated_at)
          VALUES (?, ?, ?, ?, ?)`,
    args: [userId, dayUtc, tokensLimit, tokensLimit, now],
  });
  await db.execute({
    sql: `UPDATE user_ai_budget
          SET tokens_remaining = MIN(tokens_remaining, ?),
              tokens_limit = ?,
              updated_at = ?
          WHERE user_id = ? AND day_utc = ?`,
    args: [tokensLimit, tokensLimit, now, userId, dayUtc],
  });
}

async function dailyLimitForUser(userId: string): Promise<number> {
  const plan = await getUserPlan(userId);
  const tier = tierForPlan(plan.plan);
  const configured = await getSetting(APP_SETTING_KEYS[tier], userId);
  return positiveInt(configured ?? process.env[ENV_KEYS[tier]], DEFAULT_DAILY_TOKEN_LIMITS[tier]);
}

function tierForPlan(plan: PlanKey): BudgetTier {
  if (plan === "pro") return "pro";
  if (plan === "custom") return "studio";
  return "free";
}

function positiveInt(value: unknown, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.floor(n);
}

function normalizeTokens(value: number): number {
  if (!Number.isFinite(value) || value < 1) return 1;
  return Math.ceil(value);
}
