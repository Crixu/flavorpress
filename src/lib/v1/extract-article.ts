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
import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";

import { USER_AGENT, registrableDomain, takeToken } from "./polite-fetch";
import { parseHttpUrl, safeFetch, safeReadText } from "./safe-fetch";

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
  let target: URL;
  try {
    target = parseHttpUrl(url);
  } catch {
    return null;
  }

  try {
    await takeToken(registrableDomain(normalizedHostname(target)));

    const res = await safeFetch(target, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml",
      },
      timeoutMs: TIMEOUT_MS,
      maxRedirects: MAX_REDIRECTS,
    });

    if (res.status < 200 || res.status >= 300) return null;
    const contentType = res.headers.get("content-type")?.toLowerCase() ?? "";
    if (!contentType.includes("html")) return null;

    const html = await safeReadText(res, MAX_BODY_BYTES);
    return parseArticle(html, target.toString());
  } catch {
    return null;
  }
}

function normalizedHostname(url: URL): string {
  return url.hostname.toLowerCase().replace(/^\[/, "").replace(/\]$/, "").replace(/\.$/, "");
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
