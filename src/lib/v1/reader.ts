/**
 * Reader mode: triage stories one swipe at a time, then turn the
 * marked pile into clusters.
 *
 * Mark = "great, follow up on this"; dismiss = "skip, never queue again".
 * Marked items accumulate in items.marked_at; once the pile crosses
 * READER_CLUSTER_THRESHOLD, the user (or the next mark) can form
 * clusters from the pile via clusterMarkedItems().
 *
 * Clustering is LLM-driven: Anthropic groups marked items by theme,
 * we persist each group as a cluster (state = 'fired'), assign items,
 * run the ranker so the cluster surfaces on Today, and clear marked_at
 * on the items that landed in a group.
 */

import Anthropic from "@anthropic-ai/sdk";
import { db, ensureSchema } from "../db";
import { getAnthropicApiKey, getAnthropicDraftModel } from "./settings";
import { rankCluster } from "./ranker";
import type { Cluster } from "./types";

export const READER_CLUSTER_THRESHOLD = 5;

const READER_QUEUE_LIMIT = 50;

export interface ReaderItem {
  id: string;
  title: string;
  lede: string;
  publishedAt: number;
  canonicalUrl: string;
  sourceId: string;
  sourceName: string;
  sourceKind: string;
  folderId: string | null;
  folderName: string | null;
  score: number | null;
  commentCount: number | null;
  /**
   * Display names of OTHER recent sources that have run an item sharing a
   * proper-noun phrase with this title. The current source is excluded.
   * Empty when this is a single-source story; used by the deck card to
   * render an "Also covered by …" line so the user has a multi-source
   * signal at swipe time.
   */
  alsoCoveredBy: string[];
}

export interface ReaderQueue {
  items: ReaderItem[];
  markedCount: number;
  thresholdReached: boolean;
}

/**
 * Items waiting in the deck. Excludes anything dismissed, marked, or
 * already in a cluster. Most-recent first; capped so the page doesn't
 * have to load thousands of rows up front.
 *
 * When folderId is provided, only items from sources in that folder are
 * returned; otherwise all foldered items are eligible. The marked count
 * stays global so the cluster threshold behaves the same regardless of
 * which folder the user is currently triaging.
 */
export async function loadReaderQueue(
  userId: string,
  folderId?: string | null,
): Promise<ReaderQueue> {
  await ensureSchema();
  const folderClause = folderId ? "AND s.folder_id = ?" : "";
  const args: (string | number)[] = folderId
    ? [userId, folderId, READER_QUEUE_LIMIT]
    : [userId, READER_QUEUE_LIMIT];
  const [r, markedR] = await db.batch(
    [
      {
        sql: `SELECT i.id, i.title, i.lede, i.published_at, i.canonical_url,
                     i.score, i.comment_count,
                     s.id AS source_id, s.display_name AS source_name, s.kind AS source_kind,
                     f.id AS folder_id, f.name AS folder_name
              FROM items i
              JOIN sources s ON s.id = i.source_id
              LEFT JOIN source_folders f ON f.id = s.folder_id
              WHERE i.user_id = ?
                AND i.cluster_id IS NULL
                AND i.marked_at IS NULL
                AND i.dismissed_at IS NULL
                AND s.folder_id IS NOT NULL
                ${folderClause}
              ORDER BY i.published_at DESC
              LIMIT ?`,
        args,
      },
      {
        sql: `SELECT COUNT(*) AS n FROM items
              JOIN sources s ON s.id = items.source_id
              WHERE items.user_id = ?
                AND items.marked_at IS NOT NULL
                AND items.cluster_id IS NULL
                AND s.folder_id IS NOT NULL`,
        args: [userId],
      },
    ],
    "read",
  );
  const baseItems = r.rows.map((row) => ({
    id: String(row.id),
    title: String(row.title),
    lede: String(row.lede),
    publishedAt: Number(row.published_at),
    canonicalUrl: String(row.canonical_url),
    sourceId: String(row.source_id),
    sourceName: String(row.source_name ?? ""),
    sourceKind: String(row.source_kind ?? ""),
    folderId: row.folder_id ? String(row.folder_id) : null,
    folderName: row.folder_name ? String(row.folder_name) : null,
    score: row.score === null || row.score === undefined ? null : Number(row.score),
    commentCount:
      row.comment_count === null || row.comment_count === undefined
        ? null
        : Number(row.comment_count),
  }));
  const alsoCoveredMap = await computeAlsoCoveredBy(userId, baseItems);
  const items: ReaderItem[] = baseItems.map((it) => ({
    ...it,
    alsoCoveredBy: alsoCoveredMap.get(it.id) ?? [],
  }));
  const markedCount = Number(markedR.rows[0]!.n ?? 0);
  return {
    items,
    markedCount,
    thresholdReached: markedCount >= READER_CLUSTER_THRESHOLD,
  };
}

