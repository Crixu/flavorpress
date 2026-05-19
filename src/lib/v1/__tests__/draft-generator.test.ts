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
});

describe("draftMaxTokens", () => {
  it("keeps enough output headroom for the HTML JSON envelope", () => {
    expect(draftMaxTokens(100)).toBe(1800);
    expect(draftMaxTokens(1000)).toBe(3200);
    expect(draftMaxTokens(2000)).toBe(5200);
  });
});
