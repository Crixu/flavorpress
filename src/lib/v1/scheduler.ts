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
}

const DEFAULT_MAX_BATCH = 50;

export async function runDuePolls(
  options: {
    wait?: boolean;
    throwOnError?: boolean;
    /**
     * Maximum number of sources processed per invocation. Bounds the
     * cron-tick runtime so a single Vercel function call cannot time
     * out regardless of how many sources are due. Remaining due sources
     * are picked up on the next tick. Defaults to 50.
     */
    maxBatch?: number;
  } = {},
): Promise<DuePollResult> {
  const maxBatch = Math.max(1, options.maxBatch ?? DEFAULT_MAX_BATCH);
  try {
    await ensureSchema();
    const now = Date.now();
    // Most-overdue first so any remaining sources for this user get picked
    // up on the next tick. NULL last_polled_at sorts first via the COALESCE
    // pattern so brand-new sources run on their first tick.
    const due = await db.execute({
      sql: `SELECT id, user_id, url, kind FROM sources
            WHERE active = 1
              AND (paused_until IS NULL OR paused_until <= ?)
              AND (backoff_until IS NULL OR backoff_until <= ?)
              AND (last_polled_at IS NULL
                   OR last_polled_at + (poll_interval_seconds * 1000) <= ?)
            ORDER BY COALESCE(last_polled_at, 0) ASC
            LIMIT ?`,
      args: [now, now, now, maxBatch + 1],
    });
    if (due.rows.length === 0) return { due: 0, queued: 0, skipped: 0, pending: 0 };
    const batch = due.rows.slice(0, maxBatch);
    const pending = Math.max(0, due.rows.length - maxBatch);

    const queue = getPollQueue();
    const registry = getRegistry();
    const tasks: Promise<void>[] = [];
    let queued = 0;
    let skipped = 0;
    for (const row of batch) {
      const sourceId = String(row.id);
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
      } else {
        void handled;
      }
    }
    if (tasks.length > 0) await Promise.all(tasks);
    return { due: batch.length, queued, skipped, pending };
  } catch (err) {
    console.warn(`[scheduler] tick failed: ${err}`);
    if (options.throwOnError) throw err;
    return { due: 0, queued: 0, skipped: 0, pending: 0 };
  }
}
