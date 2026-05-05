import "server-only";

/**
 * Topic search over fired clusters. Pure libSQL; no LLM. The Anthropic
 * tool-use orchestrator (see src/lib/v1/topic-search.ts) extracts entities
 * and keywords from the user's topic prompt and hands them to this function.
 *
 * Scoring is intentionally simple: a per-cluster match score combining
 * entity overlap (heaviest), title/lede keyword hits, and a small recency
 * boost. Same 72h freshness window as the Today rail.
 */

import { db } from "../db";
import { CLUSTER_WINDOW_MS } from "./cluster-engine";

export interface FindClustersInput {
  userId: string;
  entities?: string[];
  keywords?: string[];
  domains?: string[];
  sinceHours?: number;
}

export interface TopicClusterResult {
  id: string;
  formedAt: number;
  firedAt: number | null;
  latestPublishedAt: number;
  sourceCount: number;
  domainCount: number;
  domains: string[];
  entities: string[];
  trust: number | null;
  composite: number | null;
  matchScore: number;
  matchedEntities: string[];
  matchedKeywords: string[];
  topItem: {
    title: string;
    sourceUrl: string;
    sourceDisplayName: string;
  } | null;
}

const ENTITY_WEIGHT = 3;
const KEYWORD_WEIGHT = 1;
const RECENCY_WEIGHT = 0.5;
const MAX_RESULTS = 12;

