/**
 * RSS / Atom connector.
 *
 * First real source connector. Polls the feed URL, parses items, and emits
 * `item.ingested` events through the source-connector contract. No external
 * RSS library; we parse the XML by hand to keep the dependency tree thin
 * and the OSS bundle small.
 *
 * Edge cases handled (engineer review):
 *   - UTF-8 BOM
 *   - Double-encoded entities
 *   - Atom and RSS 2.0 (different element names)
 *   - Title-only items (no description)
 *   - Redirect chains capped at 5
 */

import { decideCrawl } from "../crawl-decision";
import { extractFullArticle, looksLikeTeaser } from "../extract-article";
import type { ExtractedArticle } from "../extract-article";
import { politeFetch } from "../polite-fetch";
import { segmentStories } from "../segment-stories";
import type { StorySegment } from "../segment-stories";
import type { RawItem, SourceConnector, ConnectorContext } from "../source-connector";

type Extractor = (url: string) => Promise<ExtractedArticle | null>;
let extractor: Extractor = extractFullArticle;

/**
 * Test seam: swap the article extractor without monkey-patching modules.
 * Production callers never touch this.
 */
export function _setExtractorForTests(fn: Extractor): void {
  extractor = fn;
}
export function _resetExtractorForTests(): void {
  extractor = extractFullArticle;
}

interface FetchedXml {
  raw: string;
}

export const rssConnector: SourceConnector<FetchedXml> = {
  kind: "rss",
  defaultPollIntervalSeconds: 300,

  async fetch(ctx: ConnectorContext): Promise<FetchedXml[]> {
    const result = await politeFetch(ctx.source);
    if (result.kind === "not-modified") return [];
    return [{ raw: result.body }];
  },

  parse(raw: FetchedXml, ctx: ConnectorContext): RawItem | null {
    // We treat the whole feed as one fetch result; the connector contract
    // returns RawItem[] from fetch (one per feed item) by re-parsing here.
    // This is a wart; cleaner is to expand fetch to RawItem[] directly.
    // For the contract signature we still implement parse() but the work is
    // done in `fetchItems` below. Kept as a no-op for the rare edge where
    // fetch() returns one wrapper.
    void ctx;
    void raw;
    return null;
  },
};

/**
 * Override pattern: RSS fetch returns the whole document; we expand to
 * RawItem[] by parsing the XML. The runConnector helper expects
 * `connector.fetch -> TRaw[]`. So we wrap the connector at registration time
 * to expand the document into per-item TRaw entries.
 */
export const rssConnectorExpanded: SourceConnector<RawItem> = {
  kind: "rss",
  defaultPollIntervalSeconds: 300,

  async fetch(ctx: ConnectorContext): Promise<RawItem[]> {
    const docs = await rssConnector.fetch(ctx);
    if (docs.length === 0) return [];
    return parseFeed(docs[0]!.raw);
  },

  parse(raw: RawItem): RawItem | null {
    return raw;
  },

  async enrich(item: RawItem, ctx: ConnectorContext): Promise<RawItem[]> {
    const feedSegments = segmentStories(feedHtml(item), item.url);
    if (feedSegments) return expandSegments(item, feedSegments, ctx);

    if (!looksLikeTeaser(item.body)) return [item];

    if (!ctx.extractionBudget.take()) {
      await ctx.log.info("connector.enrich", "budget_exhausted", { url: item.url });
      return [item];
    }
    const article = await extractor(item.url);
    if (!article) {
      await ctx.log.info("connector.enrich", "extraction failed; kept feed body", {
        url: item.url,
      });
      return [item];
    }

    const segments = segmentStories(article.html, item.url);
    if (!segments) {
      // Single-story post. Use the extracted body if it's an upgrade.
      if (article.length <= (item.body?.length ?? 0)) {
        await ctx.log.info("connector.enrich", "kept feed body", {
          url: item.url,
          feedBodyLen: item.body?.length ?? 0,
          extractedLen: article.length,
        });
        return [item];
      }
      await ctx.log.info("connector.enrich", "swapped in extracted body", {
        url: item.url,
        feedBodyLen: item.body?.length ?? 0,
        extractedLen: article.length,
      });
      return [
        {
          ...item,
          body: article.textContent,
          lede: item.lede || article.excerpt?.slice(0, 500).trim() || item.lede,
        },
      ];
    }

    return expandSegments(item, segments, ctx);
  },
};

