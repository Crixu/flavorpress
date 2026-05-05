/**
 * Personal ranker.
 *
 * 3-signal heuristic per engineer review (was 5-signal in the spec).
 * Voice fit and gap fill arrive in v1.1 once we have data to tune them.
 *
 *   archive_overlap (0.55): fraction of cluster items whose
 *     primary_subject appears in the user's drafted-cluster subjects
 *     (the things they have actually published). Falls back to
 *     signature_terms overlap if there are no drafts yet.
 *   beat_match (0.30): fraction of cluster items whose beat_tag is
 *     among the user's top-10 most-frequent beat_tags across their
 *     library. Measures "this is a lane you actively read in".
 *   source_trust (0.15): mean of source.trust_score across cluster
 *     members.
 *
 * Per-cluster down-weights (signal.downweighted events) persist in
 * ranker_corrections and are added to the composite at scoring time.
 *
 * Both archive_overlap and beat_match read from items.primary_subject
 * and items.beat_tag respectively, populated by the LLM-at-ingest
 * extractor (entity-extractor.ts). Items that haven't been re-extracted
 * yet contribute nothing here, which is the right failure mode: better
 * to score 0 than to fabricate signal from regex tags.
 */

import { db, ensureSchema } from "../db";
import type { Cluster, RankerSignals } from "./types";
import { RANKER_WEIGHTS } from "./types";
import { CLUSTER_WINDOW_MS } from "./cluster-engine";

