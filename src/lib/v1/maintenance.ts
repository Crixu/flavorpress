/**
 * Library maintenance: long-running re-extract and rebuild jobs that
 * used to be CLI-only via the scripts in /scripts. The actions here
 * mirror the script behavior so a user running the macOS app can do
 * the same work from the settings UI.
 *
 * Each job inserts a row in `job_progress` with its total item count;
 * the background worker (Next.js after()) increments `completed` after
 * each unit of work; the UI polls `getJobProgress` to drive a real
 * progress bar in the toast.
 */

import { db, ensureSchema } from "../db";
import { after } from "next/server";
import { extractItemEntities } from "./entity-extractor";
import { handleItemIngested } from "./cluster-engine";

export type JobKind = "reextract-entities" | "recluster";

const REEXTRACT_CONCURRENCY = 5;

export interface JobProgress {
  id: string;
  kind: JobKind;
  total: number;
  completed: number;
  startedAt: number;
  completedAt: number | null;
  error: string | null;
}

export async function getJobProgress(jobId: string, userId: string): Promise<JobProgress | null> {
  await ensureSchema();
  const r = await db.execute({
    sql: `SELECT id, kind, total, completed, started_at, completed_at, error
          FROM job_progress WHERE id = ? AND user_id = ?`,
    args: [jobId, userId],
  });
  if (r.rows.length === 0) return null;
  const row = r.rows[0]!;
  return {
    id: String(row.id),
    kind: String(row.kind) as JobKind,
    total: Number(row.total),
    completed: Number(row.completed),
    startedAt: Number(row.started_at),
    completedAt: row.completed_at !== null ? Number(row.completed_at) : null,
    error: row.error ? String(row.error) : null,
  };
}

export async function getRunningJob(kind: JobKind, userId: string): Promise<JobProgress | null> {
  await ensureSchema();
  const r = await db.execute({
    sql: `SELECT id FROM job_progress
          WHERE kind = ? AND user_id = ? AND completed_at IS NULL AND error IS NULL
          ORDER BY started_at DESC LIMIT 1`,
    args: [kind, userId],
  });
  if (r.rows.length === 0) return null;
  return getJobProgress(String(r.rows[0]!.id), userId);
}

async function createJob(kind: JobKind, total: number, userId: string): Promise<string> {
  const id = crypto.randomUUID();
  await db.execute({
    sql: `INSERT INTO job_progress (id, user_id, kind, total, completed, started_at)
          VALUES (?, ?, ?, ?, 0, ?)`,
    args: [id, userId, kind, total, Date.now()],
  });
  return id;
}

async function bumpCompleted(jobId: string, n = 1): Promise<void> {
  await db.execute({
    sql: `UPDATE job_progress SET completed = completed + ? WHERE id = ?`,
    args: [n, jobId],
  });
}

async function finishJob(jobId: string, error?: string): Promise<void> {
  await db.execute({
    sql: `UPDATE job_progress SET completed_at = ?, error = ? WHERE id = ?`,
    args: [Date.now(), error ?? null, jobId],
  });
}

export interface JobStartResult {
  jobId: string;
  total: number;
  alreadyRunning?: boolean;
}

/**
 * Walks every item and re-tags entities/primary_subject/beat_tag via the
 * LLM extractor. Same logic as scripts/reextract-entities.ts but driven
 * from the UI with a job_progress row backing the toast progress bar.
 */
export async function runReextractEntitiesJob(userId: string): Promise<JobStartResult> {
  await ensureSchema();
  const running = await getRunningJob("reextract-entities", userId);
  if (running) return { jobId: running.id, total: running.total, alreadyRunning: true };

  const r = await db.execute({
    sql: `SELECT id, title, lede, content_hash FROM items
          WHERE user_id = ? ORDER BY published_at ASC`,
    args: [userId],
  });
  const total = r.rows.length;
  const jobId = await createJob("reextract-entities", total, userId);

  // Snapshot the rows so the worker doesn't keep the cursor open.
  const items = r.rows.map((row) => ({
    id: String(row.id),
    title: String(row.title ?? ""),
    lede: String(row.lede ?? ""),
    contentHash: String(row.content_hash ?? ""),
  }));

  after(() => runReextractInBackground(jobId, items, userId));
  return { jobId, total };
}