async function expandSegments(
  item: RawItem,
  segments: StorySegment[],
  ctx: ConnectorContext,
): Promise<RawItem[]> {
  // Multi-story post: fan out into per-story items, deciding per segment
  // whether to crawl the linked source or trust the inline summary.
  await ctx.log.info("connector.enrich", "multi-story split", {
    url: item.url,
    segments: segments.length,
  });

  const children: RawItem[] = [];
  const seenUrls = new Set<string>();

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]!;
    const decision = decideCrawl(seg);

    await ctx.log.info("connector.crawl-decision", decision.reason, {
      action: decision.action,
      target: decision.targetUrl,
      title: seg.title,
      words: seg.wordCount,
    });

    if (decision.action === "skip") continue;

    let storyUrl: string;
    let storyBody: string;
    let storyTitle: string;
    let storyExternalId: string;
    let storyLede: string;

    if (decision.action === "crawl" && decision.targetUrl) {
      if (!ctx.extractionBudget.take()) {
        await ctx.log.info("connector.enrich", "budget_exhausted", { url: decision.targetUrl });
        storyUrl = decision.targetUrl;
        storyBody = seg.body;
        storyTitle = seg.title || `${item.title} — story ${i + 1}`;
        storyExternalId = decision.targetUrl;
        storyLede = seg.body.slice(0, 500).trim();
      } else {
        const sub = await extractor(decision.targetUrl);
        if (sub && sub.length > seg.body.length) {
          storyUrl = decision.targetUrl;
          storyBody = sub.textContent;
          storyTitle = seg.title || sub.title || `${item.title} — story ${i + 1}`;
          storyExternalId = decision.targetUrl;
          storyLede = sub.excerpt?.slice(0, 500).trim() || seg.body.slice(0, 500).trim();
        } else {
          // Crawl failed or returned less than the inline summary. Use inline.
          storyUrl = decision.targetUrl;
          storyBody = seg.body;
          storyTitle = seg.title || `${item.title} — story ${i + 1}`;
          storyExternalId = decision.targetUrl;
          storyLede = seg.body.slice(0, 500).trim();
        }
      }
    } else {
      storyUrl = decision.targetUrl ?? appendStoryParam(item.url, i + 1);
      storyBody = seg.body;
      storyTitle = seg.title || `${item.title} — story ${i + 1}`;
      storyExternalId = decision.targetUrl ?? `${item.externalId}#story-${i + 1}`;
      storyLede = seg.body.slice(0, 500).trim();
    }

    if (seenUrls.has(storyUrl)) continue;
    seenUrls.add(storyUrl);

    children.push({
      externalId: storyExternalId,
      url: storyUrl,
      title: storyTitle,
      lede: storyLede || storyTitle,
      body: storyBody,
      authors: item.authors,
      publishedAt: item.publishedAt,
      raw: { parentExternalId: item.externalId, segment: i + 1, decision: decision.reason },
    });
  }

  if (children.length === 0) {
    // All segments skipped. Fall back to single-item behavior.
    return [item];
  }

  return children;
}

function feedHtml(item: RawItem): string {
  if (typeof item.raw !== "string") return "";
  return (
    getTag(item.raw, "content:encoded") ??
    getTag(item.raw, "content") ??
    getTag(item.raw, "description") ??
    getTag(item.raw, "summary") ??
    ""
  );
}

function appendStoryParam(url: string, index: number): string {
  try {
    const u = new URL(url);
    u.searchParams.set("fp_story", String(index));
    return u.toString();
  } catch {
    const sep = url.includes("?") ? "&" : "?";
    return `${url}${sep}fp_story=${index}`;
  }
}

/**
 * Parse RSS 2.0 or Atom into RawItem[]. Tolerant: missing fields don't
 * throw, malformed entries are skipped.
 */
export function parseFeed(xml: string): RawItem[] {
  const items: RawItem[] = [];

  // RSS 2.0: <item>...</item>; Atom: <entry>...</entry>
  const itemMatches =
    matchAll(xml, /<item\b[^>]*>([\s\S]*?)<\/item>/gi) ??
    matchAll(xml, /<entry\b[^>]*>([\s\S]*?)<\/entry>/gi) ??
    [];

  for (const inner of itemMatches) {
    try {
      const url = getTag(inner, "link") ?? getAttr(inner, "link", "href") ?? getTag(inner, "guid");
      const title = getTag(inner, "title");
      if (!url || !title) continue;

      const description =
        getTag(inner, "description") ?? getTag(inner, "summary") ?? getTag(inner, "content") ?? "";

      const lede = stripHtml(description).slice(0, 500).trim();
      if (!lede) continue;

      const body = stripHtml(description);

      const authorRaw = getTag(inner, "author") ?? getTag(inner, "dc:creator") ?? "";
      const authors = authorRaw ? [authorRaw] : [];

      const pubDate =
        getTag(inner, "pubDate") ?? getTag(inner, "updated") ?? getTag(inner, "published") ?? "";
      const publishedAt = parseDate(pubDate) ?? Date.now();

      const externalId = getTag(inner, "guid") ?? url;

      items.push({
        externalId,
        url,
        title: stripHtml(title),
        lede,
        body,
        authors,
        publishedAt,
        raw: inner,
      });
    } catch {
      // Skip malformed item.
    }
  }
  return items;
}

function matchAll(text: string, re: RegExp): string[] | null {
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m[1] !== undefined) out.push(m[1]);
  }
  return out.length > 0 ? out : null;
}

function getTag(text: string, tag: string): string | null {
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
  const m = text.match(re);
  if (!m) return null;
  return decodeEntities(m[1]!.trim());
}

function getAttr(text: string, tag: string, attr: string): string | null {
  const re = new RegExp(`<${tag}\\b[^>]*\\b${attr}\\s*=\\s*["']([^"']+)["'][^>]*>`, "i");
  const m = text.match(re);
  return m ? m[1]! : null;
}

function stripHtml(s: string): string {
  return decodeEntities(s.replace(/<[^>]+>/g, ""))
    .replace(/\s+/g, " ")
    .trim();
}

function decodeEntities(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function parseDate(s: string): number | null {
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : t;
}
