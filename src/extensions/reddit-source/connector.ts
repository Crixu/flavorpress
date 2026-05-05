/**
 * Reddit connector.
 *
 * Fetches a subreddit's `.json` listing instead of its RSS feed so we can
 * capture engagement signal (score, num_comments) the user wants visible at
 * triage time. Reuses the polite-fetch token bucket but talks JSON, not XML.
 *
 * Accepted source URLs (whatever the user pasted):
 *   - https://www.reddit.com/r/<sub>/
 *   - https://www.reddit.com/r/<sub>/.rss
 *   - https://www.reddit.com/r/<sub>/new/
 *
 * We normalize to `https://www.reddit.com/r/<sub>.json` (or the matching
 * sort, if one was chosen) at fetch time. The user's `source.url` row stays
 * untouched so the existing dashboard / link-out behavior is unchanged.
 *
 * Engagement thresholds (minimum upvotes, minimum comments) are read from
 * the extension's settings in `./server.ts` and applied during fetch so
 * filtered posts never enter the items table.
 */

import { db } from "@/lib/db";
import { BackoffError, USER_AGENT, registrableDomain, takeToken } from "@/lib/v1/polite-fetch";
import type { RawItem, SourceConnector, ConnectorContext } from "@/lib/v1/source-connector";
import type { Source } from "@/lib/v1/types";
import { getRedditEngagementThresholds } from "./server";

interface RedditChildData {
  id?: string;
  name?: string;
  title?: string;
  selftext?: string;
  permalink?: string;
  url?: string;
  author?: string;
  score?: number;
  num_comments?: number;
  created_utc?: number;
  subreddit?: string;
}

interface RedditChild {
  kind?: string;
  data?: RedditChildData;
}

interface RedditListing {
  kind?: string;
  data?: { children?: RedditChild[] };
}

export const redditConnector: SourceConnector<RawItem> = {
  kind: "reddit",
  defaultPollIntervalSeconds: 600,

  async fetch(ctx: ConnectorContext): Promise<RawItem[]> {
    const jsonUrl = toJsonListingUrl(ctx.source.url);
    const body = await fetchJson(ctx.source, jsonUrl);
    if (body === null) return [];
    const items = parseListing(body);
    const thresholds = await getRedditEngagementThresholds();
    return applyEngagementThresholds(items, thresholds);
  },

  parse(raw: RawItem): RawItem | null {
    return raw;
  },
};

/**
 * Normalize any reddit URL the user pasted into the JSON listing endpoint.
 * `https://www.reddit.com/r/foo/`         -> `https://www.reddit.com/r/foo.json`
 * `https://www.reddit.com/r/foo/.rss`     -> `https://www.reddit.com/r/foo.json`
 * `https://www.reddit.com/r/foo/new/`     -> `https://www.reddit.com/r/foo/new.json`
 * `https://www.reddit.com/r/foo.json`     -> unchanged
 */
export function toJsonListingUrl(input: string): string {
  let u: URL;
  try {
    u = new URL(input);
  } catch {
    return input;
  }
  let path = u.pathname.replace(/\/+$/, "");
  if (path.endsWith(".rss")) path = path.slice(0, -".rss".length).replace(/\/+$/, "");
  if (path.endsWith(".json")) {
    u.pathname = path;
    return u.toString();
  }
  u.pathname = `${path}.json`;
  return u.toString();
}

