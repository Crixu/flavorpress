/**
 * Source connector contract.
 *
 * Every source kind (RSS, Reddit, podcast, YouTube, newsletter) implements
 * this interface. Adding a new kind is a new file in `src/lib/v1/connectors/`
 * plus a registry entry; the rest of the system (cluster engine, ranker,
 * draft generator) does not need to know which kind ingested an item.
 *
 * Lifecycle: fetch → parse → dedupe → emit. Each step is idempotent.
 */

import { db, ensureSchema } from "../db";
import { getBus } from "./event-bus";
import { traceLogger, newTraceId } from "./trace";
import type {
  Item,
  ItemIngestedPayload,
  Source,
  SourceKind,
} from "./types";

export interface RawItem {
  externalId: string; // unique within source (e.g., RSS guid, Reddit permalink)
  url: string;
  title: string;
  lede: string;
  body: string | null;
  authors: string[];
  publishedAt: number; // ms epoch
  raw: unknown; // original payload for debugging
}

export interface ConnectorContext {
  source: Source;
  traceId: string;
  log: ReturnType<typeof traceLogger>;
  since?: number;
}

/**
 * The contract every connector implements. Generic over the connector's
 * native fetch payload (TRaw) and parsed item shape (always RawItem).
 */
export interface SourceConnector<TRaw = unknown> {
  kind: SourceKind;
  defaultPollIntervalSeconds: number;

  fetch(ctx: ConnectorContext): Promise<TRaw[]>;
  parse(raw: TRaw, ctx: ConnectorContext): RawItem | null;
  /**
   * Filter out items already ingested. Default: by canonical_url + content_hash.
   * Override for kind-specific dedupe (e.g., podcast episodes by GUID).
   */
  dedupe?(items: RawItem[], ctx: ConnectorContext): Promise<RawItem[]>;
}

/**
 * Run a connector against one source. Returns the count of new items
 * ingested. This is the function the polling loop / capability calls.
 */
