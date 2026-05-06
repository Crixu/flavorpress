/**
 * Polite HTTP fetch for source connectors.
 *
 * Wraps the global `fetch` with three protections against shared-IP rate
 * limits (Reddit being the worst offender on Vercel-style egress):
 *
 *   1. Per-host token bucket. One bucket per registrable domain (eTLD+1).
 *      Reddit caps anonymous traffic at ~10 requests / 10 min / IP, so we
 *      keep the steady rate under that ceiling even when several FlavorPress
 *      users share an egress IP.
 *
 *   2. Conditional GETs. We persist the last `ETag` and `Last-Modified` per
 *      source row and replay them as `If-None-Match` / `If-Modified-Since`.
 *      A `304 Not Modified` doesn't count against most rate budgets and
 *      skips body parsing entirely.
 *
 *   3. Backoff on 429 / 503. We honor `Retry-After` (seconds or HTTP-date)
 *      and otherwise double the source's poll interval up to an hour, with
 *      jitter. The next-poll guard reads `backoff_until` off the source row
 *      so a stuck feed doesn't pin the whole loop.
 *
 * The bucket lives in-process. On a Vercel cron each invocation gets a fresh
 * bucket; that's fine because polling currently runs serially inside one
 * action. If we ever fan out per-source serverless triggers, the bucket has
 * to migrate to a `host_state` table keyed on registrable domain.
 */

import { db } from "../db";
import { safeFetch, safeReadText } from "./safe-fetch";
import type { Source } from "./types";

export class BackoffError extends Error {
  readonly status: number;
  readonly retryAfterMs: number;
  constructor(status: number, retryAfterMs: number, message: string) {
    super(message);
    this.name = "BackoffError";
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

export type PoliteResult = { kind: "ok"; body: string } | { kind: "not-modified" };

interface HostBucket {
  tokens: number;
  capacity: number;
  rate: number; // tokens per second
  lastRefillMs: number;
}

interface HostLimit {
  capacity: number;
  rate: number;
}

const buckets = new Map<string, HostBucket>();

export const USER_AGENT = "FlavorPressBot/1.0 (+https://flavorpress.io/bot; contact:lucas)";

/**
 * Per-host limits. Reddit is the strict one; everything else gets a generic
 * 1 req/sec ceiling that no well-behaved publisher cares about. Add hosts
 * here as we discover sites that throttle.
 */
function limitsFor(host: string): HostLimit {
  if (host === "reddit.com") return { capacity: 3, rate: 1 / 6 }; // ~10/min
  if (host === "github.com") return { capacity: 3, rate: 1 / 6 };
  return { capacity: 5, rate: 1 };
}

function bucketFor(host: string): HostBucket {
  let b = buckets.get(host);
  if (!b) {
    const cfg = limitsFor(host);
    b = {
      tokens: cfg.capacity,
      capacity: cfg.capacity,
      rate: cfg.rate,
      lastRefillMs: Date.now(),
    };
    buckets.set(host, b);
  }
  return b;
}

export async function takeToken(host: string): Promise<void> {
  const b = bucketFor(host);
  while (true) {
    const now = Date.now();
    const elapsedSec = (now - b.lastRefillMs) / 1000;
    if (elapsedSec > 0) {
      b.tokens = Math.min(b.capacity, b.tokens + elapsedSec * b.rate);
      b.lastRefillMs = now;
    }
    if (b.tokens >= 1) {
      b.tokens -= 1;
      return;
    }
    const baseWaitMs = Math.ceil(((1 - b.tokens) / b.rate) * 1000);
    const jittered = baseWaitMs + Math.floor(baseWaitMs * (Math.random() * 0.4 - 0.2));
    await new Promise((r) => setTimeout(r, Math.max(50, jittered)));
  }
}

/**
 * eTLD+1 approximation. Good enough for RSS politeness; we'd reach for `psl`
 * if we started caring about exotic ccTLDs.
 */
export function registrableDomain(hostname: string): string {
  const parts = hostname.split(".");
  if (parts.length <= 2) return hostname;
  const twoLabel = new Set(["co.uk", "co.jp", "co.kr", "com.au", "com.br", "co.za", "co.in"]);
  const last2 = parts.slice(-2).join(".");
  if (twoLabel.has(last2)) return parts.slice(-3).join(".");
  return last2;
}

function parseRetryAfter(header: string | null): number | null {
  if (!header) return null;
  const seconds = Number(header);
  if (!Number.isNaN(seconds)) return Math.max(0, seconds * 1000);
  const ts = Date.parse(header);
  if (Number.isNaN(ts)) return null;
  return Math.max(0, ts - Date.now());
}

/**
 * No `Retry-After`: double the source's poll interval, cap at 1h, jitter ±20%.
 */
function defaultBackoffMs(source: Source): number {
  const intervalMs = source.pollIntervalSeconds * 1000;
  const base = Math.min(intervalMs * 2, 60 * 60 * 1000);
  const jitter = base * (Math.random() * 0.4 - 0.2);
  return Math.max(60_000, base + jitter);
}

export async function politeFetch(source: Source): Promise<PoliteResult> {
  if (source.backoffUntil && Date.now() < source.backoffUntil) {
    const wait = source.backoffUntil - Date.now();
    throw new BackoffError(0, wait, `source under backoff for ${wait}ms more`);
  }

  let host = "unknown";
  try {
    host = registrableDomain(new URL(source.url).hostname);
  } catch {
    // Bad URL falls through with the unknown bucket; the fetch will throw.
  }
  await takeToken(host);

  const headers: Record<string, string> = {
    "User-Agent": USER_AGENT,
    Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml",
  };
  if (source.lastEtag) headers["If-None-Match"] = source.lastEtag;
  if (source.lastModified) headers["If-Modified-Since"] = source.lastModified;

  const res = await safeFetch(source.url, { headers });

  if (res.status === 304) {
    await db.execute({
      sql: `UPDATE sources SET backoff_until = NULL WHERE id = ?`,
      args: [source.id],
    });
    return { kind: "not-modified" };
  }

  if (res.status === 429 || res.status === 503) {
    const retryAfterMs =
      parseRetryAfter(res.headers.get("retry-after")) ?? defaultBackoffMs(source);
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
      `HTTP ${res.status} from ${source.url}; retry in ${retryAfterMs}ms`,
    );
  }

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} from ${source.url}`);
  }

  const etag = res.headers.get("etag");
  const lastModified = res.headers.get("last-modified");
  await db.execute({
    sql: `UPDATE sources
          SET last_etag = ?, last_modified = ?, backoff_until = NULL
          WHERE id = ?`,
    args: [etag, lastModified, source.id],
  });

  let body = await safeReadText(res);
  if (body.charCodeAt(0) === 0xfeff) body = body.slice(1);
  return { kind: "ok", body };
}
