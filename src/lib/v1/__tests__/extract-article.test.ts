import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";

vi.mock("node:dns/promises", () => ({
  default: {
    lookup: vi.fn(async (hostname: string) => {
      if (hostname === "private.example") return [{ address: "10.0.0.5", family: 4 }];
      return [{ address: "93.184.216.34", family: 4 }];
    }),
  },
  lookup: vi.fn(async (hostname: string) => {
    if (hostname === "private.example") return [{ address: "10.0.0.5", family: 4 }];
    return [{ address: "93.184.216.34", family: 4 }];
  }),
}));

import {
  _resetExtractorForTests,
  _setExtractorForTests,
  rssConnectorExpanded,
} from "../connectors/rss";
import {
  _resetPinnedFetcherForTests,
  _setPinnedFetcherForTests,
  extractFullArticle,
  looksLikeTeaser,
  parseArticle,
} from "../extract-article";
import { createExtractionBudget } from "../source-connector";
import type { ConnectorContext, RawItem } from "../source-connector";

function makeCtx(): ConnectorContext {
  return {
    source: {
      id: "src-1",
      userId: "u-1",
      kind: "rss",
      url: "https://example.com/feed",
      displayName: null,
      trustScore: 0.5,
      pollIntervalSeconds: 300,
      backoffUntil: null,
      lastEtag: null,
      lastModified: null,
      lastPolledAt: null,
      lastError: null,
      active: true,
      createdAt: Date.now(),
    },
    traceId: "t-1",
    log: {
      info: async () => {},
      warn: async () => {},
      error: async () => {},
      debug: async () => {},
    } as unknown as ConnectorContext["log"],
    extractionBudget: createExtractionBudget(1000),
  };
}

function makeItem(overrides: Partial<RawItem> = {}): RawItem {
  return {
    externalId: "id-1",
    url: "https://example.com/post-1",
    title: "Post 1",
    lede: "Lede.",
    body: null,
    authors: [],
    publishedAt: Date.now(),
    raw: null,
    ...overrides,
  };
}

describe("looksLikeTeaser", () => {
  it("flags empty bodies", () => {
    expect(looksLikeTeaser(null)).toBe(true);
    expect(looksLikeTeaser("")).toBe(true);
  });

  it("flags short bodies", () => {
    expect(looksLikeTeaser("Short summary.")).toBe(true);
  });

  it("flags read-more markers", () => {
    const long = "x".repeat(1000) + " read more";
    expect(looksLikeTeaser(long)).toBe(true);
  });

  it("flags bracketed truncation markers", () => {
    expect(looksLikeTeaser("x".repeat(1000) + " [...]")).toBe(true);
    expect(looksLikeTeaser("x".repeat(1000) + " […]")).toBe(true);
  });

  it("passes long full bodies", () => {
    const body = "Full article paragraph. ".repeat(200);
    expect(looksLikeTeaser(body)).toBe(false);
  });
});

describe("parseArticle", () => {
  it("extracts text from a plausible article page", () => {
    const html = `<!doctype html>
      <html>
        <head><title>The Story</title></head>
        <body>
          <header><nav>menu</nav></header>
          <article>
            <h1>The Story</h1>
            <p>${"This is a substantial paragraph with enough words that Readability accepts it as content. ".repeat(8)}</p>
            <p>${"Another paragraph adding to the article body so the char threshold is comfortably exceeded. ".repeat(8)}</p>
          </article>
          <aside>related links</aside>
        </body>
      </html>`;
    const out = parseArticle(html, "https://example.com/post-1");
    expect(out).not.toBeNull();
    expect(out!.textContent.length).toBeGreaterThan(400);
    expect(out!.textContent).toContain("substantial paragraph");
  });

  it("returns null on an empty document", () => {
    expect(parseArticle("<html><body></body></html>", "https://example.com/x")).toBeNull();
  });
});