export interface ReaderFolderOption {
  id: string;
  name: string;
  queueCount: number;
}

/**
 * Folders the reader can scope to, with the count of triage-eligible items
 * in each. Folders with zero eligible items are still listed when they have
 * sources, so the user can see why a folder is empty and not assume it
 * vanished. Drives the chip bar above the swipe deck.
 */
export async function listReaderFolderOptions(userId: string): Promise<{
  folders: ReaderFolderOption[];
  totalCount: number;
}> {
  await ensureSchema();
  const r = await db.execute({
    sql: `WITH queue_counts AS (
            SELECT s.folder_id, COUNT(*) AS queue_count
            FROM items i
            JOIN sources s ON s.id = i.source_id
            WHERE i.user_id = ?
              AND i.cluster_id IS NULL
              AND i.marked_at IS NULL
              AND i.dismissed_at IS NULL
              AND s.folder_id IS NOT NULL
            GROUP BY s.folder_id
          )
          SELECT f.id AS id, f.name AS name,
                 COALESCE(queue_counts.queue_count, 0) AS queue_count
          FROM source_folders f
          LEFT JOIN queue_counts ON queue_counts.folder_id = f.id
          WHERE f.user_id = ?
            AND EXISTS (SELECT 1 FROM sources s WHERE s.folder_id = f.id)
          ORDER BY f.sort_order ASC, f.name ASC`,
    args: [userId, userId],
  });
  const folders = r.rows.map((row) => ({
    id: String(row.id),
    name: String(row.name),
    queueCount: Number(row.queue_count ?? 0),
  }));
  const totalCount = folders.reduce((sum, f) => sum + f.queueCount, 0);
  return { folders, totalCount };
}

export async function countMarked(userId: string): Promise<number> {
  await ensureSchema();
  const r = await db.execute({
    sql: `SELECT COUNT(*) AS n FROM items
          JOIN sources s ON s.id = items.source_id
          WHERE items.user_id = ?
            AND items.marked_at IS NOT NULL
            AND items.cluster_id IS NULL
            AND s.folder_id IS NOT NULL`,
    args: [userId],
  });
  return Number(r.rows[0]!.n ?? 0);
}

export async function listMarked(userId: string): Promise<ReaderItem[]> {
  await ensureSchema();
  const r = await db.execute({
    sql: `SELECT i.id, i.title, i.lede, i.published_at, i.canonical_url,
                 i.score, i.comment_count,
                 s.id AS source_id, s.display_name AS source_name, s.kind AS source_kind,
                 f.id AS folder_id, f.name AS folder_name
          FROM items i
          JOIN sources s ON s.id = i.source_id
          LEFT JOIN source_folders f ON f.id = s.folder_id
          WHERE i.user_id = ?
            AND i.marked_at IS NOT NULL
            AND i.cluster_id IS NULL
            AND s.folder_id IS NOT NULL
          ORDER BY i.marked_at ASC`,
    args: [userId],
  });
  const baseItems = r.rows.map((row) => ({
    id: String(row.id),
    title: String(row.title),
    lede: String(row.lede),
    publishedAt: Number(row.published_at),
    canonicalUrl: String(row.canonical_url),
    sourceId: String(row.source_id),
    sourceName: String(row.source_name ?? ""),
    sourceKind: String(row.source_kind ?? ""),
    folderId: row.folder_id ? String(row.folder_id) : null,
    folderName: row.folder_name ? String(row.folder_name) : null,
    score: row.score === null || row.score === undefined ? null : Number(row.score),
    commentCount:
      row.comment_count === null || row.comment_count === undefined
        ? null
        : Number(row.comment_count),
  }));
  const alsoCoveredMap = await computeAlsoCoveredBy(userId, baseItems);
  return baseItems.map((it) => ({
    ...it,
    alsoCoveredBy: alsoCoveredMap.get(it.id) ?? [],
  }));
}

