import { describe, expect, it } from "vitest";
import { OPML_IMPORT_CAP, parseOpml } from "../opml";

describe("parseOpml", () => {
  it("returns no feeds for empty input", () => {
    expect(parseOpml("")).toEqual({ feeds: [], rawCount: 0 });
    expect(parseOpml("   ")).toEqual({ feeds: [], rawCount: 0 });
  });

  it("parses a flat list of self-closing outlines", () => {
    const xml = `<?xml version="1.0"?>
      <opml><body>
        <outline type="rss" title="Sprudge" xmlUrl="https://sprudge.com/feed" />
        <outline type="rss" text="Daily Coffee News" xmlUrl="https://dailycoffeenews.com/feed/" />
      </body></opml>`;
    const result = parseOpml(xml);
    expect(result.rawCount).toBe(2);
    expect(result.feeds).toEqual([
      { url: "https://sprudge.com/feed", title: "Sprudge", groupTitle: null },
      {
        url: "https://dailycoffeenews.com/feed/",
        title: "Daily Coffee News",
        groupTitle: null,
      },
    ]);
  });

  it("inherits the group title for nested outlines", () => {
    const xml = `<opml><body>
      <outline title="Coffee">
        <outline type="rss" title="Sprudge" xmlUrl="https://sprudge.com/feed"/>
      </outline>
      <outline title="Tech">
        <outline type="rss" title="WP Tavern" xmlUrl="https://wptavern.com/feed"/>
      </outline>
    </body></opml>`;
    const result = parseOpml(xml);
    expect(result.feeds.map((f) => f.groupTitle)).toEqual(["Coffee", "Tech"]);
  });

  it("dedupes feeds by url", () => {
    const xml = `<opml><body>
      <outline type="rss" title="Sprudge" xmlUrl="https://sprudge.com/feed"/>
      <outline type="rss" title="Sprudge mirror" xmlUrl="https://sprudge.com/feed"/>
    </body></opml>`;
    const result = parseOpml(xml);
    expect(result.rawCount).toBe(2);
    expect(result.feeds).toHaveLength(1);
    expect(result.feeds[0]?.title).toBe("Sprudge");
  });

  it("falls back to host when title and text are absent", () => {
    const xml = `<opml><body>
      <outline type="rss" xmlUrl="https://example.com/path/feed.xml"/>
    </body></opml>`;
    const result = parseOpml(xml);
    expect(result.feeds[0]?.title).toBe("example.com");
  });

  it("decodes XML entities in attribute values", () => {
    const xml = `<opml><body>
      <outline type="rss" title="Tom &amp; Jerry" xmlUrl="https://tj.example/feed?a=1&amp;b=2"/>
    </body></opml>`;
    const result = parseOpml(xml);
    expect(result.feeds[0]?.title).toBe("Tom & Jerry");
    expect(result.feeds[0]?.url).toBe("https://tj.example/feed?a=1&b=2");
  });

  it("strips a UTF-8 BOM if present", () => {
    const xml = `﻿<opml><body>
      <outline type="rss" title="X" xmlUrl="https://x.example/feed"/>
    </body></opml>`;
    expect(parseOpml(xml).feeds).toHaveLength(1);
  });

  it("exposes a sane import cap for the picker", () => {
    expect(OPML_IMPORT_CAP).toBeGreaterThan(0);
    expect(OPML_IMPORT_CAP).toBeLessThanOrEqual(50);
  });
});
