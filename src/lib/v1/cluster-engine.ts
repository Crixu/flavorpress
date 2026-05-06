/**
 * Cluster engine.
 *
 * Three-layer pipeline. Runs on every `item.ingested` event. Layer 1 is
 * synchronous and cheap; Layer 3 is the expensive one and only runs when
 * the cheaper layers miss.
 *
 *   Layer 1 — canonical URL or DOI exact match. Latency under 50ms.
 *   Layer 2 — entity overlap + title trigram cosine inside 72h window. ~200ms.
 *   Layer 3 — sentence-embedding cosine on lede paragraphs. ~1500ms.
 *
 * Architect-recommended posture:
 *   - Global cluster centroids cached canonical-URL + content-hash keyed.
 *   - 72-hour rolling window per user.
 *   - Source diversity guard: 3 sources from 2+ distinct domains.
 *   - Confirmation delay: cluster waits 15 minutes after threshold cross
 *     to allow late-arriving duplicates to merge. (Implementation deferred
 *     to a scheduled job in v1.1; v1 fires immediately for demo speed.)
 *
 * Layer 3 embedding integration is deferred to a separate file because it
 * requires the OpenAI embedding client; this module ships layers 1 and 2
 * fully and stubs layer 3 behind a function that v1 can call when ready.
 */

import { db, ensureSchema } from "../db";
import { getBus } from "./event-bus";
import { traceLogger } from "./trace";
import type { ClusterThresholdCrossedPayload, ItemIngestedPayload, Item } from "./types";
import { rowToItem, type ItemRow } from "./source-connector";
import { askMergeOracle } from "./merge-oracle";

export const CLUSTER_WINDOW_MS = 72 * 60 * 60 * 1000;

// Trust-weighted fire threshold. For multi-source clusters (2+ distinct
// domains), the cluster fires when the SUM of distinct source trust scores
// reaches this value. Default new-source trust is 0.5, so two fresh feeds
// covering the same story add to 1.0 and fire.
//
// Single-source clusters (sourceCount === 1) bypass this guard entirely and
// fire immediately: they represent an item the user explicitly saved (marked
// as follow-up) and show on Today as a draftable card without waiting for
// corroboration. WPDS redesign, Task 0.4 (2026-05-06).
const CLUSTER_TRUST_FIRE_SUM = 1.0;

const TRIGRAM_THRESHOLD = 0.4; // lowered from 0.6; real news rewrites diverge
// more than the strict threshold tolerated
const ENTITY_OVERLAP_THRESHOLD = 2; // of top 5; lowered from 3 for the same
// reason. The 2+ distinct-domain guard
// keeps the cluster fire bar honest.

// Layer 3 (LLM merge oracle) ambiguity zone. A pair that misses Layer 2
// but lands here is suspicious enough to ask Claude. Below this band the
// pair is too dissimilar to be worth a model call; above it, Layer 2
// should have already merged them.
const LAYER3_TRIGRAM_FLOOR = 0.22;
const LAYER3_TRIGRAM_CEILING = TRIGRAM_THRESHOLD;
const LAYER3_ENTITY_FLOOR = 1; // at least one shared entity
// Cap on how many candidates we hand to the oracle per ingest. Keeps
// cost predictable; if Layer 2 was supposed to have caught it, more than
// 4 reaches into the oracle would mean the thresholds are wrong, not
// that we should pay for 30 LLM calls.
const LAYER3_MAX_CANDIDATES = 4;