const ALSO_COVERED_LOOKBACK_MS = 14 * 24 * 60 * 60 * 1000;
const ALSO_COVERED_MAX_NAMES = 4;
const ALSO_COVERED_MAX_PHRASES = 80;
const ALSO_COVERED_CANDIDATE_LIMIT = 500;

interface BaseItemForOverlap {
  id: string;
  title: string;
  sourceId: string;
}

/**
 * For each given item, find recent items from OTHER sources whose title
 * shares at least one proper-noun phrase, and return the deduped list of
 * those source display names. Used by the reader card to flag multi-source
 * stories without requiring an embedding pass.
 *
 * The phrase regex matches sequences of capitalised tokens (e.g.
 * "Apple Vision Pro", "Reuters") which is a cheap proxy for entities. It
 * misses lowercase named events and over-matches sentence-initial words;
 * good enough for a swipe-time hint, not for ranking.
 */
async function computeAlsoCoveredBy(
  userId: string,
  items: BaseItemForOverlap[],
): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>();
  if (items.length === 0) return result;

  const itemTags = await loadReaderItemTags(items.map((it) => it.id));
  const allTags = new Set<string>();
  for (const tags of itemTags.values()) {
    for (const tag of tags) allTags.add(tag);
  }
  if (allTags.size === 0) return result;

  const since = Date.now() - ALSO_COVERED_LOOKBACK_MS;
  const tagList = Array.from(allTags).slice(0, ALSO_COVERED_MAX_PHRASES);
  const placeholders = tagList.map(() => "?").join(",");
  const candidates = await db.execute({
    sql: `SELECT lower(it.tag) AS tag, i.id, i.source_id, s.display_name
          FROM item_tags it
          JOIN items i ON i.id = it.item_id
          JOIN sources s ON s.id = i.source_id
          WHERE i.user_id = ?
            AND i.published_at > ?
            AND lower(it.tag) IN (${placeholders})
          ORDER BY i.published_at DESC
          LIMIT ?`,
    args: [userId, since, ...tagList, ALSO_COVERED_CANDIDATE_LIMIT],
  });

  const tagIndex = new Map<string, Array<{ id: string; sourceId: string; sourceName: string }>>();
  for (const row of candidates.rows) {
    const tag = String(row.tag ?? "");
    const sourceId = String(row.source_id);
    const sourceName = String(row.display_name ?? "").trim();
    if (!tag || !sourceName) continue;
    let bucket = tagIndex.get(tag);
    if (!bucket) {
      bucket = [];
      tagIndex.set(tag, bucket);
    }
    bucket.push({ id: String(row.id), sourceId, sourceName });
  }

  for (const it of items) {
    const tags = itemTags.get(it.id);
    if (!tags || tags.size === 0) {
      result.set(it.id, []);
      continue;
    }
    const seenSources = new Set<string>();
    const names: string[] = [];
    for (const tag of tags) {
      const bucket = tagIndex.get(tag);
      if (!bucket) continue;
      for (const c of bucket) {
        if (c.id === it.id) continue;
        if (c.sourceId === it.sourceId) continue;
        if (seenSources.has(c.sourceId)) continue;
        seenSources.add(c.sourceId);
        names.push(c.sourceName);
        if (names.length >= ALSO_COVERED_MAX_NAMES) break;
      }
      if (names.length >= ALSO_COVERED_MAX_NAMES) break;
    }
    result.set(it.id, names);
  }
  return result;
}

