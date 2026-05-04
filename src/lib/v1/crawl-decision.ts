/**
 * Per-story crawl decision engine.
 *
 * After segmentation we have N stories from one newsletter post. For each
 * one we have to choose: trust the newsletter's inline summary, or fetch the
 * source article and run Readability on it?
 *
 * The decision is heuristic on purpose. An LLM gate would be slow and
 * non-deterministic for a step that runs on every poll. Tunable thresholds:
 *
 *   - inline ≥ 250 words and has a primary outbound link
 *       → use inline (newsletter author has done the synthesis work; their
 *         voice is what the user picked the source for)
 *   - inline < 40 words and has an outbound link
 *       → crawl (this is a "headline + link" entry; the source has the body)
 *   - 40 ≤ inline < 250 with an outbound link
 *       → crawl (short summary; the source likely has more)
 *   - no outbound link
 *       → use inline (no choice; or skip if even inline is empty)
 *   - link host on the no-crawl list (social, video)
 *       → use inline (we cannot extract from those)
 *
 * Reasons are emitted alongside the action so the polling logs can be tuned
 * later without changing callers.
 */
import type { OutboundLink, StorySegment } from "./segment-stories";

export type CrawlAction = "inline" | "crawl" | "skip";

export interface CrawlDecision {
  action: CrawlAction;
  targetUrl: string | null;
  reason: string;
}

/**
 * Hosts whose pages will not produce useful Readability output (social
 * platforms, video, JS-only SPAs that 401 anonymous fetches). For these we
 * stay with the newsletter's inline summary.
 */
const NO_CRAWL_HOSTS = new Set([
  "twitter.com",
  "x.com",
  "instagram.com",
  "facebook.com",
  "fb.com",
  "tiktok.com",
  "youtube.com",
  "youtu.be",
  "linkedin.com",
  "threads.net",
  "bsky.app",
  "reddit.com",
]);

const SHORTENER_HOSTS = new Set([
  "bit.ly",
  "t.co",
  "ow.ly",
  "buff.ly",
  "lnkd.in",
  "tinyurl.com",
  "goo.gl",
]);

const INLINE_SUBSTANTIVE_WORDS = 250;
const HEADLINE_ONLY_WORDS = 40;

export function decideCrawl(story: StorySegment): CrawlDecision {
  const candidate = pickPrimaryLink(story.outboundLinks);

  if (!candidate) {
    if (story.wordCount < 8) {
      return { action: "skip", targetUrl: null, reason: "no-link-no-prose" };
    }
    return { action: "inline", targetUrl: null, reason: "no-outbound-link" };
  }

  const host = safeHost(candidate.url);
  if (host && hostMatches(host, NO_CRAWL_HOSTS)) {
    return { action: "inline", targetUrl: candidate.url, reason: `no-crawl-host:${host}` };
  }

  if (story.wordCount >= INLINE_SUBSTANTIVE_WORDS) {
    return { action: "inline", targetUrl: candidate.url, reason: "inline-substantive" };
  }

  if (story.wordCount < HEADLINE_ONLY_WORDS) {
    return { action: "crawl", targetUrl: candidate.url, reason: "headline-only" };
  }

  return { action: "crawl", targetUrl: candidate.url, reason: "short-summary-prefer-source" };
}

/**
 * Pick the most "article-like" outbound link from a segment. Preference:
 *
 *   1. First link that is not a known shortener (shorteners get expanded by
 *      the actual fetch, but we deprioritize them so a real article URL
 *      wins when both appear in the same segment).
 *   2. Otherwise the first link.
 */
function pickPrimaryLink(links: OutboundLink[]): OutboundLink | null {
  if (links.length === 0) return null;
  const nonShortener = links.find((l) => {
    const host = safeHost(l.url);
    return host !== null && !hostMatches(host, SHORTENER_HOSTS);
  });
  return nonShortener ?? links[0]!;
}

function hostMatches(host: string, domains: Set<string>): boolean {
  for (const domain of domains) {
    if (host === domain || host.endsWith(`.${domain}`)) return true;
  }
  return false;
}

function safeHost(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}
