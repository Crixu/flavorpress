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
  pollAllEnabled: boolean;
  source: "stored" | "default" | "local";
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
const LOCAL_LIMITS: PlanLimits = {
  outlets: Number.MAX_SAFE_INTEGER,
  sources: Number.MAX_SAFE_INTEGER,
  folders: Number.MAX_SAFE_INTEGER,
};

function isLocalAuthMode(): boolean {
  return process.env.FLAVORPRESS_AUTH === "local";
}

export function normalizePlanKey(value: unknown): PlanKey {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  return normalized === "pro" || normalized === "custom" ? normalized : "trial";
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

function rowValue(row: Record<string, unknown> | undefined, key: string): unknown {
  if (!row) return undefined;
  if (Object.hasOwn(row, key)) return row[key];
  const lowerKey = key.toLowerCase();
  const found = Object.keys(row).find((candidate) => candidate.toLowerCase() === lowerKey);
  return found ? row[found] : undefined;
}

export function mapUserPlanRow(row: Record<string, unknown> | undefined, userId: string): UserPlan {
  const hasStoredPlan = row !== undefined;
  const plan = normalizePlanKey(rowValue(row, "plan"));
  const limits = limitsForPlan(plan, {
    outlets: rowValue(row, "custom_outlet_limit"),
    sources: rowValue(row, "custom_source_limit"),
    folders: rowValue(row, "custom_folder_limit"),
  });
  return {
    userId,
    plan,
    limits,
    pollAllEnabled: plan === "custom" && Number(rowValue(row, "poll_all_enabled") ?? 0) === 1,
    source: hasStoredPlan ? "stored" : "default",
    updatedAt: rowValue(row, "updated_at") == null ? null : Number(rowValue(row, "updated_at")),
  };
}

export async function getUserPlan(userId: string): Promise<UserPlan> {
  if (isLocalAuthMode()) {
    return {
      userId,
      plan: "custom",
      limits: LOCAL_LIMITS,
      pollAllEnabled: true,
      source: "local",
      updatedAt: null,
    };
  }
  await ensureSchema();
  const r = await db.execute({
    sql: `SELECT user_id AS user_id,
                 plan AS plan,
                 custom_outlet_limit AS custom_outlet_limit,
                 custom_source_limit AS custom_source_limit,
                 custom_folder_limit AS custom_folder_limit,
                 poll_all_enabled AS poll_all_enabled,
                 updated_at AS updated_at
          FROM user_plans WHERE user_id = ?`,
    args: [userId],
  });
  return mapUserPlanRow(r.rows[0] as Record<string, unknown> | undefined, userId);
}

export async function canPollAllSources(userId: string, isAdmin: boolean): Promise<boolean> {
  if (isLocalAuthMode()) return true;
  if (isAdmin) return true;
  const plan = await getUserPlan(userId);
  return plan.pollAllEnabled;
}

interface SetUserPlanOptions extends Partial<PlanLimits> {
  pollAllEnabled?: boolean;
}

export async function setUserPlan(
  userId: string,
  plan: PlanKey,
  limits?: SetUserPlanOptions,
): Promise<void> {
  await ensureSchema();
  const normalized = normalizePlanKey(plan);
  const customLimits = limitsForPlan("custom", limits);
  const pollAllEnabled = normalized === "custom" && limits?.pollAllEnabled === true;
  await db.execute({
    sql: `INSERT INTO user_plans (
            user_id, plan, custom_outlet_limit, custom_source_limit,
            custom_folder_limit, poll_all_enabled, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(user_id) DO UPDATE SET
            plan = excluded.plan,
            custom_outlet_limit = excluded.custom_outlet_limit,
            custom_source_limit = excluded.custom_source_limit,
            custom_folder_limit = excluded.custom_folder_limit,
            poll_all_enabled = excluded.poll_all_enabled,
            updated_at = excluded.updated_at`,
    args: [
      userId,
      normalized,
      customLimits.outlets,
      customLimits.sources,
      customLimits.folders,
      pollAllEnabled ? 1 : 0,
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
  if (isLocalAuthMode()) return;
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