async function runReextractInBackground(
  jobId: string,
  items: { id: string; title: string; lede: string; contentHash: string }[],
  userId: string,
): Promise<void> {
  try {
    const queue = items.slice();
    const inflight = new Set<Promise<void>>();
    const work = async (it: (typeof items)[number]): Promise<void> => {
      const extracted = await extractItemEntities({
        userId,
        title: it.title,
        lede: it.lede,
        contentHash: it.contentHash,
      });
      await db.execute({
        sql: `UPDATE items SET entities = ?, primary_subject = ?, beat_tag = ? WHERE id = ?`,
        args: [
          JSON.stringify(extracted.entities),
          extracted.primarySubject,
          extracted.beatTag,
          it.id,
        ],
      });
      await bumpCompleted(jobId, 1);
    };
    while (queue.length > 0 || inflight.size > 0) {
      while (inflight.size < REEXTRACT_CONCURRENCY && queue.length > 0) {
        const it = queue.shift()!;
        const p = work(it).finally(() => inflight.delete(p));
        inflight.add(p);
      }
      if (inflight.size > 0) await Promise.race(inflight);
    }
    await finishJob(jobId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await finishJob(jobId, msg);
  }
}

/**
 * Wipes existing clusters (preserves items) and re-runs the cluster
 * engine over every item in chronological order. Same logic as
 * scripts/recluster.ts. Use after a re-extract pass to take advantage
 * of fresh entity tags.
 */
export async function runReclusterJob(userId: string): Promise<JobStartResult> {
  await ensureSchema();
  const running = await getRunningJob("recluster", userId);
  if (running) return { jobId: running.id, total: running.total, alreadyRunning: true };

  const drafts = await db.execute({
    sql: `SELECT COUNT(*) AS n FROM drafts WHERE user_id = ?`,
    args: [userId],
  });
  const draftCount = Number(drafts.rows[0]!.n ?? 0);
  if (draftCount > 0) {
    throw new Error(
      `Rebuild clusters is disabled because ${draftCount} ${
        draftCount === 1 ? "existing draft references" : "existing drafts reference"
      } current clusters. Rebuilding would detach draft receipts from their source stories.`,
    );
  }

  // Wipe before counting items so the worker sees a clean state.
  await db.execute({
    sql: `UPDATE items SET cluster_id = NULL WHERE user_id = ?`,
    args: [userId],
  });
  await db.execute({
    sql: `DELETE FROM clusters WHERE user_id = ?`,
    args: [userId],
  });

  const r = await db.execute({
    sql: `SELECT id, source_id, canonical_url, content_hash FROM items
          WHERE user_id = ? ORDER BY published_at ASC`,
    args: [userId],
  });
  const total = r.rows.length;
  const jobId = await createJob("recluster", total, userId);

  const items = r.rows.map((row) => ({
    id: String(row.id),
    sourceId: String(row.source_id),
    canonicalUrl: String(row.canonical_url),
    contentHash: String(row.content_hash),
  }));

  after(() => runReclusterInBackground(jobId, items, userId));
  return { jobId, total };
}

async function runReclusterInBackground(
  jobId: string,
  items: { id: string; sourceId: string; canonicalUrl: string; contentHash: string }[],
  userId: string,
): Promise<void> {
  try {
    // Sequential. Layer 2 needs to see prior items in the window before
    // it can merge new ones, and Layer 3 (LLM oracle) calls are bounded
    // per ingest; sequential keeps both honest. Local Claude can absorb
    // the throughput without flooding.
    for (const it of items) {
      await handleItemIngested(
        {
          itemId: it.id,
          sourceId: it.sourceId,
          canonicalUrl: it.canonicalUrl,
          contentHash: it.contentHash,
        },
        { userId, traceId: crypto.randomUUID() },
      );
      await bumpCompleted(jobId, 1);
    }
    await finishJob(jobId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await finishJob(jobId, msg);
  }
}
