import "server-only";

import { db, ensureSchema } from "../db";
import { getBus } from "./event-bus";
import type { ClusterFormedPayload, SourceAddedPayload, WordPressPushedPayload } from "./types";

export interface ReadingToWritingMetrics {
  sourcesAdded: number;
  clustersCreated: number;
  clustersSurfaced: number;
  draftsRendered: number;
  wordpressPushes: number;
}

interface MetricsScope {
  userId?: string;
  sinceMs?: number;
}

export async function loadReadingToWritingMetrics(
  scope: MetricsScope = {},
): Promise<ReadingToWritingMetrics> {
  await ensureSchema();

  const wheres: string[] = [];
  const args: (string | number)[] = [];
  if (scope.userId) {
    wheres.push("user_id = ?");
    args.push(scope.userId);
  }
  if (scope.sinceMs !== undefined) {
    wheres.push("occurred_at >= ?");
    args.push(scope.sinceMs);
  }
  const whereSql = wheres.length > 0 ? `WHERE ${wheres.join(" AND ")}` : "";

  const result = await db.execute({
    sql: `SELECT
            COUNT(DISTINCT CASE WHEN type = 'source.added' THEN idempotency_key END) AS sources_added,
            COUNT(DISTINCT CASE WHEN type = 'cluster.formed' THEN idempotency_key END) AS clusters_created,
            COUNT(DISTINCT CASE WHEN type = 'cluster.threshold_crossed' THEN idempotency_key END) AS clusters_surfaced,
            COUNT(DISTINCT CASE WHEN type = 'draft.rendered' THEN idempotency_key END) AS drafts_rendered,
            COUNT(DISTINCT CASE WHEN type = 'wordpress.pushed' THEN idempotency_key END) AS wordpress_pushes
          FROM event_log
          ${whereSql}`,
    args,
  });

  const row = result.rows[0] ?? {};
  return {
    sourcesAdded: Number(row.sources_added ?? 0),
    clustersCreated: Number(row.clusters_created ?? 0),
    clustersSurfaced: Number(row.clusters_surfaced ?? 0),
    draftsRendered: Number(row.drafts_rendered ?? 0),
    wordpressPushes: Number(row.wordpress_pushes ?? 0),
  };
}

export async function recordSourceAdded(
  payload: SourceAddedPayload,
  opts: { userId: string; traceId?: string | null },
): Promise<void> {
  await recordEvent("source.added", payload, {
    userId: opts.userId,
    traceId: opts.traceId ?? null,
    idempotencyKey: `source.added:${payload.sourceId}`,
  });
}

export async function recordClusterFormed(
  payload: ClusterFormedPayload,
  opts: { userId: string; traceId?: string | null },
): Promise<void> {
  await recordEvent("cluster.formed", payload, {
    userId: opts.userId,
    traceId: opts.traceId ?? null,
    idempotencyKey: `cluster.formed:${payload.clusterId}`,
  });
}

export async function recordWordPressPushed(
  payload: WordPressPushedPayload,
  opts: { userId: string; traceId?: string | null },
): Promise<void> {
  await recordEvent("wordpress.pushed", payload, {
    userId: opts.userId,
    traceId: opts.traceId ?? null,
    idempotencyKey: `wordpress.pushed:${payload.draftId}:${payload.wpPostId}`,
  });
}

async function recordEvent<T>(
  type: "source.added" | "cluster.formed" | "wordpress.pushed",
  payload: T,
  opts: { userId: string; traceId: string | null; idempotencyKey: string },
): Promise<void> {
  try {
    await getBus().emit(type, payload, opts);
  } catch (err) {
    console.warn(`[analytics] failed to record ${type}`, err);
  }
}
