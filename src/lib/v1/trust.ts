/**
 * Behavior-driven source trust adjustments.
 *
 * Trust is one of three signals in the cluster ranker (sourceTrust at 15%
 * weight, see ranker.ts). The other 85% is personalization. So trust does
 * not need to swing fast; small per-event deltas accumulate into a stable
 * preference signal over many drafts.
 *
 * Sign and size:
 *   draftCreated     +0.02  this cluster turned into a draft attempt
 *   draftPublished   +0.03  the draft shipped to WordPress
 *   draftDeleted     -0.02  unsent draft removed; cluster did not pan out
 *   clusterDismissed -0.01  user skipped the cluster without drafting
 *
 * One create+publish cycle nets +0.05 per source (half a manual ±0.1 click).
 * Create+delete nets 0. Pure dismiss nets -0.01. All deltas clamp to [0, 1].
 */

import { db, ensureSchema } from "../db";

export const TRUST_DELTA = {
  draftCreated: 0.02,
  draftPublished: 0.03,
  draftDeleted: -0.02,
  clusterDismissed: -0.01,
} as const;

/**
 * Bump trust for every distinct source that contributed an item to the
 * given cluster. No-ops on zero/non-finite delta or empty cluster. Single
 * UPDATE clamps to [0, 1] inline.
 */
export async function adjustClusterSourceTrust(
  clusterId: string,
  delta: number,
  userId: string,
): Promise<void> {
  if (!Number.isFinite(delta) || delta === 0) return;
  await ensureSchema();

  const r = await db.execute({
    sql: `SELECT DISTINCT source_id FROM items WHERE cluster_id = ?`,
    args: [clusterId],
  });
  const sourceIds = r.rows
    .map((row) => (row.source_id ? String(row.source_id) : null))
    .filter((id): id is string => id !== null);
  if (sourceIds.length === 0) return;

  const placeholders = sourceIds.map(() => "?").join(",");
  await db.execute({
    sql: `UPDATE sources
          SET trust_score = MAX(0.0, MIN(1.0, COALESCE(trust_score, 0.5) + ?))
          WHERE id IN (${placeholders}) AND user_id = ?`,
    args: [delta, ...sourceIds, userId],
  });
}
