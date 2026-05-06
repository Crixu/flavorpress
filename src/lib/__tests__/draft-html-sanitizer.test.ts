import { describe, expect, it } from "vitest";
import { sanitizeDraftHtml } from "../draft-html-sanitizer";

describe("sanitizeDraftHtml", () => {
  it("preserves expected editorial HTML", () => {
    const html = [
      "<h2>Heading</h2>",
      "<h3>Question heading</h3>",
      '<p>Text with <strong>bold</strong>, <em>emphasis</em>, <a href="https://example.com/a?b=1&amp;c=2">source</a>, and <a href="mailto:me@example.com">mail</a>.<br></p>',
      "<blockquote>Quote <cite>Source</cite></blockquote>",
      "<ul><li>One</li></ul>",
      "<ol><li>Two</li></ol>",
    ].join("");

    expect(sanitizeDraftHtml(html)).toBe(
      '<h2>Heading</h2><h3>Question heading</h3><p>Text with <strong>bold</strong>, <em>emphasis</em>, <a href="https://example.com/a?b=1&c=2">source</a>, and <a href="mailto:me@example.com">mail</a>.<br></p><blockquote>Quote <cite>Source</cite></blockquote><ul><li>One</li></ul><ol><li>Two</li></ol>',
    );
  });

  it("drops active content and strips unsafe attributes", () => {
    const html =
      '<p onclick="alert(1)" class="lead" id="x" style="color:red">Hello <strong style="font-weight:900">bold</strong><script>alert(1)</script><style>p{color:red}</style><iframe src="https://evil.test">frame</iframe><span data-x="1">span</span></p>';

    expect(sanitizeDraftHtml(html)).toBe("<p>Hello <strong>bold</strong>span</p>");
  });

  it("keeps only http, https, and mailto hrefs", () => {
    const html =
      '<p><a href="javascript:alert(1)">script</a> <a href="data:text/html,hi">data</a> <a href="/relative">relative</a> <a href="https://example.com/post" target="_blank" rel="noopener">good</a> <a href="mailto:me@example.com">mail</a></p>';

    expect(sanitizeDraftHtml(html)).toBe(
      '<p>script data relative <a href="https://example.com/post">good</a> <a href="mailto:me@example.com">mail</a></p>',
    );
  });
});
