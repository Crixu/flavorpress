/**
 * Personal ranker.
 *
 * 3-signal heuristic per engineer review (was 5-signal in the spec).
 * Voice fit and gap fill arrive in v1.1 once we have data to tune them.
 *
 *   archive_overlap (0.55): cosine of cluster centroid against the user's
 *     archive index centroid. Heuristic v1: fraction of cluster entities
 *     that appear in the user's signature_terms list, scaled.
 *   beat_match (0.30): fraction of cluster entities that appear in the
 *     user's top-50 archive entities.
 *   source_trust (0.15): mean of source.trust_score across cluster members.
 *
 * Per-cluster down-weights (signal.downweighted events) persist in
 * ranker_corrections and are added to the composite at scoring time.
 */

import { db, ensureSchema } from "../db";
import type { Cluster, RankerSignals } from "./types";
import { RANKER_WEIGHTS } from "./types";
import { rowToItem, type ItemRow } from "./source-connector";
import { CLUSTER_WINDOW_MS } from "./cluster-engine";

export async function rankCluster(cluster: Cluster, userId: string): Promise<RankerSignals> {
  await ensureSchema();

  // Pull cluster items + their source trust scores.
  const r = await db.execute({
    sql: `SELECT i.*, s.trust_score as source_trust_score
          FROM items i
          JOIN sources s ON s.id = i.source_id
          WHERE i.cluster_id = ?`,
    args: [cluster.id],
  });
  if (r.rows.length === 0) {
    return zeroSignals(cluster.id, userId);
  }

  const items = r.rows.map((row) => rowToItem(row as unknown as ItemRow));
  const trustScores = r.rows.map((row) => Number(row.source_trust_score ?? 0.5));

  // Cluster entities (union of per-item entities, top 10).
  const entityCounts = new Map<string, number>();
  for (const item of items) {
    for (const e of item.entities ?? []) {
      entityCounts.set(e.toLowerCase(), (entityCounts.get(e.toLowerCase()) ?? 0) + 1);
    }
  }
  const clusterEntities = Array.from(entityCounts.keys());

  // Voice profile: signature_terms gives us the user's interest fingerprint.
  const vp = await db.execute({
    sql: `SELECT signature_terms FROM voice_profiles WHERE user_id = ?`,
    args: [userId],
  });
  const signatureTerms: string[] = vp.rows.length
    ? (JSON.parse(String(vp.rows[0]!.signature_terms ?? "[]")) as string[])
    : [];
  const sigSet = new Set(signatureTerms.map((s) => s.toLowerCase()));

  // archive_overlap: fraction of cluster entities in user's signature_terms.
  const archiveOverlap =
    clusterEntities.length > 0
      ? clusterEntities.filter((e) => containsAny(e, sigSet)).length / clusterEntities.length
      : 0;

  // beat_match: top-50 archive entities (from items the user authored).
  // For v1 we proxy with: the user's connected WP archive items in `items`
  // table, if any. If empty, fall back to signature_terms.
  const archiveR = await db.execute({
    sql: `SELECT entities FROM items WHERE user_id = ? AND source_id IS NULL LIMIT 200`,
    args: [userId],
  });
  // Note: archive items don't ride sources_id; if the import job stores them
  // with a synthetic source row, this query needs revisiting. For now, fall
  // back to signature_terms if archive query is empty.
  const archiveEntities = new Set<string>();
  for (const row of archiveR.rows) {
    const ents = row.entities ? (JSON.parse(String(row.entities)) as string[]) : [];
    for (const e of ents) archiveEntities.add(e.toLowerCase());
  }
  const beatPool = archiveEntities.size > 0 ? archiveEntities : sigSet;
  const beatMatch =
    clusterEntities.length > 0
      ? clusterEntities.filter((e) => beatPool.has(e)).length / clusterEntities.length
      : 0;

  // source_trust: mean across cluster items.
  const sourceTrust =
    trustScores.length > 0 ? trustScores.reduce((a, b) => a + b, 0) / trustScores.length : 0.5;

  // Apply ranker_corrections that match this cluster pattern.
  const correctionDelta = await accumulateCorrections(userId, clusterEntities);

  const composite = clamp(
    RANKER_WEIGHTS.archiveOverlap * archiveOverlap +
      RANKER_WEIGHTS.beatMatch * beatMatch +
      RANKER_WEIGHTS.sourceTrust * sourceTrust +
      correctionDelta,
    0,
    1,
  );

  const signals: RankerSignals = {
    clusterId: cluster.id,
    userId,
    archiveOverlap,
    beatMatch,
    sourceTrust,
    composite,
    computedAt: Date.now(),
  };

  await db.execute({
    sql: `INSERT OR REPLACE INTO ranker_signals
          (cluster_id, user_id, archive_overlap, beat_match, source_trust, composite, computed_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: [
      signals.clusterId,
      signals.userId,
      signals.archiveOverlap,
      signals.beatMatch,
      signals.sourceTrust,
      signals.composite,
      signals.computedAt,
    ],
  });

  await db.execute({
    sql: `UPDATE clusters SET ranker_score = ? WHERE id = ?`,
    args: [signals.composite, cluster.id],
  });

  return signals;
}

/**
 * Top-N fired clusters for a user, ranker-ordered. Used by Today screen.
 * Pre-render top-5 (architect's call) so dismissal of #1 keeps things instant.
 *
 * `folderId` scopes the result to clusters whose items come from sources in
 * the given folder; pass "ungrouped" to mean folder_id IS NULL; pass null to
 * skip filtering.
 */
export async function topFiredClusters(
  userId: string,
  limit: number,
  folderId: string | null = null,
): Promise<Array<Cluster & { signals: RankerSignals | null; latestPublishedAt: number }>> {
  await ensureSchema();
  const folderClause =
    folderId === null
      ? ""
      : folderId === "ungrouped"
        ? `AND EXISTS (
             SELECT 1 FROM items i JOIN sources s ON s.id = i.source_id
             WHERE i.cluster_id = c.id AND s.folder_id IS NULL
           )`
        : `AND EXISTS (
             SELECT 1 FROM items i JOIN sources s ON s.id = i.source_id
             WHERE i.cluster_id = c.id AND s.folder_id = ?
           )`;
  // Drop clusters whose freshest item is older than the cluster window.
  // A cluster firing today on months-old items isn't "today's news"; it
  // shouldn't surface on Today.
  const freshnessCutoff = Date.now() - CLUSTER_WINDOW_MS;
  const args: (string | number)[] = [userId, freshnessCutoff];
  if (folderId !== null && folderId !== "ungrouped") args.push(folderId);
  args.push(limit);
  const r = await db.execute({
    sql: `SELECT c.*, rs.archive_overlap, rs.beat_match, rs.source_trust, rs.composite, rs.computed_at,
                 latest.latest_published_at
          FROM clusters c
          LEFT JOIN ranker_signals rs ON rs.cluster_id = c.id AND rs.user_id = c.user_id
          LEFT JOIN (
            SELECT cluster_id, MAX(published_at) AS latest_published_at
            FROM items WHERE cluster_id IS NOT NULL GROUP BY cluster_id
          ) latest ON latest.cluster_id = c.id
          WHERE c.user_id = ? AND c.state = 'fired'
            AND COALESCE(latest.latest_published_at, c.formed_at) >= ?
            ${folderClause}
          ORDER BY COALESCE(rs.composite, 0) DESC,
                   COALESCE(latest.latest_published_at, c.formed_at) DESC,
                   c.fired_at DESC
          LIMIT ?`,
    args,
  });
  return r.rows.map((row) => ({
    id: String(row.id),
    userId: String(row.user_id),
    centroid: null,
    embeddingModel: row.embedding_model ? String(row.embedding_model) : null,
    embeddingVersion: row.embedding_version ? String(row.embedding_version) : null,
    primaryEntities: row.primary_entities
      ? (JSON.parse(String(row.primary_entities)) as string[])
      : null,
    formedAt: Number(row.formed_at),
    firedAt: row.fired_at ? Number(row.fired_at) : null,
    sourceCount: Number(row.source_count),
    rankerScore: row.ranker_score ? Number(row.ranker_score) : null,
    capabilityVersionPin: row.capability_version_pin ? String(row.capability_version_pin) : null,
    state: String(row.state) as Cluster["state"],
    latestPublishedAt:
      row.latest_published_at !== null && row.latest_published_at !== undefined
        ? Number(row.latest_published_at)
        : Number(row.formed_at),
    signals:
      row.composite !== null && row.composite !== undefined
        ? {
            clusterId: String(row.id),
            userId: String(row.user_id),
            archiveOverlap: Number(row.archive_overlap),
            beatMatch: Number(row.beat_match),
            sourceTrust: Number(row.source_trust),
            composite: Number(row.composite),
            computedAt: Number(row.computed_at),
          }
        : null,
  }));
}

async function accumulateCorrections(userId: string, clusterEntities: string[]): Promise<number> {
  if (clusterEntities.length === 0) return 0;
  const r = await db.execute({
    sql: `SELECT cluster_pattern, weight_delta FROM ranker_corrections WHERE user_id = ?`,
    args: [userId],
  });
  let delta = 0;
  for (const row of r.rows) {
    const pattern = String(row.cluster_pattern).toLowerCase();
    const tokens = pattern.split(/\s*,\s*/);
    if (tokens.some((t) => clusterEntities.some((e) => e.includes(t)))) {
      delta += Number(row.weight_delta);
    }
  }
  // Clamp correction influence so a single down-weight doesn't bury a cluster.
  return Math.max(-0.4, Math.min(0.4, delta));
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function containsAny(text: string, set: Set<string>): boolean {
  for (const term of set) {
    if (text.includes(term)) return true;
  }
  return false;
}

function zeroSignals(clusterId: string, userId: string): RankerSignals {
  return {
    clusterId,
    userId,
    archiveOverlap: 0,
    beatMatch: 0,
    sourceTrust: 0,
    composite: 0,
    computedAt: Date.now(),
  };
}
