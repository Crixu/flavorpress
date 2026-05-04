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
  folderId: string | null;
  folderName: string | null;
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
 */
export async function loadReaderQueue(userId: string): Promise<ReaderQueue> {
  await ensureSchema();
  const r = await db.execute({
    sql: `SELECT i.id, i.title, i.lede, i.published_at, i.canonical_url,
                 s.id AS source_id, s.display_name AS source_name,
                 f.id AS folder_id, f.name AS folder_name
          FROM items i
          JOIN sources s ON s.id = i.source_id
          LEFT JOIN source_folders f ON f.id = s.folder_id
          WHERE i.user_id = ?
            AND i.cluster_id IS NULL
            AND i.marked_at IS NULL
            AND i.dismissed_at IS NULL
            AND s.folder_id IS NOT NULL
          ORDER BY i.published_at DESC
          LIMIT ?`,
    args: [userId, READER_QUEUE_LIMIT],
  });
  const items: ReaderItem[] = r.rows.map((row) => ({
    id: String(row.id),
    title: String(row.title),
    lede: String(row.lede),
    publishedAt: Number(row.published_at),
    canonicalUrl: String(row.canonical_url),
    sourceId: String(row.source_id),
    sourceName: String(row.source_name ?? ""),
    folderId: row.folder_id ? String(row.folder_id) : null,
    folderName: row.folder_name ? String(row.folder_name) : null,
  }));
  const markedCount = await countMarked(userId);
  return {
    items,
    markedCount,
    thresholdReached: markedCount >= READER_CLUSTER_THRESHOLD,
  };
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
                 s.id AS source_id, s.display_name AS source_name,
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
  return r.rows.map((row) => ({
    id: String(row.id),
    title: String(row.title),
    lede: String(row.lede),
    publishedAt: Number(row.published_at),
    canonicalUrl: String(row.canonical_url),
    sourceId: String(row.source_id),
    sourceName: String(row.source_name ?? ""),
    folderId: row.folder_id ? String(row.folder_id) : null,
    folderName: row.folder_name ? String(row.folder_name) : null,
  }));
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
