/**
 * Multi-story segmentation.
 *
 * Newsletters and roundup posts pack many distinct stories into one RSS feed
 * item. The drafter cannot do its job on a wall of N concatenated stories,
 * and the cluster engine treats the whole post as one item, so a TLDR-style
 * issue covering five topics shows up as a single, low-signal cluster.
 *
 * This module walks the cleaned article HTML produced by Readability and
 * tries to split it into discrete stories. The split is deliberately
 * conservative: we'd rather keep one too-long item than fan out into five
 * junk items per poll. If the structure does not look like a roundup, we
 * return null and the caller keeps the post intact.
 *
 * Heuristic: pick the most common heading level (H2 wins ties); split the
 * body on those boundaries; require each surviving segment to have either
 * substantive prose or an outbound link to a different host; drop sections
 * that match common boilerplate (subscribe, sponsor, footer).
 */
import { parseHTML } from "linkedom";

export interface OutboundLink {
  url: string;
  text: string;
}

export interface StorySegment {
  title: string | null;
  body: string;
  outboundLinks: OutboundLink[];
  wordCount: number;
}

const BOILERPLATE_PATTERNS = [
  /\bsubscribe\b/i,
  /\bsponsored\s+by\b/i,
  /\badvertis(e|ement)\b/i,
  /\bthanks?\s+for\s+reading\b/i,
  /\bunsubscribe\b/i,
  /\bforward(ed)?\s+to\s+a\s+friend\b/i,
  /\bwas\s+this\s+forwarded\b/i,
  /\bshare\s+this\s+(post|issue|email)\b/i,
];

const HEADING_TAGS = new Set(["H1", "H2", "H3", "H4"]);

/**
 * Split an article into per-story segments. Returns null when the structure
 * does not look like a roundup (single story, or insufficient signal).
 */
export function segmentStories(articleHtml: string, parentUrl: string): StorySegment[] | null {
  if (!articleHtml || articleHtml.length < 400) return null;

  let parentHost: string;
  try {
    parentHost = new URL(parentUrl).hostname.toLowerCase();
  } catch {
    return null;
  }

  const { document } = parseHTML(`<!doctype html><html><body>${articleHtml}</body></html>`);
  const body = document.body;
  if (!body) return null;

  const headings = collectHeadings(body);
  const splitLevel = pickSplitLevel(headings);
  if (!splitLevel) return null;

  const splitHeadings = headings.filter((h) => h.tagName === splitLevel);
  if (splitHeadings.length < 2) return null;

  const segments: StorySegment[] = [];
  for (let i = 0; i < splitHeadings.length; i++) {
    const start = splitHeadings[i]!.el;
    const end = splitHeadings[i + 1]?.el ?? null;
    const segment = collectSegment(start, end, parentHost);
    if (!segment) continue;
    if (isBoilerplate(segment)) continue;
    if (!isSubstantive(segment)) continue;
    segments.push(segment);
  }

  if (segments.length < 2) return null;
  return segments;
}

interface HeadingNode {
  el: Element;
  tagName: string;
  level: number;
}

function collectHeadings(root: Element): HeadingNode[] {
  const out: HeadingNode[] = [];
  const walker = root.querySelectorAll("h1, h2, h3, h4");
  for (const el of Array.from(walker) as Element[]) {
    const tagName = el.tagName.toUpperCase();
    if (!HEADING_TAGS.has(tagName)) continue;
    out.push({
      el,
      tagName,
      level: Number(tagName.slice(1)),
    });
  }
  return out;
}

/**
 * Pick the heading level to split on. Newsletters typically use H2 for story
 * boundaries; longreads use H2 for sections within a single piece, which is
 * exactly what we DON'T want to split. Strategy: take the lowest-numbered
 * level that has ≥3 occurrences, otherwise return null. The 3-occurrence
 * floor avoids splitting a two-section longread on its lone H2.
 */
function pickSplitLevel(headings: HeadingNode[]): string | null {
  const counts = new Map<string, number>();
  for (const h of headings) counts.set(h.tagName, (counts.get(h.tagName) ?? 0) + 1);
  const candidates = Array.from(counts.entries())
    .filter(([, c]) => c >= 3)
    .sort((a, b) => {
      const la = Number(a[0].slice(1));
      const lb = Number(b[0].slice(1));
      return la - lb;
    });
  return candidates[0]?.[0] ?? null;
}

function collectSegment(
  startHeading: Element,
  endHeading: Element | null,
  parentHost: string,
): StorySegment | null {
  const title = (startHeading.textContent ?? "").trim() || null;
  const parts: string[] = [];
  const links: OutboundLink[] = [];

  collectLinks(startHeading, parentHost, links);

  let node: Element | null = startHeading.nextElementSibling;
  while (node && node !== endHeading) {
    parts.push((node.textContent ?? "").trim());
    collectLinks(node, parentHost, links);
    node = node.nextElementSibling;
  }

  const body = parts.filter(Boolean).join("\n").trim();
  if (!body && links.length === 0) return null;

  return {
    title,
    body,
    outboundLinks: dedupeLinks(links),
    wordCount: countWords(body),
  };
}

function collectLinks(node: Element, parentHost: string, links: OutboundLink[]): void {
  for (const a of Array.from(node.querySelectorAll("a[href]")) as Element[]) {
    const href = a.getAttribute("href");
    if (!href) continue;
    const resolved = resolveHref(href, parentHost);
    if (!resolved) continue;
    links.push({ url: resolved.url, text: (a.textContent ?? "").trim() });
  }
}

function resolveHref(href: string, parentHost: string): { url: string; host: string } | null {
  const trimmed = href.trim();
  if (!trimmed) return null;
  if (
    trimmed.startsWith("#") ||
    trimmed.startsWith("mailto:") ||
    trimmed.startsWith("tel:") ||
    trimmed.startsWith("javascript:")
  ) {
    return null;
  }
  try {
    const u = new URL(trimmed, `https://${parentHost}/`);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    if (u.hostname.toLowerCase() === parentHost) return null;
    return { url: u.toString(), host: u.hostname.toLowerCase() };
  } catch {
    return null;
  }
}

function dedupeLinks(links: OutboundLink[]): OutboundLink[] {
  const seen = new Set<string>();
  const out: OutboundLink[] = [];
  for (const l of links) {
    if (seen.has(l.url)) continue;
    seen.add(l.url);
    out.push(l);
  }
  return out;
}

function countWords(text: string): number {
  if (!text) return 0;
  return text.split(/\s+/).filter(Boolean).length;
}

function isBoilerplate(segment: StorySegment): boolean {
  const haystack = `${segment.title ?? ""} ${segment.body}`;
  for (const re of BOILERPLATE_PATTERNS) {
    if (re.test(haystack) && segment.wordCount < 80) return true;
  }
  return false;
}

function isSubstantive(segment: StorySegment): boolean {
  if (segment.wordCount >= 30) return true;
  if (segment.outboundLinks.length >= 1 && segment.wordCount >= 8) return true;
  return false;
}