export async function handleItemIngested(
  payload: ItemIngestedPayload,
  opts: { traceId?: string; userId?: string } = {},
): Promise<{ clusterId: string | null; layer: 1 | 2 | 3 | null }> {
  await ensureSchema();
  const log = traceLogger(opts.traceId ?? payload.itemId, opts.userId ?? null);

  const itemRow = await db.execute({
    sql: `SELECT * FROM items WHERE id = ?`,
    args: [payload.itemId],
  });
  if (itemRow.rows.length === 0) {
    await log.warn("cluster.engine", "item not found", { itemId: payload.itemId });
    return { clusterId: null, layer: null };
  }
  const item = rowToItem(itemRow.rows[0] as unknown as ItemRow);

  // Window: items for this user within ±72h of this item's publish date.
  // Anchored on published_at (not fetched_at) so a backfill that ingests
  // months-old items doesn't merge them into clusters with today's news
  // just because they share an ingest timestamp.
  const minMs = item.publishedAt - CLUSTER_WINDOW_MS;
  const maxMs = item.publishedAt + CLUSTER_WINDOW_MS;
  const windowR = await db.execute({
    sql: `SELECT * FROM items
          WHERE user_id = ? AND published_at >= ? AND published_at <= ? AND id != ?`,
    args: [item.userId, minMs, maxMs, item.id],
  });
  const windowItems = windowR.rows.map((r) => rowToItem(r as unknown as ItemRow));

  // Layer 1: exact canonical URL match
  for (const w of windowItems) {
    if (w.canonicalUrl === item.canonicalUrl && w.clusterId) {
      await assignToCluster(item.id, w.clusterId);
      // Union the new item's entities into the cluster's primary_entities
      // so the tag set stays current. Without this, primary_entities is
      // frozen at formation and topic search / ranker see stale tags
      // when later items name things the original lead didn't.
      const incomingEntities = item.entities ?? extractEntities(item.title, item.lede);
      await unionClusterEntities(w.clusterId, incomingEntities);
      await log.info("cluster.engine.layer1", "exact-url match", {
        clusterId: w.clusterId,
      });
      await maybeFireCluster(w.clusterId, item.userId, opts.traceId);
      return { clusterId: w.clusterId, layer: 1 };
    }
  }

  // Layer 2: entity overlap + title trigram cosine
  const itemEntities = item.entities ?? extractEntities(item.title, item.lede);
  const itemTrigrams = trigrams(item.title);

  for (const w of windowItems) {
    const wEntities = w.entities ?? extractEntities(w.title, w.lede);
    const overlap = countOverlap(itemEntities, wEntities);
    if (overlap < ENTITY_OVERLAP_THRESHOLD) continue;
    const cosine = trigramCosine(itemTrigrams, trigrams(w.title));
    if (cosine < TRIGRAM_THRESHOLD) continue;

    let clusterId = w.clusterId;
    if (!clusterId) {
      // Form a new cluster around w + item. Seed primary_entities with
      // the union of both items so the tag set starts complete.
      const seedEntities = Array.from(new Set([...itemEntities, ...wEntities]));
      clusterId = await formCluster(w.userId, [w.id], seedEntities);
      await assignToCluster(w.id, clusterId);
    } else {
      await unionClusterEntities(clusterId, itemEntities);
    }
    await assignToCluster(item.id, clusterId);
    await log.info("cluster.engine.layer2", "entity+trigram match", {
      clusterId,
      overlap,
      cosine,
    });
    await maybeFireCluster(clusterId, item.userId, opts.traceId);
    return { clusterId, layer: 2 };
  }

  // Layer 3: LLM merge oracle. For pairs that missed Layer 2 but land in
  // the ambiguous near-miss zone (>=1 shared entity, trigram cosine in
  // [LAYER3_TRIGRAM_FLOOR, LAYER3_TRIGRAM_CEILING)), ask Claude whether
  // the two items are the same story. Bounded by LAYER3_MAX_CANDIDATES
  // and cached per content_hash pair so re-runs are free.
  //
  // Sentence-embedding clustering is the next-tier upgrade beyond this;
  // until then, the oracle handles the orphan-merging gap.
  const candidates: Array<{ item: Item; score: number }> = [];
  for (const w of windowItems) {
    const wEntities = w.entities ?? extractEntities(w.title, w.lede);
    const overlap = countOverlap(itemEntities, wEntities);
    if (overlap < LAYER3_ENTITY_FLOOR) continue;
    const cosine = trigramCosine(itemTrigrams, trigrams(w.title));
    if (cosine < LAYER3_TRIGRAM_FLOOR || cosine >= LAYER3_TRIGRAM_CEILING) continue;
    candidates.push({ item: w, score: overlap + cosine });
  }
  candidates.sort((a, b) => b.score - a.score);
  const shortlist = candidates.slice(0, LAYER3_MAX_CANDIDATES);

  for (const c of shortlist) {
    const w = c.item;
    const verdict = await askMergeOracle({
      aHash: item.contentHash,
      aTitle: item.title,
      aLede: item.lede,
      bHash: w.contentHash,
      bTitle: w.title,
      bLede: w.lede,
    });
    if (!verdict || !verdict.sameStory) continue;

    const wEntities = w.entities ?? extractEntities(w.title, w.lede);
    let clusterId = w.clusterId;
    if (!clusterId) {
      const seedEntities = Array.from(new Set([...itemEntities, ...wEntities]));
      clusterId = await formCluster(w.userId, [w.id], seedEntities);
      await assignToCluster(w.id, clusterId);
    } else {
      await unionClusterEntities(clusterId, itemEntities);
    }
    await assignToCluster(item.id, clusterId);
    await log.info("cluster.engine.layer3", "oracle merge", {
      clusterId,
      reason: verdict.reason,
      source: verdict.source,
    });
    await maybeFireCluster(clusterId, item.userId, opts.traceId);
    return { clusterId, layer: 3 };
  }

  await log.info("cluster.engine.layer3", "no merge", {
    candidates: shortlist.length,
  });
  return { clusterId: null, layer: null };
}

