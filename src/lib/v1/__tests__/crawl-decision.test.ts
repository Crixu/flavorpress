import { describe, expect, it } from "vitest";

import { decideCrawl } from "../crawl-decision";
import type { StorySegment } from "../segment-stories";

function seg(overrides: Partial<StorySegment> = {}): StorySegment {
  return {
    title: "A story",
    body: "Some prose.",
    outboundLinks: [],
    wordCount: 50,
    ...overrides,
  };
}

describe("decideCrawl", () => {
  it("uses inline when no outbound link is present", () => {
    const d = decideCrawl(seg({ outboundLinks: [], wordCount: 50 }));
    expect(d.action).toBe("inline");
    expect(d.targetUrl).toBeNull();
    expect(d.reason).toBe("no-outbound-link");
  });

  it("skips empty stories with no link and no prose", () => {
    const d = decideCrawl(seg({ outboundLinks: [], body: "", wordCount: 0 }));
    expect(d.action).toBe("skip");
    expect(d.reason).toBe("no-link-no-prose");
  });

  it("crawls when inline is a headline-only entry with a link", () => {
    const d = decideCrawl(
      seg({
        wordCount: 12,
        outboundLinks: [{ url: "https://example.org/article", text: "link" }],
      }),
    );
    expect(d.action).toBe("crawl");
    expect(d.targetUrl).toBe("https://example.org/article");
    expect(d.reason).toBe("headline-only");
  });

  it("crawls when inline is short summary with a link", () => {
    const d = decideCrawl(
      seg({
        wordCount: 80,
        outboundLinks: [{ url: "https://example.org/article", text: "link" }],
      }),
    );
    expect(d.action).toBe("crawl");
    expect(d.reason).toBe("short-summary-prefer-source");
  });

  it("uses inline when newsletter has substantive coverage", () => {
    const d = decideCrawl(
      seg({
        wordCount: 400,
        outboundLinks: [{ url: "https://example.org/article", text: "link" }],
      }),
    );
    expect(d.action).toBe("inline");
    expect(d.targetUrl).toBe("https://example.org/article");
    expect(d.reason).toBe("inline-substantive");
  });

  it("uses inline when the only link points to a social host", () => {
    const d = decideCrawl(
      seg({
        wordCount: 30,
        outboundLinks: [{ url: "https://twitter.com/user/status/123", text: "tweet" }],
      }),
    );
    expect(d.action).toBe("inline");
    expect(d.reason).toBe("no-crawl-host:twitter.com");
  });

  it("uses inline when the only link points to a no-crawl subdomain", () => {
    const d = decideCrawl(
      seg({
        wordCount: 30,
        outboundLinks: [{ url: "https://www.youtube.com/watch?v=abc", text: "video" }],
      }),
    );
    expect(d.action).toBe("inline");
    expect(d.reason).toBe("no-crawl-host:www.youtube.com");
  });

  it("prefers a non-shortener link over a shortener", () => {
    const d = decideCrawl(
      seg({
        wordCount: 30,
        outboundLinks: [
          { url: "https://t.co/abc123", text: "shortener" },
          { url: "https://example.org/full-url", text: "real" },
        ],
      }),
    );
    expect(d.action).toBe("crawl");
    expect(d.targetUrl).toBe("https://example.org/full-url");
  });
});