export async function runConnector<TRaw>(
  connector: SourceConnector<TRaw>,
  source: Source,
): Promise<{ ingested: number; traceId: string }> {
  await ensureSchema();
  const traceId = newTraceId();
  const log = traceLogger(traceId, source.userId);
  const ctx: ConnectorContext = {
    source,
    traceId,
    log,
    since: source.lastPolledAt ?? undefined,
  };

  await log.info("connector.fetch", `polling ${source.kind}`, {
    sourceId: source.id,
    url: source.url,
  });

  const startedAt = Date.now();
  let raws: TRaw[];
  try {
    raws = await connector.fetch(ctx);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await log.error("connector.fetch", `fetch failed: ${message}`);
    await db.execute({
      sql: `UPDATE sources SET last_error = ?, last_polled_at = ? WHERE id = ?`,
      args: [message, Date.now(), source.id],
    });
    return { ingested: 0, traceId };
  }

  const parsed: RawItem[] = [];
  for (const r of raws) {
    try {
      const item = connector.parse(r, ctx);
      if (item) parsed.push(item);
    } catch (err) {
      await log.warn("connector.parse", "skipped malformed item", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const deduped = connector.dedupe
    ? await connector.dedupe(parsed, ctx)
    : await defaultDedupe(parsed, ctx);

  // Insert items, then emit ingest events so the cluster engine sees them.
  let ingestedCount = 0;
  for (const item of deduped) {
    const id = crypto.randomUUID();
    const canonicalUrl = canonicalize(item.url);
    const contentHash = hashContent(item.lede + (item.body ?? ""));
    try {
      await db.execute({
        sql: `INSERT INTO items
              (id, source_id, user_id, canonical_url, content_hash, title, lede, body, authors, published_at, fetched_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          id,
          source.id,
          source.userId,
          canonicalUrl,
          contentHash,
          item.title,
          item.lede,
          item.body,
          JSON.stringify(item.authors),
          item.publishedAt,
          Date.now(),
        ],
      });
      ingestedCount++;
      await getBus().emit<ItemIngestedPayload>(
        "item.ingested",
        {
          itemId: id,
          sourceId: source.id,
          canonicalUrl,
          contentHash,
        },
        {
          userId: source.userId,
          traceId,
          idempotencyKey: `item.ingested:${canonicalUrl}:${contentHash}`,
        },
      );
    } catch (err) {
      // UNIQUE(canonical_url, user_id) collision = already ingested. Fine.
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes("UNIQUE")) {
        await log.warn("connector.insert", `insert failed: ${msg}`, {
          url: item.url,
        });
      }
    }
  }

  await db.execute({
    sql: `UPDATE sources SET last_polled_at = ?, last_error = NULL WHERE id = ?`,
    args: [Date.now(), source.id],
  });

  await log.info("connector.fetch", "done", {
    ingested: ingestedCount,
    durationMs: Date.now() - startedAt,
  });

  return { ingested: ingestedCount, traceId };
}

async function defaultDedupe(
  items: RawItem[],
  ctx: ConnectorContext,
): Promise<RawItem[]> {
  if (items.length === 0) return items;
  const canonicalUrls = items.map((i) => canonicalize(i.url));
  const placeholders = canonicalUrls.map(() => "?").join(",");
  const r = await db.execute({
    sql: `SELECT canonical_url FROM items
          WHERE user_id = ? AND canonical_url IN (${placeholders})`,
    args: [ctx.source.userId, ...canonicalUrls],
  });
  const seen = new Set(r.rows.map((row) => String(row.canonical_url)));
  return items.filter((i) => !seen.has(canonicalize(i.url)));
}

/**
 * Canonical URL: scheme + host + path + sorted query (drop UTM and tracking
 * params). Stable enough for cluster Layer 1 exact-match dedup.
 */
export function canonicalize(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    const drop = [
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_content",
      "utm_term",
      "ref",
      "ref_src",
      "fbclid",
      "gclid",
      "mc_cid",
      "mc_eid",
    ];
    for (const k of drop) u.searchParams.delete(k);
    u.searchParams.sort();
    // Trailing slash normalize.
    if (u.pathname.length > 1 && u.pathname.endsWith("/")) {
      u.pathname = u.pathname.slice(0, -1);
    }
    return u.toString();
  } catch {
    return url;
  }
}

/**
 * Stable content hash for cache-key composition (architect review:
 * canonical_url alone leaks tenant data when paywalls serve different
 * content to different users; canonical_url + content_hash fixes this).
 *
 * Uses FNV-1a 64-bit-ish; non-crypto, fast, and stable across runs.
 */
export function hashContent(text: string): string {
  let h = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  for (let i = 0; i < text.length; i++) {
    h ^= BigInt(text.charCodeAt(i));
    h = (h * prime) & 0xffffffffffffffffn;
  }
  return h.toString(16).padStart(16, "0");
}

export interface ItemRow {
  id: string;
  source_id: string;
  user_id: string;
  canonical_url: string;
  content_hash: string;
  title: string;
  lede: string;
  body: string | null;
  authors: string | null;
  published_at: number;
  fetched_at: number;
  entities: string | null;
  cluster_id: string | null;
}

export function rowToItem(row: ItemRow): Item {
  // libSQL returns INTEGER columns as bigint by default; coerce to Number
  // for arithmetic. Timestamps fit in 53-bit safely until year 287396.
  return {
    id: String(row.id),
    sourceId: String(row.source_id),
    userId: String(row.user_id),
    canonicalUrl: String(row.canonical_url),
    contentHash: String(row.content_hash),
    doi: null,
    title: String(row.title),
    lede: String(row.lede),
    body: row.body !== null ? String(row.body) : null,
    authors: row.authors ? JSON.parse(String(row.authors)) : null,
    publishedAt: Number(row.published_at),
    fetchedAt: Number(row.fetched_at),
    entities: row.entities ? JSON.parse(String(row.entities)) : null,
    clusterId: row.cluster_id !== null ? String(row.cluster_id) : null,
  };
}