async function fetchJson(source: Source, url: string): Promise<RedditListing | null> {
  if (source.backoffUntil && Date.now() < source.backoffUntil) {
    const wait = source.backoffUntil - Date.now();
    throw new BackoffError(0, wait, `source under backoff for ${wait}ms more`);
  }

  let host = "unknown";
  try {
    host = registrableDomain(new URL(url).hostname);
  } catch {
    // Falls through to the unknown bucket; fetch will throw.
  }
  await takeToken(host);

  const headers: Record<string, string> = {
    "User-Agent": USER_AGENT,
    Accept: "application/json",
  };
  if (source.lastEtag) headers["If-None-Match"] = source.lastEtag;
  if (source.lastModified) headers["If-Modified-Since"] = source.lastModified;

  const res = await fetch(url, { headers, redirect: "follow" });

  if (res.status === 304) {
    await db.execute({
      sql: `UPDATE sources SET backoff_until = NULL WHERE id = ?`,
      args: [source.id],
    });
    return null;
  }

  if (res.status === 429 || res.status === 503) {
    const retryAfter = parseRetryAfter(res.headers.get("retry-after"));
    const retryAfterMs = retryAfter ?? defaultBackoffMs(source);
    const until = Date.now() + retryAfterMs;
    await db.execute({
      sql: `UPDATE sources SET backoff_until = ?, last_error = ? WHERE id = ?`,
      args: [
        until,
        `HTTP ${res.status}; backoff until ${new Date(until).toISOString()}`,
        source.id,
      ],
    });
    throw new BackoffError(
      res.status,
      retryAfterMs,
      `HTTP ${res.status} from ${url}; retry in ${retryAfterMs}ms`,
    );
  }

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} from ${url}`);
  }

  const etag = res.headers.get("etag");
  const lastModified = res.headers.get("last-modified");
  await db.execute({
    sql: `UPDATE sources
          SET last_etag = ?, last_modified = ?, backoff_until = NULL
          WHERE id = ?`,
    args: [etag, lastModified, source.id],
  });

  const text = await res.text();
  try {
    return JSON.parse(text) as RedditListing;
  } catch {
    throw new Error(`reddit: response was not JSON (first 80 chars: ${text.slice(0, 80)})`);
  }
}

function parseRetryAfter(header: string | null): number | null {
  if (!header) return null;
  const seconds = Number(header);
  if (!Number.isNaN(seconds)) return Math.max(0, seconds * 1000);
  const ts = Date.parse(header);
  if (Number.isNaN(ts)) return null;
  return Math.max(0, ts - Date.now());
}

function defaultBackoffMs(source: Source): number {
  const intervalMs = source.pollIntervalSeconds * 1000;
  const base = Math.min(intervalMs * 2, 60 * 60 * 1000);
  const jitter = base * (Math.random() * 0.4 - 0.2);
  return Math.max(60_000, base + jitter);
}

export function parseListing(listing: RedditListing): RawItem[] {
  const children = listing?.data?.children ?? [];
  const items: RawItem[] = [];
  for (const child of children) {
    if (child?.kind && child.kind !== "t3") continue;
    const data = child?.data;
    if (!data) continue;
    const title = (data.title ?? "").trim();
    const permalink = data.permalink ?? "";
    if (!title || !permalink) continue;

    const url = `https://www.reddit.com${permalink}`;
    const externalId = data.name ?? `t3_${data.id ?? permalink}`;
    const selftext = (data.selftext ?? "").trim();
    const lede = selftext.slice(0, 500).trim() || title;
    const body = selftext || null;
    const authors = data.author ? [data.author] : [];
    const publishedAt =
      typeof data.created_utc === "number" ? Math.floor(data.created_utc * 1000) : Date.now();

    items.push({
      externalId,
      url,
      title,
      lede,
      body,
      authors,
      publishedAt,
      raw: data,
      score: typeof data.score === "number" ? data.score : null,
      commentCount: typeof data.num_comments === "number" ? data.num_comments : null,
    });
  }
  return items;
}

export interface RedditEngagementThresholds {
  minScore: number | null;
  minComments: number | null;
}

/**
 * Drop items below the configured thresholds. A null threshold means
 * "no filter on this dimension." Posts missing a numeric value for a
 * dimension fail the threshold; we cannot trust them to clear it.
 */
export function applyEngagementThresholds(
  items: RawItem[],
  thresholds: RedditEngagementThresholds,
): RawItem[] {
  const { minScore, minComments } = thresholds;
  if (minScore === null && minComments === null) return items;
  return items.filter((item) => {
    if (minScore !== null) {
      if (typeof item.score !== "number" || item.score < minScore) return false;
    }
    if (minComments !== null) {
      if (typeof item.commentCount !== "number" || item.commentCount < minComments) {
        return false;
      }
    }
    return true;
  });
}
