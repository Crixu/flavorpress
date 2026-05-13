/**
 * Auto-generate a friendly display name for a source.
 *
 * The bare host is often useless ("raw.githubusercontent.com" tells the user
 * nothing about which feed they pasted). We fetch the feed, pull a few signals
 * out of the XML (channel title, description, sample item titles), and ask
 * Claude to compress them into a short label. Cheap signal, smart compression.
 *
 * Fallback chain when the LLM call can't run (no API key, fetch failed,
 * non-XML response): feed channel title → URL host → URL itself.
 *
 * Runs once on add, in the background via `after()`. The user can always
 * override the result via the rename action on the source detail page.
 */

import { createAnthropicClient, extractText } from "../anthropic";
import { safeFetch, safeReadText } from "./safe-fetch";
import { getAnthropicDraftModel } from "./settings";

const FETCH_TIMEOUT_MS = 8000;

interface FeedSignals {
  channelTitle: string | null;
  channelDescription: string | null;
  itemTitles: string[];
}

export function hostFromUrl(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export async function generateSourceTitle(url: string): Promise<string> {
  const host = hostFromUrl(url);
  const xml = await tryFetchXml(url);
  const signals = xml ? extractFeedSignals(xml) : null;
  const fallback = signals?.channelTitle?.trim() || host;

  if (!signals) return fallback;

  // createAnthropicClient() can throw on misconfigured-CLI states
  // (FLAVORPRESS_LOCAL_CLAUDE=1 on Vercel, or flag forced without
  // `claude` installed). For non-critical helpers like this one, any
  // failure should silently fall back rather than 500 the source-add
  // flow it runs from.
  try {
    const { client } = await createAnthropicClient();
    if (!client) return fallback;
    const model = await getAnthropicDraftModel();
    const message = await client.messages.create({
      model,
      max_tokens: 60,
      system: `You name RSS feeds with a short, recognizable label. Output ONLY the label; no quotes, no preamble, no punctuation around it. Aim for 1-4 words. Match how the publication brands itself, not how a marketer would describe it. Skip filler like "blog", "feed", "news" unless it's part of the actual brand name. Skip the URL host unless that's how readers know the source.`,
      messages: [
        {
          role: "user",
          content: `URL: ${url}
HOST: ${host}
FEED TITLE: ${signals.channelTitle ?? "(none)"}
FEED DESCRIPTION: ${signals.channelDescription ?? "(none)"}
SAMPLE ITEM TITLES:
${
  signals.itemTitles
    .slice(0, 5)
    .map((t) => `- ${t}`)
    .join("\n") || "(none)"
}

Return the label.`,
        },
      ],
    });
    const text = extractText(message)
      .trim()
      .replace(/^["']|["']$/g, "");
    if (!text) return fallback;
    if (text.length > 80) return text.slice(0, 80).trim();
    return text;
  } catch {
    return fallback;
  }
}

async function tryFetchXml(url: string): Promise<string | null> {
  try {
    const res = await safeFetch(url, {
      timeoutMs: FETCH_TIMEOUT_MS,
      headers: {
        "User-Agent": "FlavorPressBot/1.0 (+https://flavorpress.io/bot; contact:lucas)",
        Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
      },
    });
    if (!res.ok) return null;
    let body = await safeReadText(res);
    if (body.charCodeAt(0) === 0xfeff) body = body.slice(1);
    return body;
  } catch {
    return null;
  }
}

/**
 * Pull channel-level metadata and the first few item titles out of an RSS or
 * Atom document. We deliberately ignore item descriptions; titles alone give
 * Claude enough to disambiguate.
 */
function extractFeedSignals(xml: string): FeedSignals {
  const channelScope =
    matchFirst(xml, /<channel\b[^>]*>([\s\S]*?)<\/channel>/i) ??
    matchFirst(xml, /<feed\b[^>]*>([\s\S]*?)<\/feed>/i) ??
    xml;

  const channelTitle = getTopLevelTag(channelScope, "title") ?? null;
  const channelDescription =
    getTopLevelTag(channelScope, "description") ?? getTopLevelTag(channelScope, "subtitle") ?? null;

  const itemBodies =
    matchAll(xml, /<item\b[^>]*>([\s\S]*?)<\/item>/gi) ??
    matchAll(xml, /<entry\b[^>]*>([\s\S]*?)<\/entry>/gi) ??
    [];
  const itemTitles = itemBodies
    .map((body) => getTopLevelTag(body, "title"))
    .filter((t): t is string => Boolean(t));

  return { channelTitle, channelDescription, itemTitles };
}

function matchFirst(text: string, re: RegExp): string | null {
  const m = text.match(re);
  return m ? m[1]! : null;
}

function matchAll(text: string, re: RegExp): string[] | null {
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m[1] !== undefined) out.push(m[1]);
  }
  return out.length > 0 ? out : null;
}

/**
 * Read a tag's text content. Skips the first item/entry inside the scope so
 * `<channel><title>Feed</title><item><title>Story</title></item></channel>`
 * resolves to "Feed", not "Story".
 */
function getTopLevelTag(text: string, tag: string): string | null {
  const stripped = text
    .replace(/<item\b[^>]*>[\s\S]*?<\/item>/gi, "")
    .replace(/<entry\b[^>]*>[\s\S]*?<\/entry>/gi, "");
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
  const m = stripped.match(re);
  if (!m) return null;
  return decodeAndStrip(m[1]!).trim() || null;
}

function decodeAndStrip(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, " ");
}
