import { describe, expect, it } from "vitest";
import { draftMaxTokens, parseDraftJsonEnvelope } from "../draft-generator";

describe("parseDraftJsonEnvelope", () => {
  it("extracts a fenced draft envelope", () => {
    const parsed = parseDraftJsonEnvelope(`\`\`\`json
{
  "headline": "A concrete headline",
  "headline_alternates": ["One", "Two", "Three"],
  "body": "<p>Body with <a href=\\"https://example.com\\">a source</a>.</p>",
  "quotes": [{"source_index": 1, "text": "quoted words", "citation": "https://example.com"}],
  "angle_archive": "archive hook",
  "angle_gap": "gap hook"
}
\`\`\``);

    expect(parsed.headline).toBe("A concrete headline");
    expect(parsed.headlineAlternates).toEqual(["One", "Two", "Three"]);
    expect(parsed.body).toContain("<p>");
    expect(parsed.quotes).toEqual([
      { sourceId: "1", text: "quoted words", citation: "https://example.com" },
    ]);
    expect(parsed.angleArchive).toBe("archive hook");
    expect(parsed.angleGap).toBe("gap hook");
  });

  it("handles a missing opening brace from assistant-prefilled JSON", () => {
    const parsed = parseDraftJsonEnvelope(`
  "headline": "Prefilled headline",
  "headline_alternates": [],
  "body": "<p>Body.</p>",
  "quotes": [],
  "angle_archive": null,
  "angle_gap": null
}`);

    expect(parsed.headline).toBe("Prefilled headline");
    expect(parsed.body).toBe("<p>Body.</p>");
  });

  it("recovers a draft body with unescaped HTML attributes and quote marks", () => {
    const parsed = parseDraftJsonEnvelope(`{
  "headline": "A source-backed draft",
  "headline_alternates": ["Alt one", "Alt two"],
  "body": "<p>"Quoted words" appear with <a href="https://example.com/story">source</a> attribution.</p>",
  "quotes": [{"source_index": 1, "text": "Quoted words", "citation": "https://example.com/story"}],
  "angle_archive": "archive hook",
  "angle_gap": "gap hook"
}`);

    expect(parsed.headline).toBe("A source-backed draft");
    expect(parsed.headlineAlternates).toEqual(["Alt one", "Alt two"]);
    expect(parsed.body).toContain('href="https://example.com/story"');
    expect(parsed.body).toContain('"Quoted words"');
    expect(parsed.quotes).toEqual([
      { sourceId: "1", text: "Quoted words", citation: "https://example.com/story" },
    ]);
    expect(parsed.angleArchive).toBe("archive hook");
    expect(parsed.angleGap).toBe("gap hook");
  });
});

describe("draftMaxTokens", () => {
  it("keeps enough output headroom for the HTML JSON envelope", () => {
    expect(draftMaxTokens(100)).toBe(1800);
    expect(draftMaxTokens(1000)).toBe(3200);
    expect(draftMaxTokens(2000)).toBe(5200);
  });
});
