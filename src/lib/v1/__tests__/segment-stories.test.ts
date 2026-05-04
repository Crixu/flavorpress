import { describe, expect, it } from "vitest";

import { segmentStories } from "../segment-stories";

const PARENT = "https://newsletter.example.com/issue-42";

function story(title: string, paragraph: string, link?: string): string {
  const a = link ? `<a href="${link}">${title}</a>` : "";
  return `<h2>${title}</h2><p>${paragraph} ${a}</p>`;
}

describe("segmentStories", () => {
  it("returns null for short HTML", () => {
    expect(segmentStories("<p>tiny</p>", PARENT)).toBeNull();
  });

  it("returns null for a single-story longread with two H2 sections", () => {
    const html = `
      <p>${"Long opening paragraph. ".repeat(40)}</p>
      <h2>Background</h2>
      <p>${"Section about background. ".repeat(40)}</p>
      <h2>What it means</h2>
      <p>${"Section about meaning. ".repeat(40)}</p>
    `;
    expect(segmentStories(html, PARENT)).toBeNull();
  });

  it("splits a roundup with three H2 stories each linking elsewhere", () => {
    const html = [
      story(
        "AI lab raises $5B",
        "Lab announces round led by sovereign fund. ".repeat(6),
        "https://example.org/ai-round",
      ),
      story(
        "Data center power crunch",
        "Utility companies warn that grid capacity will not keep pace. ".repeat(6),
        "https://example.net/grid",
      ),
      story(
        "Chip export controls",
        "New rules tighten exports of advanced chips to certain markets. ".repeat(6),
        "https://example.org/exports",
      ),
    ].join("");
    const out = segmentStories(html, PARENT);
    expect(out).not.toBeNull();
    expect(out!).toHaveLength(3);
    expect(out![0]!.title).toBe("AI lab raises $5B");
    expect(out![0]!.outboundLinks[0]!.url).toBe("https://example.org/ai-round");
    expect(out![1]!.title).toBe("Data center power crunch");
    expect(out![2]!.outboundLinks[0]!.url).toBe("https://example.org/exports");
  });

  it("collects outbound links from linked headings", () => {
    const shortSummary = "Short summary for this linked headline story. ".repeat(2);
    const html = [
      `<h2><a href="https://example.org/a">Story A</a></h2><p>${shortSummary}</p>`,
      `<h2><a href="https://example.org/b">Story B</a></h2><p>${shortSummary}</p>`,
      `<h2><a href="https://example.org/c">Story C</a></h2><p>${shortSummary}</p>`,
    ].join("");
    const out = segmentStories(html, PARENT);
    expect(out).not.toBeNull();
    expect(out!).toHaveLength(3);
    expect(out![0]!.outboundLinks[0]!.url).toBe("https://example.org/a");
    expect(out![1]!.outboundLinks[0]!.url).toBe("https://example.org/b");
    expect(out![2]!.outboundLinks[0]!.url).toBe("https://example.org/c");
  });

  it("drops non-web outbound links", () => {
    const html = [
      `<h2>One</h2><p>body ${"x ".repeat(30)} <a href="ftp://example.org/file">ftp</a></p>`,
      `<h2>Two</h2><p>body ${"x ".repeat(30)} <a href="data:text/html,hello">data</a></p>`,
      story("Three", "body. ".repeat(20), "https://example.org/three"),
    ].join("");
    const out = segmentStories(html, PARENT);
    expect(out).not.toBeNull();
    expect(out![0]!.outboundLinks).toEqual([]);
    expect(out![1]!.outboundLinks).toEqual([]);
    expect(out![2]!.outboundLinks[0]!.url).toBe("https://example.org/three");
  });

  it("drops boilerplate sections and still returns valid segments", () => {
    const html = [
      story(
        "Story one",
        "First substantive story body content. ".repeat(8),
        "https://example.org/one",
      ),
      story(
        "Story two",
        "Second substantive story body content. ".repeat(8),
        "https://example.org/two",
      ),
      story(
        "Story three",
        "Third substantive story body content. ".repeat(8),
        "https://example.org/three",
      ),
      `<h2>Subscribe</h2><p>Subscribe to our newsletter.</p>`,
    ].join("");
    const out = segmentStories(html, PARENT);
    expect(out).not.toBeNull();
    expect(out!).toHaveLength(3);
    expect(out!.every((s) => !/subscribe/i.test(s.title ?? ""))).toBe(true);
  });

  it("ignores same-host outbound links", () => {
    // Segment "One" has only an internal link; we make its body long enough
    // to survive the substantive-content filter on prose alone.
    const longBody = "Substantive paragraph content for the first story. ".repeat(8);
    const html = [
      story("One", longBody, "https://newsletter.example.com/internal"),
      story("Two", "body. ".repeat(20), "https://example.org/external-2"),
      story("Three", "body. ".repeat(20), "https://example.org/external-3"),
    ].join("");
    const out = segmentStories(html, PARENT);
    expect(out).not.toBeNull();
    expect(out![0]!.title).toBe("One");
    expect(out![0]!.outboundLinks).toEqual([]);
    expect(out![1]!.outboundLinks).toHaveLength(1);
  });

  it("skips mailto and javascript hrefs", () => {
    const html = [
      `<h2>One</h2><p>body ${"x ".repeat(30)} <a href="mailto:hi@example.com">mail</a></p>`,
      story("Two", "body. ".repeat(20), "https://example.org/two"),
      story("Three", "body. ".repeat(20), "https://example.org/three"),
    ].join("");
    const out = segmentStories(html, PARENT);
    expect(out).not.toBeNull();
    expect(out![0]!.outboundLinks).toEqual([]);
  });

  it("treats H3 as the split level when H2 is absent", () => {
    const html = [
      `<h1>Issue 42</h1>`,
      `<h3>Story A</h3><p>${"Body A. ".repeat(20)} <a href="https://example.org/a">link</a></p>`,
      `<h3>Story B</h3><p>${"Body B. ".repeat(20)} <a href="https://example.org/b">link</a></p>`,
      `<h3>Story C</h3><p>${"Body C. ".repeat(20)} <a href="https://example.org/c">link</a></p>`,
    ].join("");
    const out = segmentStories(html, PARENT);
    expect(out).not.toBeNull();
    expect(out!).toHaveLength(3);
  });
});
