import "server-only";

/**
 * In-process source-poll scheduler.
 *
 * Wakes every minute, finds sources whose `last_polled_at +
 * pollIntervalSeconds` has elapsed, and pushes them through the
 * shared poll queue. The queue handles the throttling; this module
 * just decides what's due.
 *
 * Lifecycle: started lazily by `ensureRegisteredCapabilities()` on the
 * first server-action call after `next dev` boots, then runs for the
 * life of the Node process. Disabled on Vercel, where `/api/cron/poll`
 * runs the same due-source pass, and during the production build
 * step. The `FLAVORPRESS_DISABLE_SCHEDULER` env var turns it off for
 * tests and ops one-offs.
 *
 * Skips: sources that are paused, under HTTP backoff, or inactive.
 */

import { db, ensureSchema } from "../db";
import { getRegistry } from "./capability-registry";
import { registrableDomain } from "./polite-fetch";
import { getPollQueue } from "./run-queue";

const TICK_MS = 60_000;

let started = false;
let timer: ReturnType<typeof setInterval> | null = null;

export function startPollScheduler(): void {
  if (started) return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  if (process.env.VERCEL === "1") return;
  if (process.env.FLAVORPRESS_DISABLE_SCHEDULER === "1") return;
  if (process.env.NODE_ENV === "test") return;

  started = true;
  void runDuePolls();
  timer = setInterval(() => void runDuePolls(), TICK_MS);
  timer.unref?.();
}

export function _stopPollSchedulerForTests(): void {
  if (timer) clearInterval(timer);
  timer = null;
  started = false;
}

export interface DuePollResult {
  due: number;
  queued: number;
  skipped: number;
  pending: number;
  timedOut: number;
  budgetExhausted: boolean;
  elapsedMs: number;
}

const DEFAULT_MAX_BATCH = 5;
const DEFAULT_RETURN_BUFFER_MS = 5_000;

function emptyResult(startedAt: number): DuePollResult {
  return {
    due: 0,
    queued: 0,
    skipped: 0,
    pending: 0,
    timedOut: 0,
    budgetExhausted: false,
    elapsedMs: Date.now() - startedAt,
  };
}