async function loadReaderItemTags(itemIds: string[]): Promise<Map<string, Set<string>>> {
  const out = new Map<string, Set<string>>();
  if (itemIds.length === 0) return out;
  const placeholders = itemIds.map(() => "?").join(",");
  const r = await db.execute({
    sql: `SELECT item_id, lower(tag) AS tag
          FROM item_tags
          WHERE item_id IN (${placeholders})
          ORDER BY confidence DESC`,
    args: itemIds,
  });
  for (const row of r.rows) {
    const itemId = String(row.item_id);
    const tag = String(row.tag ?? "").trim();
    if (!tag) continue;
    let tags = out.get(itemId);
    if (!tags) {
      tags = new Set();
      out.set(itemId, tags);
    }
    tags.add(tag);
  }
  return out;
}

export async function markItem(itemId: string, userId: string): Promise<void> {
  await ensureSchema();
  await db.execute({
    sql: `UPDATE items SET marked_at = ?, dismissed_at = NULL
          WHERE id = ? AND user_id = ?`,
    args: [Date.now(), itemId, userId],
  });
}

export async function dismissItem(itemId: string, userId: string): Promise<void> {
  await ensureSchema();
  await db.execute({
    sql: `UPDATE items SET dismissed_at = ?, marked_at = NULL
          WHERE id = ? AND user_id = ?`,
    args: [Date.now(), itemId, userId],
  });
}

export async function unmarkItem(itemId: string, userId: string): Promise<void> {
  await ensureSchema();
  await db.execute({
    sql: `UPDATE items SET marked_at = NULL, dismissed_at = NULL
          WHERE id = ? AND user_id = ?`,
    args: [itemId, userId],
  });
}

export interface FormedCluster {
  clusterId: string;
  theme: string;
  itemIds: string[];
}

/**
 * Group the user's marked pile into clusters. We ask the model for a
 * thematic grouping, then persist each group as a cluster and assign
 * items to it. Items the model leaves out stay marked so the next pass
 * can pick them up. Singletons are intentional: a marked item with no
 * thematic neighbour still becomes a single-item cluster the user can
 * draft from, because they explicitly said "great, follow up."
 */
export async function clusterMarkedItems(userId: string): Promise<FormedCluster[]> {
  await ensureSchema();
  const marked = await listMarked(userId);
  if (marked.length === 0) return [];

  const groups = await groupByTheme(marked);
  if (groups.length === 0) return [];

  const formed: FormedCluster[] = [];
  for (const group of groups) {
    const validIds = group.itemIds.filter((id) => marked.some((m) => m.id === id));
    if (validIds.length === 0) continue;
    const groupItems = marked.filter((m) => validIds.includes(m.id));
    const entities = topEntities(groupItems);

    const clusterId = crypto.randomUUID();
    const now = Date.now();
    await db.execute({
      sql: `INSERT INTO clusters
            (id, user_id, primary_entities, formed_at, fired_at, source_count, state)
            VALUES (?, ?, ?, ?, ?, 0, 'fired')`,
      args: [clusterId, userId, JSON.stringify(entities), now, now],
    });
    for (const id of validIds) {
      await db.execute({
        sql: `UPDATE items SET cluster_id = ?, marked_at = NULL WHERE id = ?`,
        args: [clusterId, id],
      });
    }
    await db.execute({
      sql: `UPDATE clusters SET source_count = (
              SELECT COUNT(DISTINCT source_id) FROM items WHERE cluster_id = ?
            ) WHERE id = ?`,
      args: [clusterId, clusterId],
    });

    const cluster: Cluster = {
      id: clusterId,
      userId,
      centroid: null,
      embeddingModel: null,
      embeddingVersion: null,
      primaryEntities: entities,
      formedAt: now,
      firedAt: now,
      sourceCount: validIds.length,
      rankerScore: null,
      capabilityVersionPin: null,
      state: "fired",
    };
    try {
      await rankCluster(cluster, userId);
    } catch {
      // Ranker is best-effort; the cluster still surfaces on Today
      // ordered by formed_at when ranker_signals are missing.
    }
    formed.push({ clusterId, theme: group.theme, itemIds: validIds });
  }
  return formed;
}

