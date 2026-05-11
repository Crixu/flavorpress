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
}

export async function runDuePolls(
  options: { wait?: boolean; throwOnError?: boolean } = {},
): Promise<DuePollResult> {
  try {
    await ensureSchema();
    const now = Date.now();
    const due = await db.execute({
      sql: `SELECT id, user_id, url, kind FROM sources
            WHERE active = 1
              AND (paused_until IS NULL OR paused_until <= ?)
              AND (backoff_until IS NULL OR backoff_until <= ?)
              AND (last_polled_at IS NULL
                   OR last_polled_at + (poll_interval_seconds * 1000) <= ?)`,
      args: [now, now, now],
    });
    if (due.rows.length === 0) return { due: 0, queued: 0, skipped: 0 };

    const queue = getPollQueue();
    const registry = getRegistry();
    const tasks: Promise<void>[] = [];
    let queued = 0;
    let skipped = 0;
    for (const row of due.rows) {
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
    return { due: due.rows.length, queued, skipped };
  } catch (err) {
    console.warn(`[scheduler] tick failed: ${err}`);
    if (options.throwOnError) throw err;
    return { due: 0, queued: 0, skipped: 0 };
  }
}