export async function rankCluster(cluster: Cluster, userId: string): Promise<RankerSignals> {
  await ensureSchema();

  // Pull cluster items + their source trust scores + LLM-extracted tags.
  const r = await db.execute({
    sql: `SELECT i.id, i.entities, i.primary_subject, i.beat_tag,
                 s.trust_score as source_trust_score
          FROM items i
          JOIN sources s ON s.id = i.source_id
          WHERE i.cluster_id = ?`,
    args: [cluster.id],
  });
  if (r.rows.length === 0) {
    return zeroSignals(cluster.id, userId);
  }

  const trustScores = r.rows.map((row) => Number(row.source_trust_score ?? 0.5));
  const itemSubjects = r.rows
    .map((row) => (row.primary_subject ? String(row.primary_subject).toLowerCase() : null))
    .filter((s): s is string => s !== null);
  const itemBeats = r.rows
    .map((row) => (row.beat_tag ? String(row.beat_tag).toLowerCase() : null))
    .filter((s): s is string => s !== null);
  const itemEntities: string[] = [];
  for (const row of r.rows) {
    if (!row.entities) continue;
    try {
      const ents = JSON.parse(String(row.entities)) as unknown[];
      for (const e of ents) {
        if (typeof e === "string") itemEntities.push(e.toLowerCase());
      }
    } catch {
      // Skip malformed entity blobs.
    }
  }
  const clusterEntities = Array.from(new Set(itemEntities));

  // archive_overlap: how often the cluster's primary subjects match
  // subjects the user has already drafted. Falls back to signature_terms
  // entity overlap when no drafts exist.
  const archiveOverlap = await computeArchiveOverlap(userId, itemSubjects, clusterEntities);

  // beat_match: how well the cluster's beat tags align with the user's
  // most-frequent reading lanes across their library.
  const beatMatch = await computeBeatMatch(userId, cluster.id, itemBeats);

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

// Window for "user's reading lanes" computation. 60 days of items gives
// enough density to pick stable beat preferences without letting one
// burst week dominate forever.
const BEAT_WINDOW_MS = 60 * 24 * 60 * 60 * 1000;

async function computeArchiveOverlap(
  userId: string,
  itemSubjects: string[],
  clusterEntities: string[],
): Promise<number> {
  // Primary path: have any drafts? Use the primary_subjects of items in
  // clusters the user has drafted. That measures "subjects the user
  // actually publishes about", not just "subjects in their library".
  const draftedR = await db.execute({
    sql: `SELECT i.primary_subject, COUNT(*) AS n
          FROM drafts d
          JOIN items i ON i.cluster_id = d.cluster_id
          WHERE d.user_id = ? AND i.primary_subject IS NOT NULL
          GROUP BY i.primary_subject
          ORDER BY n DESC LIMIT 16`,
    args: [userId],
  });
  const draftedSubjects = new Set(
    draftedR.rows.map((row) => String(row.primary_subject).toLowerCase()),
  );

  if (draftedSubjects.size > 0 && itemSubjects.length > 0) {
    const hits = itemSubjects.filter((s) => draftedSubjects.has(s)).length;
    return hits / itemSubjects.length;
  }

  // Fallback: signature_terms entity overlap. Same shape as before,
  // kept as a soft signal until the user has drafted something.
  const vp = await db.execute({
    sql: `SELECT signature_terms FROM voice_profiles WHERE user_id = ? LIMIT 1`,
    args: [userId],
  });
  if (vp.rows.length === 0 || clusterEntities.length === 0) return 0;
  let signatureTerms: string[] = [];
  try {
    const parsed = JSON.parse(String(vp.rows[0]!.signature_terms ?? "[]")) as unknown;
    if (Array.isArray(parsed)) {
      signatureTerms = parsed.filter((s): s is string => typeof s === "string");
    }
  } catch {
    return 0;
  }
  if (signatureTerms.length === 0) return 0;
  const sigSet = new Set(signatureTerms.map((s) => s.toLowerCase()));
  return clusterEntities.filter((e) => containsAny(e, sigSet)).length / clusterEntities.length;
}

async function computeBeatMatch(
  userId: string,
  clusterId: string,
  itemBeats: string[],
): Promise<number> {
  if (itemBeats.length === 0) return 0;
  // The user's top reading lanes by beat_tag frequency in the recent
  // window. Anchored on published_at so a backfill doesn't reshape the
  // user's preferences with months-old material. Exclude the cluster
  // currently being ranked so a new one-off beat cannot vote itself
  // into the user's top lanes.
  const cutoff = Date.now() - BEAT_WINDOW_MS;
  const r = await db.execute({
    sql: `SELECT beat_tag, COUNT(*) AS n
          FROM items
          WHERE user_id = ? AND beat_tag IS NOT NULL AND published_at >= ?
            AND (cluster_id IS NULL OR cluster_id != ?)
          GROUP BY beat_tag
          ORDER BY n DESC LIMIT 10`,
    args: [userId, cutoff, clusterId],
  });
  if (r.rows.length === 0) return 0;
  const userBeats = new Set(r.rows.map((row) => String(row.beat_tag).toLowerCase()));
  const hits = itemBeats.filter((b) => userBeats.has(b)).length;
  return hits / itemBeats.length;
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

export async function loadSignatureTermsByOutlet(
  outletIds: string[],
  userId: string,
): Promise<Map<string, Set<string>>> {
  const out = new Map<string, Set<string>>();
  if (outletIds.length === 0) return out;
  const placeholders = outletIds.map(() => "?").join(",");
  const r = await db.execute({
    sql: `SELECT outlet_id, signature_terms FROM voice_profiles
          WHERE user_id = ? AND outlet_id IN (${placeholders})`,
    args: [userId, ...outletIds],
  });
  for (const row of r.rows) {
    const terms = JSON.parse(String(row.signature_terms ?? "[]")) as string[];
    out.set(String(row.outlet_id), new Set(terms.map((t) => t.toLowerCase())));
  }
  return out;
}

const PREFERRED_OUTLET_TIE_EPSILON = 0.05;

export function pickPreferredOutletForCluster(
  clusterEntities: string[],
  outletIds: string[],
  signatureTermsByOutlet: Map<string, Set<string>>,
): string | null {
  if (outletIds.length < 2 || clusterEntities.length === 0) return null;
  const lowered = clusterEntities.map((e) => e.toLowerCase());
  const scored = outletIds.map((outletId) => {
    const sig = signatureTermsByOutlet.get(outletId);
    if (!sig || sig.size === 0) return { outletId, score: 0 };
    const hits = lowered.filter((e) => containsAny(e, sig)).length;
    return { outletId, score: hits / lowered.length };
  });
  scored.sort((a, b) => b.score - a.score);
  const top = scored[0]!;
  const second = scored[1]!;
  // Defer to caller default when no outlet matches, or when the lead is
  // within noise of the runner-up; pre-selecting on a tie misleads.
  if (top.score <= 0) return null;
  if (top.score - second.score < PREFERRED_OUTLET_TIE_EPSILON) return null;
  return top.outletId;
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