describe("extractFullArticle", () => {
  afterEach(() => {
    _resetPinnedFetcherForTests();
  });

  it("does not fetch loopback URLs", async () => {
    const fetchMock = vi.fn(async () => ({ status: 200, headers: {}, body: "" }));
    _setPinnedFetcherForTests(fetchMock);

    await expect(extractFullArticle("http://127.0.0.1/admin")).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not fetch hostnames that resolve to private addresses", async () => {
    const fetchMock = vi.fn(async () => ({ status: 200, headers: {}, body: "" }));
    _setPinnedFetcherForTests(fetchMock);

    await expect(extractFullArticle("https://private.example/post-1")).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not fetch IPv4-mapped IPv6 loopback URLs", async () => {
    const fetchMock = vi.fn(async () => ({ status: 200, headers: {}, body: "" }));
    _setPinnedFetcherForTests(fetchMock);

    await expect(extractFullArticle("http://[::ffff:127.0.0.1]/admin")).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not follow redirects to private network URLs", async () => {
    const fetchMock = vi.fn(async () => ({
      status: 302,
      headers: { location: "http://169.254.169.254/latest/meta-data" },
      body: "",
    }));
    _setPinnedFetcherForTests(fetchMock);

    await expect(extractFullArticle("https://example.com/post-1")).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("pins the request to the validated DNS answer", async () => {
    const articleHtml = `<!doctype html>
      <html>
        <head><title>Safe target</title></head>
        <body>
          <article>
            <h1>Safe target</h1>
            <p>${"This article body is long enough for readability to accept as real content. ".repeat(20)}</p>
            <p>${"Another substantial paragraph keeps the extraction above the article threshold. ".repeat(20)}</p>
          </article>
        </body>
      </html>`;
    const seen: Array<{ hostname: string; address: string; family: number }> = [];
    _setPinnedFetcherForTests(async (url, target) => {
      seen.push({ hostname: url.hostname, address: target.address, family: target.family });
      return {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
        body: articleHtml,
      };
    });

    await expect(extractFullArticle("https://rebind.example/post-1")).resolves.not.toBeNull();
    expect(seen).toEqual([{ hostname: "rebind.example", address: "93.184.216.34", family: 4 }]);
  });
});

describe("rssConnectorExpanded.enrich", () => {
  beforeEach(() => {
    _resetExtractorForTests();
  });
  afterEach(() => {
    _resetExtractorForTests();
  });

  it("skips extraction when feed body is already substantial", async () => {
    let called = false;
    _setExtractorForTests(async () => {
      called = true;
      return null;
    });
    const item = makeItem({ body: "Long full body. ".repeat(100) });
    const out = await rssConnectorExpanded.enrich!(item, makeCtx());
    expect(called).toBe(false);
    expect(out).toEqual([item]);
  });

  it("splits full feed HTML before the teaser check", async () => {
    const longParagraph = "Newsletter author wrote a full analysis of this story. ".repeat(60);
    const newsletterHtml = [
      `<h2>Story one</h2><p>${longParagraph} <a href="https://example.org/one">link</a></p>`,
      `<h2>Story two</h2><p>${longParagraph} <a href="https://example.org/two">link</a></p>`,
      `<h2>Story three</h2><p>${longParagraph} <a href="https://example.org/three">link</a></p>`,
    ].join("");
    const extractorCalls: string[] = [];
    _setExtractorForTests(async (url: string) => {
      extractorCalls.push(url);
      return null;
    });

    const item = makeItem({
      url: "https://example.com/issue-42",
      body: "Long feed body. ".repeat(200),
      raw: `<description><![CDATA[${newsletterHtml}]]></description>`,
    });

    const out = await rssConnectorExpanded.enrich!(item, makeCtx());
    expect(out).toHaveLength(3);
    expect(out.map((i) => i.title)).toEqual(["Story one", "Story two", "Story three"]);
    expect(extractorCalls).toEqual([]);
  });

  it("swaps in extracted body when feed body is a teaser and post is single-story", async () => {
    _setExtractorForTests(async () => ({
      title: "Real title",
      textContent: "Full extracted article body. ".repeat(100),
      html: "<p>One paragraph article without headings.</p>",
      excerpt: "Excerpt.",
      byline: null,
      length: 2900,
    }));
    const item = makeItem({ body: "Short teaser. read more" });
    const out = await rssConnectorExpanded.enrich!(item, makeCtx());
    expect(out).toHaveLength(1);
    expect(out[0]!.body).toContain("Full extracted article body.");
    expect(out[0]!.body!.length).toBeGreaterThan((item.body ?? "").length);
  });

  it("falls back to feed body when extraction fails", async () => {
    _setExtractorForTests(async () => null);
    const item = makeItem({ body: "Short teaser." });
    const out = await rssConnectorExpanded.enrich!(item, makeCtx());
    expect(out).toEqual([item]);
  });

  it("falls back when extracted body is shorter than feed body", async () => {
    _setExtractorForTests(async () => ({
      title: null,
      textContent: "tiny",
      html: "<p>tiny</p>",
      excerpt: null,
      byline: null,
      length: 4,
    }));
    const item = makeItem({ body: "Short teaser. read more" });
    const out = await rssConnectorExpanded.enrich!(item, makeCtx());
    expect(out[0]!.body).toBe(item.body);
  });

  it("fans out a multi-story newsletter into per-story items", async () => {
    const newsletterHtml = [
      `<h2>AI lab raises money</h2><p>${"AI lab announced a round today. ".repeat(6)} <a href="https://example.org/ai">link</a></p>`,
      `<h2>Power grid strain</h2><p>${"Utilities warn about capacity limits. ".repeat(6)} <a href="https://example.org/grid">link</a></p>`,
      `<h2>Chip exports tighten</h2><p>${"New chip export rules took effect. ".repeat(6)} <a href="https://example.org/chips">link</a></p>`,
    ].join("");

    let calls = 0;
    _setExtractorForTests(async (url: string) => {
      calls++;
      if (url === "https://example.com/issue-42") {
        return {
          title: "Issue 42",
          textContent: "Full newsletter wall of text. ".repeat(100),
          html: newsletterHtml,
          excerpt: "Issue 42 of the newsletter.",
          byline: null,
          length: 3000,
        };
      }
      // Sub-fetch of one of the linked sources returns a longer article so
      // the connector swaps to the crawled body.
      return {
        title: `Source for ${url}`,
        textContent: "Source body. ".repeat(80),
        html: "<p>source</p>",
        excerpt: "Source excerpt.",
        byline: null,
        length: 1000,
      };
    });

    const item = makeItem({
      url: "https://example.com/issue-42",
      title: "Issue 42",
      body: "Short teaser. read more",
    });

    const out = await rssConnectorExpanded.enrich!(item, makeCtx());
    expect(out).toHaveLength(3);
    expect(out.map((i) => i.title)).toEqual([
      "AI lab raises money",
      "Power grid strain",
      "Chip exports tighten",
    ]);
    // Each story's URL is the linked source, since the inline copy is short
    // enough to trigger the crawl decision.
    expect(out.map((i) => i.url)).toEqual([
      "https://example.org/ai",
      "https://example.org/grid",
      "https://example.org/chips",
    ]);
    // 1 call for parent + 3 sub-fetches.
    expect(calls).toBe(4);
  });

  it("uses inline summary when newsletter coverage is substantive", async () => {
    const longParagraph = "Newsletter author wrote a full analysis of this story. ".repeat(60);
    const newsletterHtml = [
      `<h2>Story one</h2><p>${longParagraph} <a href="https://example.org/one">link</a></p>`,
      `<h2>Story two</h2><p>${longParagraph} <a href="https://example.org/two">link</a></p>`,
      `<h2>Story three</h2><p>${longParagraph} <a href="https://example.org/three">link</a></p>`,
    ].join("");

    const subFetches: string[] = [];
    _setExtractorForTests(async (url: string) => {
      if (url === "https://example.com/issue-42") {
        return {
          title: "Issue 42",
          textContent: "wall. ".repeat(200),
          html: newsletterHtml,
          excerpt: "Issue 42",
          byline: null,
          length: 4000,
        };
      }
      subFetches.push(url);
      return null;
    });

    const item = makeItem({
      url: "https://example.com/issue-42",
      body: "teaser. read more",
    });

    const out = await rssConnectorExpanded.enrich!(item, makeCtx());
    expect(out).toHaveLength(3);
    expect(subFetches).toEqual([]);
    // URL is the outbound link (newsletter pointed at the source), body is
    // the newsletter author's own substantive coverage.
    expect(out[0]!.url).toBe("https://example.org/one");
    expect(out[0]!.body).toContain("Newsletter author wrote a full analysis");
  });
});