async function assignToCluster(itemId: string, clusterId: string): Promise<void> {
  await db.execute({
    sql: `UPDATE items SET cluster_id = ? WHERE id = ?`,
    args: [clusterId, itemId],
  });
  await db.execute({
    sql: `UPDATE clusters SET source_count = (
            SELECT COUNT(DISTINCT source_id) FROM items WHERE cluster_id = ?
          ) WHERE id = ?`,
    args: [clusterId, clusterId],
  });
}

async function unionClusterEntities(clusterId: string, incoming: string[]): Promise<void> {
  if (incoming.length === 0) return;
  const r = await db.execute({
    sql: `SELECT primary_entities FROM clusters WHERE id = ?`,
    args: [clusterId],
  });
  if (r.rows.length === 0) return;
  const existing = r.rows[0]!.primary_entities
    ? (JSON.parse(String(r.rows[0]!.primary_entities)) as unknown[]).filter(
        (e): e is string => typeof e === "string",
      )
    : [];
  const merged = Array.from(new Set([...existing, ...incoming]));
  if (merged.length === existing.length) return;
  await db.execute({
    sql: `UPDATE clusters SET primary_entities = ? WHERE id = ?`,
    args: [JSON.stringify(merged), clusterId],
  });
}

async function formCluster(
  userId: string,
  initialItemIds: string[],
  entities: string[],
): Promise<string> {
  const id = crypto.randomUUID();
  await db.execute({
    sql: `INSERT INTO clusters
          (id, user_id, primary_entities, formed_at, source_count, state)
          VALUES (?, ?, ?, ?, 0, 'forming')`,
    args: [id, userId, JSON.stringify(entities), Date.now()],
  });
  // Caller assigns items via assignToCluster.
  void initialItemIds;
  return id;
}

async function maybeFireCluster(
  clusterId: string,
  userId: string,
  traceId?: string,
): Promise<void> {
  const r = await db.execute({
    sql: `SELECT c.id, c.state, c.source_count, c.primary_entities,
                 (SELECT COUNT(DISTINCT s.url) FROM items i
                  JOIN sources s ON s.id = i.source_id
                  WHERE i.cluster_id = c.id) AS distinct_domains,
                 (SELECT COALESCE(SUM(s.trust_score), 0) FROM (
                    SELECT DISTINCT i.source_id FROM items i
                    WHERE i.cluster_id = c.id
                  ) ds JOIN sources s ON s.id = ds.source_id) AS trust_sum
          FROM clusters c WHERE c.id = ?`,
    args: [clusterId],
  });
  if (r.rows.length === 0) return;
  const row = r.rows[0]!;
  const sourceCount = Number(row.source_count);
  const distinctDomains = Number(row.distinct_domains);
  const trustSum = Number(row.trust_sum);
  const singleSource = sourceCount === 1;
  const multiSourceReady = !singleSource && trustSum >= CLUSTER_TRUST_FIRE_SUM && distinctDomains >= 2;
  if (row.state === "forming" && (singleSource || multiSourceReady)) {
    await db.execute({
      sql: `UPDATE clusters SET state = 'fired', fired_at = ? WHERE id = ?`,
      args: [Date.now(), clusterId],
    });
    const entities = row.primary_entities
      ? (JSON.parse(String(row.primary_entities)) as string[])
      : [];
    await getBus().emit<ClusterThresholdCrossedPayload>(
      "cluster.threshold_crossed",
      {
        clusterId,
        sourceCount,
        primaryEntities: entities,
      },
      {
        userId,
        traceId,
        idempotencyKey: `cluster.fired:${clusterId}`,
      },
    );
  }
}