export async function runDuePolls(
  options: {
    wait?: boolean;
    throwOnError?: boolean;
    /**
     * Maximum number of sources processed per invocation. Bounds the
     * cron-tick runtime so a single Vercel function call cannot time
     * out regardless of how many sources are due. Remaining due sources
     * are picked up on the next tick. Defaults to 5.
     */
    maxBatch?: number;
    /**
     * Optional wall-clock budget for this scheduler pass. When set with
     * wait=true, the runner stops claiming new sources before the budget
     * expires and returns normally so Vercel does not kill the invocation.
     */
    timeBudgetMs?: number;
    /**
     * Time kept in reserve for the route to serialize and return the
     * response. Tests can lower this to exercise the budget path quickly.
     */
    returnBufferMs?: number;
    /**
     * Called when a started task exceeds the caller's return budget. Route
     * handlers can attach the task to their post-response lifecycle so the
     * source is not abandoned after it has already been claimed.
     */
    deferTimedOutTask?: (task: Promise<void>) => void;
  } = {},
): Promise<DuePollResult> {
  const startedAt = Date.now();
  const maxBatch = Math.max(1, options.maxBatch ?? DEFAULT_MAX_BATCH);
  const deadline =
    options.wait && options.timeBudgetMs && options.timeBudgetMs > 0
      ? startedAt + options.timeBudgetMs
      : null;
  const returnBufferMs = Math.max(0, options.returnBufferMs ?? DEFAULT_RETURN_BUFFER_MS);
  try {
    await ensureSchema();
    const now = Date.now();
    // Most-overdue first so any remaining sources for this user get picked
    // up on the next tick. NULL last_polled_at sorts first via the COALESCE
    // pattern so brand-new sources run on their first tick.
    const due = await db.execute({
      sql: `SELECT id, user_id, url, kind, last_polled_at FROM sources
            WHERE active = 1
              AND (paused_until IS NULL OR paused_until <= ?)
              AND (backoff_until IS NULL OR backoff_until <= ?)
              AND (last_polled_at IS NULL
                   OR last_polled_at + (poll_interval_seconds * 1000) <= ?)
            ORDER BY COALESCE(last_polled_at, 0) ASC
            LIMIT ?`,
      args: [now, now, now, maxBatch + 1],
    });
    if (due.rows.length === 0) return emptyResult(startedAt);
    const selected = due.rows.slice(0, maxBatch);
    let pending = Math.max(0, due.rows.length - maxBatch);

    const queue = getPollQueue();
    const registry = getRegistry();
    const tasks: Promise<void>[] = [];
    let queued = 0;
    let skipped = 0;
    let timedOut = 0;
    let budgetExhausted = false;

    for (let i = 0; i < selected.length; i++) {
      if (deadline !== null && Date.now() + returnBufferMs >= deadline) {
        budgetExhausted = true;
        pending += selected.length - i;
        break;
      }

      const row = selected[i]!;
      const sourceId = String(row.id);
      const previousLastPolledAt =
        row.last_polled_at === null || row.last_polled_at === undefined
          ? null
          : Number(row.last_polled_at);
      const claimedSource = await claimSourceForPoll({
        sourceId,
        previousLastPolledAt,
        claimAt: now,
      });
      if (!claimedSource) {
        skipped += 1;
        continue;
      }

      const userId = String(row.user_id);
      const kind = String(row.kind ?? "rss");
      const url = String(row.url ?? "");
      let host = "unknown";
      try {
        host = registrableDomain(new URL(url).hostname);
      } catch {
        // bad URL falls through with the unknown bucket
      }
      const capabilityId = kind === "reddit" ? "source-connector.reddit" : "source-connector.rss";
      const task = queue.addUnique(sourceId, host, () =>
        registry.invoke(
          capabilityId,
          undefined,
          { sourceId },
          {
            userId,
            requestId: crypto.randomUUID(),
            traceId: crypto.randomUUID(),
          },
        ),
      );
      if (!task) {
        skipped += 1;
        continue;
      }
      queued += 1;
      const handled = task
        .then(() => undefined)
        .catch((err) => {
          console.warn(`[scheduler] poll ${sourceId}: ${err}`);
        });
      if (options.wait) {
        tasks.push(handled);
        if (deadline !== null) {
          const remainingMs = deadline - Date.now() - returnBufferMs;
          const settled = await waitForTaskWithin(handled, remainingMs);
          if (!settled) {
            timedOut += 1;
            budgetExhausted = true;
            pending += selected.length - i - 1;
            options.deferTimedOutTask?.(handled);
            console.warn(`[scheduler] poll ${sourceId}: exceeded cron time budget`);
            break;
          }
        } else {
          await handled;
        }
      } else {
        void handled;
      }
    }
    if (tasks.length > 0 && !options.wait) await Promise.all(tasks);
    return {
      due: selected.length,
      queued,
      skipped,
      pending,
      timedOut,
      budgetExhausted,
      elapsedMs: Date.now() - startedAt,
    };
  } catch (err) {
    console.warn(`[scheduler] tick failed: ${err}`);
    if (options.throwOnError) throw err;
    return emptyResult(startedAt);
  }
}

async function waitForTaskWithin(task: Promise<void>, timeoutMs: number): Promise<boolean> {
  if (timeoutMs <= 0) return false;
  let timeout: ReturnType<typeof setTimeout> | null = null;
  const result = await Promise.race([
    task.then(() => "settled" as const),
    new Promise<"timeout">((resolve) => {
      timeout = setTimeout(() => resolve("timeout"), timeoutMs);
    }),
  ]);
  if (timeout) clearTimeout(timeout);
  return result === "settled";
}

async function claimSourceForPoll({
  sourceId,
  previousLastPolledAt,
  claimAt,
}: {
  sourceId: string;
  previousLastPolledAt: number | null;
  claimAt: number;
}): Promise<boolean> {
  const r = await db.execute({
    sql: `UPDATE sources
          SET last_polled_at = ?
          WHERE id = ?
            AND active = 1
            AND (paused_until IS NULL OR paused_until <= ?)
            AND (backoff_until IS NULL OR backoff_until <= ?)
            AND (
              (? IS NULL AND last_polled_at IS NULL)
              OR last_polled_at = ?
            )`,
    args: [claimAt, sourceId, claimAt, claimAt, previousLastPolledAt, previousLastPolledAt],
  });
  return Number(r.rowsAffected ?? 0) > 0;
}
