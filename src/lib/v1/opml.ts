/**
 * OPML parsing for the import-on-onboarding flow.
 *
 * OPML files are XML lists of feeds. Each feed is an <outline type="rss">
 * element with `xmlUrl` (the feed URL) and either `title` or `text` (the
 * label). Outlines can be nested under group outlines that have no xmlUrl;
 * the group's title becomes the suggested folder name for its children.
 *
 * We parse with a regex pass rather than pulling in a DOM parser. The shape
 * matches src/lib/v1/source-title.ts; OPML is small and well-formed enough
 * that a stricter parser is not worth the dependency.
 */

/** Hard cap on a single OPML import. Bulk-importing dozens of feeds is the
 * fastest path to slop, so the picker forces the user to triage. */
export const OPML_IMPORT_CAP = 10;

export interface OpmlFeed {
  url: string;
  title: string;
  /** Group outline title that contained this feed, when present. */
  groupTitle: string | null;
}

export interface OpmlParseResult {
  feeds: OpmlFeed[];
  /** Total <outline> nodes with xmlUrl, before dedupe. Useful for "imported X of Y" messaging. */
  rawCount: number;
}

const OUTLINE_RE = /<outline\b([^>]*?)(?:\/>|>)/gi;

export function parseOpml(xml: string): OpmlParseResult {
  if (!xml || !xml.trim()) return { feeds: [], rawCount: 0 };
  let body = xml;
  if (body.charCodeAt(0) === 0xfeff) body = body.slice(1);

  // Track the stack of open group titles so feeds inside a group inherit it.
  // We walk linearly; each <outline> with xmlUrl is a feed. A non-self-closing
  // outline without xmlUrl opens a group; the matching </outline> closes it.
  const groupStack: string[] = [];
  const feeds: OpmlFeed[] = [];
  let rawCount = 0;
  const seen = new Set<string>();

  // Tokenize by outline open/close so the depth tracking is correct even
  // when a single outline tag spans multiple lines. We use a manual scan
  // because OUTLINE_RE only matches openings/self-closings.
  let i = 0;
  while (i < body.length) {
    const openIdx = body.indexOf("<", i);
    if (openIdx === -1) break;
    const tagStart = openIdx + 1;
    if (body[tagStart] === "/") {
      // Closing tag.
      const tagEnd = body.indexOf(">", tagStart);
      if (tagEnd === -1) break;
      const name = body.slice(tagStart + 1, tagEnd).trim().toLowerCase();
      if (name === "outline" && groupStack.length > 0) groupStack.pop();
      i = tagEnd + 1;
      continue;
    }
    const tagEnd = body.indexOf(">", tagStart);
    if (tagEnd === -1) break;
    const rawTag = body.slice(tagStart, tagEnd);
    const match = /^outline\b([\s\S]*)$/i.exec(rawTag);
    if (!match) {
      i = tagEnd + 1;
      continue;
    }
    const attrsBlob = match[1] ?? "";
    const selfClosing = attrsBlob.trim().endsWith("/");
    const attrs = parseAttrs(attrsBlob);
    const xmlUrl = attrs.get("xmlurl");
    if (xmlUrl) {
      rawCount += 1;
      const url = decodeAttr(xmlUrl).trim();
      if (url && !seen.has(url)) {
        seen.add(url);
        const title =
          decodeAttr(attrs.get("title") ?? attrs.get("text") ?? "").trim() ||
          hostFromUrl(url);
        const groupTitle =
          groupStack.length > 0 ? groupStack[groupStack.length - 1]! : null;
        feeds.push({ url, title, groupTitle });
      }
    } else if (!selfClosing) {
      // Group outline — push its label so descendant feeds inherit it.
      const label =
        decodeAttr(attrs.get("title") ?? attrs.get("text") ?? "").trim();
      groupStack.push(label || "");
    }
    i = tagEnd + 1;
  }

  return { feeds, rawCount };
}

const ATTR_RE = /([a-zA-Z_:][\w:.-]*)\s*=\s*("([^"]*)"|'([^']*)')/g;

function parseAttrs(blob: string): Map<string, string> {
  const out = new Map<string, string>();
  let m: RegExpExecArray | null;
  while ((m = ATTR_RE.exec(blob)) !== null) {
    const key = m[1]!.toLowerCase();
    const val = m[3] ?? m[4] ?? "";
    out.set(key, val);
  }
  return out;
}

function decodeAttr(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function hostFromUrl(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url;
  }
}