// Sentence-leading capitalizations and frequent function words that the
// naive regex misclassifies as entities. Filtering them removes "The",
// "While", "According" from the top-5 entity slot, which was breaking
// Layer 2 overlap matching.
const ENTITY_STOPWORDS = new Set([
  "The",
  "A",
  "An",
  "This",
  "That",
  "These",
  "Those",
  "It",
  "Its",
  "He",
  "She",
  "They",
  "We",
  "You",
  "I",
  "While",
  "When",
  "Where",
  "What",
  "Why",
  "How",
  "Who",
  "Which",
  "And",
  "But",
  "Or",
  "So",
  "Yet",
  "Nor",
  "If",
  "Then",
  "According",
  "Despite",
  "However",
  "Although",
  "Because",
  "Since",
  "After",
  "Before",
  "During",
  "Until",
  "Through",
  "Today",
  "Yesterday",
  "Tomorrow",
  "Now",
  "Later",
  "Soon",
  "First",
  "Second",
  "Third",
  "Last",
  "Next",
  "New",
  "Old",
  "Many",
  "Some",
  "Most",
  "All",
  "Any",
  "Each",
  "Apple", // generic; appears in nearly every Apple-news lede so it
  // dominates entity sets. Re-allow if/when we move to real NER.
]);

/**
 * Naive entity extraction. Capitalized noun phrases of 1-3 tokens.
 * Replace with a real NER pass in v1.1; this gets us to acceptable
 * Layer 2 precision against typical news/blog content.
 */
export function extractEntities(title: string, lede: string): string[] {
  const text = `${title}. ${lede}`;
  const matches = text.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2}\b/g) ?? [];
  // Top 5 by frequency, after filtering stopwords (single-token only —
  // multi-token phrases like "Tim Cook" or "John Ternus" stay even if
  // their first token would otherwise be a stopword).
  const counts = new Map<string, number>();
  for (const m of matches) {
    const isSingleToken = !m.includes(" ");
    if (isSingleToken && ENTITY_STOPWORDS.has(m)) continue;
    counts.set(m, (counts.get(m) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([k]) => k);
}

function countOverlap(a: string[], b: string[]): number {
  const set = new Set(b.map((s) => s.toLowerCase()));
  let n = 0;
  for (const x of a) if (set.has(x.toLowerCase())) n++;
  return n;
}

function trigrams(s: string): Map<string, number> {
  const m = new Map<string, number>();
  const t = s.toLowerCase().replace(/[^a-z0-9 ]/g, "");
  for (let i = 0; i <= t.length - 3; i++) {
    const tri = t.slice(i, i + 3);
    if (tri.length === 3) m.set(tri, (m.get(tri) ?? 0) + 1);
  }
  return m;
}

function trigramCosine(a: Map<string, number>, b: Map<string, number>): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (const [_, v] of a) na += v * v;
  for (const [_, v] of b) nb += v * v;
  for (const [k, v] of a) {
    const w = b.get(k);
    if (w !== undefined) dot += v * w;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/**
 * Fetch items for a cluster. Used by the draft generator to assemble the
 * source bundle.
 */
export async function getClusterItems(clusterId: string): Promise<Item[]> {
  await ensureSchema();
  const r = await db.execute({
    sql: `SELECT * FROM items WHERE cluster_id = ? ORDER BY published_at ASC`,
    args: [clusterId],
  });
  return r.rows.map((row) => rowToItem(row as unknown as ItemRow));
}