interface ThemeGroup {
  theme: string;
  itemIds: string[];
}

async function groupByTheme(items: ReaderItem[]): Promise<ThemeGroup[]> {
  // Single-item piles never need the model; one cluster, theme is the title.
  if (items.length === 1) {
    return [{ theme: items[0]!.title, itemIds: [items[0]!.id] }];
  }

  const apiKey = await getAnthropicApiKey();
  if (!apiKey) return fallbackGrouping(items);

  const model = await getAnthropicDraftModel();
  const client = new Anthropic({ apiKey });

  const numbered = items
    .map(
      (it, idx) => `[${idx + 1}] id=${it.id}\nTITLE: ${it.title}\nLEDE: ${it.lede.slice(0, 400)}`,
    )
    .join("\n\n");

  const system = [
    "You group the user's marked stories into thematic clusters for drafting.",
    "Rules:",
    "- Each group must share an angle, event, or thread the user could write one post about.",
    '- Each group needs a short theme label (max 60 chars), no leading "The".',
    "- Items that share no theme stay as singletons; do NOT force-merge.",
    "- Every input id must appear in exactly one group.",
    'Return ONLY JSON: {"groups":[{"theme":"...","item_ids":["..."]}]}',
  ].join("\n");

  const user = `Marked stories (${items.length}):\n\n${numbered}`;

  const response = await client.messages.create({
    model,
    max_tokens: 1500,
    system,
    messages: [{ role: "user", content: user }],
  });
  const text = response.content
    .map((b) => (b.type === "text" ? b.text : ""))
    .join("")
    .trim();

  try {
    const cleaned = text
      .replace(/^\s*```(?:json)?\s*/i, "")
      .replace(/\s*```\s*$/i, "")
      .trim();
    const parsed = JSON.parse(cleaned) as {
      groups?: Array<{ theme?: string; item_ids?: string[] }>;
    };
    const validIds = new Set(items.map((it) => it.id));
    const out: ThemeGroup[] = [];
    const seen = new Set<string>();
    for (const g of parsed.groups ?? []) {
      const ids = (g.item_ids ?? []).filter((id) => validIds.has(id) && !seen.has(id));
      if (ids.length === 0) continue;
      ids.forEach((id) => seen.add(id));
      out.push({ theme: (g.theme ?? "Untitled cluster").slice(0, 80), itemIds: ids });
    }
    // Anything the model dropped becomes a singleton so the user's
    // mark isn't silently lost.
    for (const it of items) {
      if (!seen.has(it.id)) out.push({ theme: it.title.slice(0, 80), itemIds: [it.id] });
    }
    return out;
  } catch {
    return fallbackGrouping(items);
  }
}

/**
 * No-API fallback: every marked item becomes its own cluster. The user
 * still gets the "marked turns into clusters" payoff; they just don't
 * get LLM thematic grouping. This keeps the local dev path working
 * without a key configured.
 */
function fallbackGrouping(items: ReaderItem[]): ThemeGroup[] {
  return items.map((it) => ({ theme: it.title.slice(0, 80), itemIds: [it.id] }));
}

function topEntities(items: ReaderItem[]): string[] {
  // Pull whatever entities are already cached on the items. Falling back
  // to title tokens is overkill for v1; the cluster ranker reads entities
  // off the items table at scoring time anyway.
  const entitySet = new Set<string>();
  for (const it of items) {
    const tokens = it.title.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2}\b/g) ?? [];
    for (const t of tokens) entitySet.add(t);
  }
  return Array.from(entitySet).slice(0, 8);
}
