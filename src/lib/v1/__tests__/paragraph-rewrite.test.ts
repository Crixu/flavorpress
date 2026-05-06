import { describe, expect, it } from "vitest";
import {
  buildRewritePrompt,
  replaceParagraphInBody,
  splitParagraphs,
  ParagraphRewriteError,
} from "../paragraph-rewrite";
import type { Item } from "../types";

function makeItem(overrides: Partial<Item> = {}): Item {
  return {
    id: "i1",
    sourceId: "s1",
    userId: "u1",
    canonicalUrl: "https://example.com/post-1",
    contentHash: "h",
    doi: null,
    title: "Original headline",
    lede: "A short lede summarising the source.",
    body: null,
    authors: null,
    publishedAt: 0,
    fetchedAt: 0,
    entities: null,
    clusterId: "c1",
    ...overrides,
  };
}

describe("splitParagraphs", () => {
  it("returns top-level paragraphs in document order", () => {
    const html =
      '<p>One.</p><p>Two with <a href="#x">link</a>.</p><blockquote>Q</blockquote><p>Three.</p>';
    const spans = splitParagraphs(html);
    expect(spans).toHaveLength(3);
    expect(spans.map((s) => s.index)).toEqual([0, 1, 2]);
    expect(spans[0]!.innerHtml).toBe("One.");
    expect(spans[1]!.innerHtml).toContain("link");
    expect(spans[2]!.innerHtml).toBe("Three.");
  });

  it("skips blockquotes and other block-level wrappers", () => {
    const html = "<blockquote>Quote</blockquote><p>Body.</p>";
    const spans = splitParagraphs(html);
    expect(spans).toHaveLength(1);
    expect(spans[0]!.innerHtml).toBe("Body.");
  });

  it("does not count paragraphs nested inside blockquotes", () => {
    const html = "<p>Intro.</p><blockquote><p>Quoted aside.</p></blockquote><p>Body.</p>";
    const spans = splitParagraphs(html);
    expect(spans).toHaveLength(2);
    expect(spans.map((s) => s.innerHtml)).toEqual(["Intro.", "Body."]);
  });

  it("returns empty for body with no paragraphs", () => {
    expect(splitParagraphs("")).toHaveLength(0);
    expect(splitParagraphs("<div>no paragraphs</div>")).toHaveLength(0);
  });
});

describe("replaceParagraphInBody", () => {
  it("replaces the targeted paragraph and leaves siblings untouched", () => {
    const html = "<p>One.</p><p>Two.</p><p>Three.</p>";
    const next = replaceParagraphInBody(html, 1, "Two rewritten.");
    expect(next).toBe("<p>One.</p><p>Two rewritten.</p><p>Three.</p>");
  });

  it("strips a wrapping <p> if the model returned one", () => {
    const html = "<p>One.</p><p>Two.</p>";
    const next = replaceParagraphInBody(html, 0, "<p>One rewritten.</p>");
    expect(next).toBe("<p>One rewritten.</p><p>Two.</p>");
  });

  it("preserves inline anchor tags in the new content", () => {
    const html = "<p>Old.</p>";
    const next = replaceParagraphInBody(html, 0, 'New <a href="https://x.test">cite</a>.');
    expect(next).toBe('<p>New <a href="https://x.test">cite</a>.</p>');
  });

  it("sanitizes replacement HTML before composing the body", () => {
    const html = "<p>Old.</p>";
    const next = replaceParagraphInBody(
      html,
      0,
      '<p onclick="alert(1)">New <a href="javascript:alert(1)">bad</a><script>alert(1)</script><a href="https://x.test" class="x">cite</a>.</p>',
    );
    expect(next).toBe('<p>New bad<a href="https://x.test">cite</a>.</p>');
  });

  it("replaces by visible top-level paragraph index when quotes contain paragraphs", () => {
    const html = "<p>Intro.</p><blockquote><p>Quoted aside.</p></blockquote><p>Body.</p>";
    const next = replaceParagraphInBody(html, 1, "Body rewritten.");
    expect(next).toBe(
      "<p>Intro.</p><blockquote><p>Quoted aside.</p></blockquote><p>Body rewritten.</p>",
    );
  });

  it("throws when the index is out of range", () => {
    const html = "<p>Only.</p>";
    expect(() => replaceParagraphInBody(html, 5, "x")).toThrow(ParagraphRewriteError);
  });
});

describe("buildRewritePrompt", () => {
  const baseInput = {
    styleSheet: "tone: direct",
    description: "A blog about regional Texas barbecue.",
    bannedTerms: ["delve", "leverage"],
    signatureTerms: ["pitmaster", "smokehouse"],
    items: [makeItem({ title: "Pit news", canonicalUrl: "https://example.com/pit" })],
    originalParagraphHtml: "The pitmaster opened a new smokehouse in Lockhart.",
    surroundingContext: "PREVIOUS PARAGRAPH:\nIntro about Texas BBQ.",
  };

  it("includes blog identity, banned terms, and signature terms", () => {
    const { systemPrompt } = buildRewritePrompt(baseInput);
    expect(systemPrompt).toContain("regional Texas barbecue");
    expect(systemPrompt).toContain("delve, leverage");
    expect(systemPrompt).toContain("pitmaster, smokehouse");
  });

  it("includes the source bundle wrapped in untrusted tags", () => {
    const { userMessage } = buildRewritePrompt(baseInput);
    expect(userMessage).toContain('untrusted="true"');
    expect(userMessage).toContain("https://example.com/pit");
    expect(userMessage).toContain("Pit news");
  });

  it("includes the original paragraph and surrounding context", () => {
    const { userMessage } = buildRewritePrompt(baseInput);
    expect(userMessage).toContain("ORIGINAL PARAGRAPH");
    expect(userMessage).toContain("opened a new smokehouse");
    expect(userMessage).toContain("PREVIOUS PARAGRAPH");
  });

  it("forbids em-dashes and requires a single paragraph in the output", () => {
    const { systemPrompt } = buildRewritePrompt(baseInput);
    expect(systemPrompt).toContain("Em-dashes are forbidden");
    expect(systemPrompt).toContain("Replace exactly one paragraph");
  });

  it("requires source links in rewrites that reference a source", () => {
    const { systemPrompt } = buildRewritePrompt(baseInput);
    expect(systemPrompt).toContain("link it inline as <a");
  });

  it("falls back to the default banned-terms set when none are configured", () => {
    const { systemPrompt } = buildRewritePrompt({ ...baseInput, bannedTerms: [] });
    expect(systemPrompt).toContain("ostensibly");
  });

  it("requests the JSON envelope shape", () => {
    const { userMessage } = buildRewritePrompt(baseInput);
    expect(userMessage).toContain('"paragraph"');
  });
});
