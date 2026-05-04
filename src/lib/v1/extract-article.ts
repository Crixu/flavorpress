/**
 * Full-article extraction.
 *
 * RSS / Atom feeds frequently ship only a teaser ("…read more"), and
 * newsletter platforms (Substack, beehiiv, ConvertKit) cram an entire issue
 * into one feed entry as collapsed HTML. Either way, the feed body is
 * insufficient to draft from.
 *
 * This helper sub-fetches the canonical URL of an item and runs Mozilla
 * Readability against the parsed DOM to recover a clean article body. It
 * shares the per-host token bucket from `polite-fetch.ts`, so a feed poll
 * plus its sub-fetches stay under the same rate ceiling.
 *
 * Returns null on any failure; callers fall back to the feed's own body.
 */
import { lookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { isIP } from "node:net";

import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";

import { USER_AGENT, registrableDomain, takeToken } from "./polite-fetch";

export interface ExtractedArticle {
  title: string | null;
  textContent: string;
  /**
   * Readability's cleaned article HTML. Used by the story segmenter to walk
   * heading structure; not persisted.
   */
  html: string;
  excerpt: string | null;
  byline: string | null;
  length: number;
}

const TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 5;
const MAX_BODY_BYTES = 2_000_000;

/**
 * Heuristic: does this body look like a teaser that needs full-article fetch?
 * Triggers on short bodies and common "read more" markers. Conservative: we
 * prefer false negatives (skip extraction) over false positives (waste tokens
 * and slow polling).
 */
export function looksLikeTeaser(body: string | null): boolean {
  if (!body) return true;
  const trimmed = body.trim();
  if (trimmed.length < 600) return true;
  const tail = trimmed.slice(-200).toLowerCase();
  if (tail.includes("read more")) return true;
  if (tail.includes("continue reading")) return true;
  if (tail.includes("[…]") || tail.includes("[...]")) return true;
  return false;
}

export async function extractFullArticle(url: string): Promise<ExtractedArticle | null> {
  let current: URL;
  try {
    current = new URL(url);
  } catch {
    return null;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let html: string;
  try {
    for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
      const target = await resolveSafeFetchTarget(current);
      if (!target) return null;
      await takeToken(registrableDomain(normalizedHostname(current)));

      const res = await pinnedFetcher(current, target, controller.signal);

      if (isRedirect(res.status)) {
        if (redirects === MAX_REDIRECTS) return null;
        const location = res.headers.location;
        if (!location) return null;
        current = new URL(location, current);
        continue;
      }

      if (res.status < 200 || res.status >= 300) return null;
      const ct = res.headers["content-type"] ?? "";
      if (!ct.includes("html")) return null;
      html = res.body;
      return parseArticle(html, current.toString());
    }
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function isRedirect(status: number): boolean {
  return status >= 300 && status < 400;
}

interface SafeFetchTarget {
  address: string;
  family: 4 | 6;
}

interface PinnedFetchResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

type PinnedFetcher = (
  url: URL,
  target: SafeFetchTarget,
  signal: AbortSignal,
) => Promise<PinnedFetchResponse>;

let pinnedFetcher: PinnedFetcher = fetchPinned;

export function _setPinnedFetcherForTests(fn: PinnedFetcher): void {
  pinnedFetcher = fn;
}

export function _resetPinnedFetcherForTests(): void {
  pinnedFetcher = fetchPinned;
}

async function resolveSafeFetchTarget(url: URL): Promise<SafeFetchTarget | null> {
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;

  const hostname = normalizedHostname(url);
  if (isBlockedHostname(hostname)) return null;

  const version = isIP(hostname);
  if (version === 4 || version === 6) {
    return isBlockedIp(hostname, version) ? null : { address: hostname, family: version };
  }

  try {
    const records = await lookup(hostname, { all: true });
    const safe = records.filter((r) => !isBlockedIp(r.address, r.family));
    if (safe.length !== records.length || safe.length === 0) return null;
    const first = safe[0]!;
    if (first.family !== 4 && first.family !== 6) return null;
    return { address: first.address, family: first.family };
  } catch {
    return null;
  }
}

function fetchPinned(
  url: URL,
  target: SafeFetchTarget,
  signal: AbortSignal,
): Promise<PinnedFetchResponse> {
  return new Promise((resolve, reject) => {
    const client = url.protocol === "https:" ? https : http;
    const req = client.request(
      url,
      {
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "text/html,application/xhtml+xml",
        },
        lookup: (_hostname, _options, cb) => {
          cb(null, target.address, target.family);
        },
        servername: normalizedHostname(url),
        signal,
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (chunk: Buffer | string) => {
          const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          size += buf.length;
          if (size > MAX_BODY_BYTES) {
            req.destroy(new Error("article response too large"));
            return;
          }
          chunks.push(buf);
        });
        res.on("end", () => {
          resolve({
            status: res.statusCode ?? 0,
            headers: normalizeHeaders(res.headers),
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
}

function normalizeHeaders(headers: http.IncomingHttpHeaders): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (Array.isArray(value)) out[key.toLowerCase()] = value[0] ?? "";
    else if (value !== undefined) out[key.toLowerCase()] = value;
  }
  return out;
}

function normalizedHostname(url: URL): string {
  return url.hostname.toLowerCase().replace(/^\[/, "").replace(/\]$/, "").replace(/\.$/, "");
}

function isBlockedHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname.endsWith(".localhost");
}

function isBlockedIp(address: string, family: number): boolean {
  if (family === 4) return isBlockedIpv4(address);
  if (family === 6) return isBlockedIpv6(address);
  return true;
}

function isBlockedIpv4(address: string): boolean {
  const parts = address.split(".").map((p) => Number(p));
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) {
    return true;
  }
  const [a, b] = parts as [number, number, number, number];
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a >= 224) return true;
  return false;
}

function isBlockedIpv6(address: string): boolean {
  const normalized = address.toLowerCase();
  if (normalized === "::" || normalized === "::1") return true;
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true;
  if (normalized.startsWith("fe8") || normalized.startsWith("fe9")) return true;
  if (normalized.startsWith("fea") || normalized.startsWith("feb")) return true;
  if (normalized.startsWith("ff")) return true;
  if (normalized.startsWith("::ffff:")) return true;
  return false;
}

/**
 * Pure parse step, exported so tests can hit it without a real fetch.
 */
export function parseArticle(html: string, url: string): ExtractedArticle | null {
  try {
    const { document } = parseHTML(html);
    // Readability mutates the DOM; linkedom's Document is close enough for it
    // to operate on. The cast is safe because Readability only touches a
    // documented subset of DOM APIs that linkedom implements.
    const reader = new Readability(document as unknown as Document, {
      charThreshold: 200,
    });
    const article = reader.parse();
    if (!article) return null;
    const text = (article.textContent ?? "").replace(/\s+\n/g, "\n").trim();
    if (text.length < 200) return null;
    return {
      title: article.title ?? null,
      textContent: text,
      html: article.content ?? "",
      excerpt: article.excerpt ?? null,
      byline: article.byline ?? null,
      length: text.length,
    };
  } catch {
    void url;
    return null;
  }
}
