import "server-only";
import { db, ensureSchema } from "./db";

export type PlanKey = "trial" | "pro" | "custom";

export interface PlanLimits {
  outlets: number;
  sources: number;
  folders: number;
}

export interface UserPlan {
  userId: string;
  plan: PlanKey;
  limits: PlanLimits;
  updatedAt: number | null;
}

export class PlanLimitError extends Error {
  readonly code = "plan_limit";
  readonly resource: keyof PlanLimits;
  readonly limit: number;

  constructor(resource: keyof PlanLimits, limit: number) {
    super(`This plan allows ${limit} ${resource}.`);
    this.name = "PlanLimitError";
    this.resource = resource;
    this.limit = limit;
  }
}

export const PLAN_LIMITS = {
  trial: { outlets: 1, sources: 10, folders: 1 },
  pro: { outlets: 5, sources: 100, folders: 5 },
} as const satisfies Record<Exclude<PlanKey, "custom">, PlanLimits>;

const DEFAULT_CUSTOM_LIMITS: PlanLimits = { outlets: 10, sources: 250, folders: 25 };

function normalizePlan(value: unknown): PlanKey {
  return value === "pro" || value === "custom" ? value : "trial";
}

function positiveInt(value: unknown, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.floor(n);
}

export function limitsForPlan(
  plan: PlanKey,
  custom?: Partial<Record<keyof PlanLimits, unknown>> | null,
): PlanLimits {
  if (plan === "trial") return PLAN_LIMITS.trial;
  if (plan === "pro") return PLAN_LIMITS.pro;
  return {
    outlets: positiveInt(custom?.outlets, DEFAULT_CUSTOM_LIMITS.outlets),
    sources: positiveInt(custom?.sources, DEFAULT_CUSTOM_LIMITS.sources),
    folders: positiveInt(custom?.folders, DEFAULT_CUSTOM_LIMITS.folders),
  };
}

function rowToPlan(row: Record<string, unknown> | undefined, userId: string): UserPlan {
  const plan = normalizePlan(row?.plan);
  const limits = limitsForPlan(plan, {
    outlets: row?.custom_outlet_limit,
    sources: row?.custom_source_limit,
    folders: row?.custom_folder_limit,
  });
  return {
    userId,
    plan,
    limits,
    updatedAt: row?.updated_at == null ? null : Number(row.updated_at),
  };
}

export async function getUserPlan(userId: string): Promise<UserPlan> {
  await ensureSchema();
  const r = await db.execute({
    sql: `SELECT user_id, plan, custom_outlet_limit, custom_source_limit, custom_folder_limit, updated_at
          FROM user_plans WHERE user_id = ?`,
    args: [userId],
  });
  return rowToPlan(r.rows[0] as Record<string, unknown> | undefined, userId);
}

export async function canPollAllSources(userId: string, isAdmin: boolean): Promise<boolean> {
  if (isAdmin) return true;
  const plan = await getUserPlan(userId);
  return plan.plan === "custom";
}

export async function setUserPlan(
  userId: string,
  plan: PlanKey,
  limits?: Partial<PlanLimits>,
): Promise<void> {
  await ensureSchema();
  const normalized = normalizePlan(plan);
  const customLimits = limitsForPlan("custom", limits);
  await db.execute({
    sql: `INSERT INTO user_plans (
            user_id, plan, custom_outlet_limit, custom_source_limit,
            custom_folder_limit, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(user_id) DO UPDATE SET
            plan = excluded.plan,
            custom_outlet_limit = excluded.custom_outlet_limit,
            custom_source_limit = excluded.custom_source_limit,
            custom_folder_limit = excluded.custom_folder_limit,
            updated_at = excluded.updated_at`,
    args: [
      userId,
      normalized,
      customLimits.outlets,
      customLimits.sources,
      customLimits.folders,
      Date.now(),
    ],
  });
}

async function countRows(table: "outlets" | "sources" | "source_folders", userId: string) {
  const r = await db.execute({
    sql: `SELECT COUNT(*) AS n FROM ${table} WHERE user_id = ?`,
    args: [userId],
  });
  return Number(r.rows[0]?.n ?? 0);
}

async function assertCanCreate(
  userId: string,
  resource: keyof PlanLimits,
  currentCount: number,
  addCount: number,
) {
  const plan = await getUserPlan(userId);
  const limit = plan.limits[resource];
  if (currentCount + addCount > limit) throw new PlanLimitError(resource, limit);
}

export async function assertCanCreateOutlets(userId: string, addCount = 1): Promise<void> {
  await assertCanCreate(userId, "outlets", await countRows("outlets", userId), addCount);
}

export async function assertCanCreateSources(userId: string, addCount = 1): Promise<void> {
  await assertCanCreate(userId, "sources", await countRows("sources", userId), addCount);
}

export async function assertCanCreateFolders(userId: string, addCount = 1): Promise<void> {
  await assertCanCreate(userId, "folders", await countRows("source_folders", userId), addCount);
}