export async function findClusters(input: FindClustersInput): Promise<TopicClusterResult[]> {
  const entities = normalize(input.entities);
  const keywords = normalize(input.keywords);
  const domains = normalize(input.domains);

  if (entities.length === 0 && keywords.length === 0 && domains.length === 0) {
    return [];
  }

  // Word-boundary regex per keyword. Substring matching pulled in
  // garbage: searching for "phone" matched "iPhone", "smartphone",
  // "telephoned"; "plan" matched "planet" and "planning". `\b{kw}`
  // anchors at a word start so plurals and inflections still match
  // ("phone" hits "phones", "phoned") but mid-word collisions are
  // dropped. The terminal `\b` is intentionally omitted so we keep
  // the inflection coverage.
  const keywordRegexes = keywords.map((k) => new RegExp(`\\b${escapeRegExp(k)}`, "i"));

  const windowMs = (input.sinceHours ?? 72) * 60 * 60 * 1000;
  const cutoff = Date.now() - Math.min(windowMs, CLUSTER_WINDOW_MS);

  // Pull every fired cluster in the freshness window with its items + sources.
  // The user's library is bounded (single user, 72h window), so doing the
  // ranking in JS keeps the SQL legible. If this ever stops being cheap we
  // can push entity scoring into a virtual table.
  const r = await db.execute({
    sql: `WITH latest_per_cluster AS (
            SELECT cluster_id, MAX(published_at) AS latest_published_at
            FROM items WHERE cluster_id IS NOT NULL
            GROUP BY cluster_id
          )
          SELECT c.id, c.formed_at, c.fired_at, c.source_count, c.primary_entities,
                 rs.composite, rs.source_trust,
                 latest.latest_published_at,
                 i.title, i.lede, i.entities AS item_entities,
                 i.published_at,
                 s.url AS source_url, s.display_name AS source_display_name
          FROM clusters c
          JOIN items i ON i.cluster_id = c.id
          JOIN sources s ON s.id = i.source_id
          LEFT JOIN ranker_signals rs ON rs.cluster_id = c.id AND rs.user_id = c.user_id
          LEFT JOIN latest_per_cluster latest ON latest.cluster_id = c.id
          WHERE c.user_id = ? AND c.state = 'fired'
            AND COALESCE(latest.latest_published_at, c.formed_at) >= ?`,
    args: [input.userId, cutoff],
  });

  type Acc = {
    id: string;
    formedAt: number;
    firedAt: number | null;
    latestPublishedAt: number;
    sourceCount: number;
    composite: number | null;
    trust: number | null;
    primaryEntities: string[];
    itemEntities: Set<string>;
    domains: Set<string>;
    haystack: string;
    topItem: {
      title: string;
      sourceUrl: string;
      sourceDisplayName: string;
      publishedAt: number;
    } | null;
  };

  const byCluster = new Map<string, Acc>();

  for (const row of r.rows) {
    const id = String(row.id);
    let acc = byCluster.get(id);
    if (!acc) {
      acc = {
        id,
        formedAt: Number(row.formed_at),
        firedAt: row.fired_at ? Number(row.fired_at) : null,
        latestPublishedAt:
          row.latest_published_at !== null && row.latest_published_at !== undefined
            ? Number(row.latest_published_at)
            : Number(row.formed_at),
        sourceCount: Number(row.source_count ?? 0),
        composite:
          row.composite !== null && row.composite !== undefined ? Number(row.composite) : null,
        trust:
          row.source_trust !== null && row.source_trust !== undefined
            ? Number(row.source_trust)
            : null,
        primaryEntities: row.primary_entities
          ? (JSON.parse(String(row.primary_entities)) as string[]).filter(
              (e): e is string => typeof e === "string",
            )
          : [],
        itemEntities: new Set<string>(),
        domains: new Set<string>(),
        haystack: "",
        topItem: null,
      };
      byCluster.set(id, acc);
    }

    if (row.item_entities) {
      try {
        const ents = JSON.parse(String(row.item_entities)) as unknown[];
        for (const e of ents) {
          if (typeof e === "string" && e.length > 0) acc.itemEntities.add(e.toLowerCase());
        }
      } catch {
        // skip malformed entity blobs
      }
    }

    const sourceUrl = row.source_url ? String(row.source_url) : "";
    if (sourceUrl) {
      const host = hostFromUrl(sourceUrl);
      if (host) acc.domains.add(host);
    }

    const title = row.title ? String(row.title) : "";
    const lede = row.lede ? String(row.lede) : "";
    acc.haystack += ` ${title.toLowerCase()} ${lede.toLowerCase()}`;

    const publishedAt = row.published_at ? Number(row.published_at) : 0;
    if (!acc.topItem || publishedAt > acc.topItem.publishedAt) {
      acc.topItem = {
        title,
        sourceUrl,
        sourceDisplayName: row.source_display_name ? String(row.source_display_name) : "",
        publishedAt,
      };
    }
  }

  const now = Date.now();
  const results: TopicClusterResult[] = [];

  for (const acc of byCluster.values()) {
    const allEntities = new Set<string>();
    for (const e of acc.primaryEntities) allEntities.add(e.toLowerCase());
    for (const e of acc.itemEntities) allEntities.add(e);

    if (domains.length > 0) {
      const domainHit = domains.some((d) =>
        Array.from(acc.domains).some((have) => have === d || have.endsWith(`.${d}`)),
      );
      if (!domainHit) continue;
    }

    // Three-tier entity matching, ordered by precision:
    //   1. Exact tagged-entity hit ("openai" in cluster entities)
    //   2. Multi-word variant ("openai inc", "openai foundation")
    //   3. Haystack fallback ("openai" appears as a word in any item
    //      title or lede). Cluster engine doesn't always tag entities
    //      cleanly; without this fallback, an OpenAI story tagged only
    //      as "Sam Altman" would miss a topic search for "OpenAI."
    const matchedEntities: string[] = [];
    for (const wanted of entities) {
      if (allEntities.has(wanted)) {
        matchedEntities.push(wanted);
        continue;
      }
      let variantHit = false;
      for (const e of allEntities) {
        if (e.startsWith(`${wanted} `) || e.endsWith(` ${wanted}`)) {
          matchedEntities.push(wanted);
          variantHit = true;
          break;
        }
      }
      if (variantHit) continue;
      const wordHit = new RegExp(`\\b${escapeRegExp(wanted)}\\b`, "i");
      if (wordHit.test(acc.haystack)) {
        matchedEntities.push(wanted);
      }
    }
    const entityHits = matchedEntities.length;

    const matchedKeywords: string[] = [];
    for (let i = 0; i < keywords.length; i++) {
      if (keywordRegexes[i]!.test(acc.haystack)) {
        matchedKeywords.push(keywords[i]!);
      }
    }
    const keywordHits = matchedKeywords.length;

    // Strict gating: when the model extracted any entities, the cluster
    // must contain at least one of them. Keyword-only matches without
    // an entity hit produced floods of false positives (a topic about
    // "OpenAI's phone" pulled in every Apple iPhone cluster on the
    // strength of "phone" alone). Keywords stay as a ranking boost; they
    // no longer qualify a match on their own.
    if (entities.length > 0) {
      if (entityHits === 0) continue;
    } else if (keywords.length > 0) {
      if (keywordHits === 0) continue;
    }

    const ageHours = Math.max(0, (now - acc.latestPublishedAt) / (60 * 60 * 1000));
    const recency = Math.max(0, 1 - ageHours / 72);

    const baseScore =
      entityHits * ENTITY_WEIGHT + keywordHits * KEYWORD_WEIGHT + recency * RECENCY_WEIGHT;
    // Composite (ranker quality, 0-1) lifts well-ranked clusters above
    // mediocre ones with the same hit count. Multiplier instead of an
    // additive term so a 0-composite cluster still scores normally; a
    // 0.9-composite cluster gets ~1.45x boost.
    const qualityBoost = 1 + (acc.composite ?? 0) * 0.5;
    const matchScore = baseScore * qualityBoost;

    if (matchScore <= 0) continue;

    results.push({
      id: acc.id,
      formedAt: acc.formedAt,
      firedAt: acc.firedAt,
      latestPublishedAt: acc.latestPublishedAt,
      sourceCount: acc.sourceCount,
      domainCount: acc.domains.size,
      domains: Array.from(acc.domains).sort(),
      entities: Array.from(allEntities).sort(),
      trust: acc.trust,
      composite: acc.composite,
      matchScore,
      matchedEntities,
      matchedKeywords,
      topItem: acc.topItem
        ? {
            title: acc.topItem.title,
            sourceUrl: acc.topItem.sourceUrl,
            sourceDisplayName: acc.topItem.sourceDisplayName,
          }
        : null,
    });
  }

  results.sort((a, b) => {
    if (b.matchScore !== a.matchScore) return b.matchScore - a.matchScore;
    return b.latestPublishedAt - a.latestPublishedAt;
  });

  return results.slice(0, MAX_RESULTS);
}

function normalize(values: string[] | undefined): string[] {
  if (!values) return [];
  const out = new Set<string>();
  for (const v of values) {
    if (typeof v !== "string") continue;
    const trimmed = v.trim().toLowerCase();
    if (trimmed.length === 0) continue;
    out.add(trimmed);
  }
  return Array.from(out);
}

function hostFromUrl(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
