/**
 * Notes mode. Same input as the drafter (a fired cluster), but the
 * output is raw material the user can write *from*: a handful of angle
 * ideas, verbatim quotes with attribution, and discrete factual claims
 * with source links. The user writes the prose; we never ghost-write
 * the body. This is the strongest expression of the no-slop rule.
 *
 * Internally the draft row's `mode` column still stores 'researcher'
 * for backward compatibility with existing data; treat that string as
 * the stable key for this feature.
 */

import { db, ensureSchema } from "../db";
import { createAnthropicApiClient } from "../anthropic";
import { getBus } from "./event-bus";
import { newTraceId, traceLogger } from "./trace";
import { getClusterItems } from "./cluster-engine";
import { canonicalize } from "./source-connector";
import { getAnthropicApiKey, getAnthropicDraftModel } from "./settings";
import { adjustClusterSourceTrust, TRUST_DELTA } from "./trust";
import { sanitizeDraftHtml } from "../draft-html-sanitizer";
import { newSourceNonce, renderUntrustedSource, untrustedSourceContract } from "./prompt-safety";
import type { DraftRenderedPayload, Item } from "./types";

const CAPABILITY_VERSION = "1.0.0";
const MAX_TOTAL_QUOTES = 12;

export interface NotesInput {
  clusterId: string;
  userId: string;
  outletId: string;
  capabilityVersion?: string;
}

export interface NoteIdea {
  angle: string;
  rationale: string;
}

export interface NoteFact {
  text: string;
  sourceUrl: string;
}

export interface NoteQuote {
  text: string;
  speaker: string | null;
  sourceUrl: string;
}

export interface Notes {
  topic: string;
  ideas: NoteIdea[];
  quotes: NoteQuote[];
  facts: NoteFact[];
}

export interface NotesOutput {
  draftId: string;
  topic: string;
  notes: Notes;
  traceId: string;
}

export async function generateNotes(input: NotesInput): Promise<NotesOutput> {
  await ensureSchema();
  const traceId = newTraceId();
  const log = traceLogger(traceId, input.userId);
  await log.info("notes.generate", "starting", { clusterId: input.clusterId });

  const items = await getClusterItems(input.clusterId, input.userId);
  if (items.length === 0) throw new Error(`cluster has no items: ${input.clusterId}`);

  const prompt = buildPrompt(items, input.userId);
  await log.info("notes.generate", "prompt assembled", {
    sourceCount: items.length,
    sourceNonce: prompt.sourceNonce,
  });
  const rawNotes = await runOnce(prompt, log, input.userId);
  const notes = groundNotes(rawNotes, items);

  await log.info("notes.generate", "complete", {
    ideas: notes.ideas.length,
    quotes: notes.quotes.length,
    facts: notes.facts.length,
    droppedQuotes: rawNotes.quotes.length - notes.quotes.length,
    droppedFacts: rawNotes.facts.length - notes.facts.length,
  });

  const draftId = crypto.randomUUID();
  const bodyHtml = sanitizeDraftHtml(renderNotesHtml(notes));
  const quotesForCol = notes.quotes.map((q) => ({
    sourceId: q.sourceUrl,
    text: q.text,
    citation: q.sourceUrl,
  }));

  await db.execute({
    sql: `INSERT INTO drafts
          (id, cluster_id, user_id, outlet_id, capability_version_pin, mode,
           headline, headline_alternates, body, quotes, notes,
           voice_match_score, angle_archive, angle_gap, trace_id, created_at, state)
          VALUES (?, ?, ?, ?, ?, 'researcher', ?, ?, ?, ?, ?, 0, NULL, NULL, ?, ?, 'pre-rendered')`,
    args: [
      draftId,
      input.clusterId,
      input.userId,
      input.outletId,
      input.capabilityVersion ?? CAPABILITY_VERSION,
      notes.topic,
      JSON.stringify([]),
      bodyHtml,
      JSON.stringify(quotesForCol),
      JSON.stringify(notes),
      traceId,
      Date.now(),
    ],
  });

  // Notes don't consume the cluster the way a drafter post does; the
  // user may still want to draft from it. Leave the cluster in 'fired'
  // state so it stays on Today. Trust still bumps because the user engaged.
  await adjustClusterSourceTrust(input.clusterId, TRUST_DELTA.draftCreated, input.userId);

  await getBus().emit<DraftRenderedPayload>(
    "draft.rendered",
    {
      draftId,
      clusterId: input.clusterId,
      voiceMatchScore: 0,
      cached: false,
    },
    {
      userId: input.userId,
      traceId,
      capabilityId: "notes-generator",
      capabilityVersion: CAPABILITY_VERSION,
      idempotencyKey: `draft.rendered:${draftId}`,
    },
  );

  return { draftId, topic: notes.topic, notes, traceId };
}

/**
 * Re-roll just the ideas section of an existing notes blob. Quotes
 * and facts (the grounded, slop-sensitive part) stay untouched; the
 * model only re-imagines the angles. Used by the "Remix ideas" button
 * on the notebook view.
 */
export async function remixIdeas(input: {
  clusterId: string;
  userId: string;
  current: Notes;
}): Promise<NoteIdea[]> {
  const traceId = newTraceId();
  const log = traceLogger(traceId, input.userId);
  await log.info("notes.remix-ideas", "starting", { clusterId: input.clusterId });

  const items = await getClusterItems(input.clusterId, input.userId);
  if (items.length === 0) throw new Error(`cluster has no items: ${input.clusterId}`);

  const apiKey = await getAnthropicApiKey(input.userId);
  if (!apiKey) {
    await log.warn("notes.remix-ideas", "no API key; returning current ideas");
    return input.current.ideas;
  }

  const model = await getAnthropicDraftModel(input.userId);
  const client = createAnthropicApiClient(apiKey, input.userId);
  const sourceNonce = newSourceNonce();
  const sourceBlock = renderSourceBlock(items, sourceNonce);
  const prior = input.current.ideas.map((i) => `- ${i.angle}`).join("\n");

  const systemPrompt = `You are a research assistant. The writer wants fresh angles on the same cluster of sources.

Output 3 to 5 NEW angle ideas, distinct from the ones already shown. No paraphrases of the prior list.

Each idea is one short sentence (the angle) and one short sentence (why it works). Same JSON envelope as before, but only the ideas array.

${untrustedSourceContract(sourceNonce)}

OUTPUT JSON ENVELOPE (exact shape):
{
  "ideas": [{"angle": "string", "rationale": "string"}]
}`;

  const userMessage = `Cluster source bundle:

${sourceBlock}

Prior ideas (do not repeat these framings):
${prior || "(none)"}

Return the new ideas JSON now.`;

  const response = await client.messages.create({
    model,
    max_tokens: 800,
    system: systemPrompt,
    messages: [{ role: "user", content: userMessage }],
  });
  const text = response.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  const parsed = parseLooseJson(text);
  const ideasRaw = Array.isArray(parsed.ideas) ? parsed.ideas : [];
  const ideas = ideasRaw
    .slice(0, 5)
    .map((i) => {
      const obj = i as Record<string, unknown>;
      return {
        angle: String(obj.angle ?? "").trim(),
        rationale: String(obj.rationale ?? "").trim(),
      };
    })
    .filter((i) => i.angle.length > 0);

  await log.info("notes.remix-ideas", "complete", { count: ideas.length });
  return ideas.length > 0 ? ideas : input.current.ideas;
}

/**
 * Pull additional verbatim quotes the writer hasn't seen yet, leaving
 * the existing ideas / facts / quotes intact. Caps total quote count at
 * MAX_TOTAL_QUOTES so the notebook view stays readable. Reuses groundNotes
 * so new quotes still pass the verbatim-and-attributed check.
 */
export async function extendQuotes(input: {
  clusterId: string;
  userId: string;
  current: Notes;
}): Promise<NoteQuote[]> {
  const traceId = newTraceId();
  const log = traceLogger(traceId, input.userId);
  await log.info("notes.more-quotes", "starting", { clusterId: input.clusterId });

  if (input.current.quotes.length >= MAX_TOTAL_QUOTES) {
    return input.current.quotes;
  }

  const items = await getClusterItems(input.clusterId, input.userId);
  if (items.length === 0) throw new Error(`cluster has no items: ${input.clusterId}`);

  const apiKey = await getAnthropicApiKey(input.userId);
  if (!apiKey) {
    await log.warn("notes.more-quotes", "no API key; returning current quotes");
    return input.current.quotes;
  }

  const remaining = MAX_TOTAL_QUOTES - input.current.quotes.length;
  const model = await getAnthropicDraftModel(input.userId);
  const client = createAnthropicApiClient(apiKey, input.userId);
  const sourceNonce = newSourceNonce();
  const sourceBlock = renderSourceBlock(items, sourceNonce);
  const prior = input.current.quotes.map((q) => `- "${q.text}" (${q.sourceUrl})`).join("\n");

  const systemPrompt = `You are a research assistant pulling additional verbatim quotes for a writer who already has a few.

Output up to ${remaining} NEW quotes. Verbatim only, exactly as written in the source. <=25 words each. Include speaker if attributed; include the source URL the quote was lifted from.

Do NOT repeat any of the prior quotes. Prefer quotes from sources that aren't already represented in the prior list.

${untrustedSourceContract(sourceNonce)}

OUTPUT JSON ENVELOPE (exact shape):
{
  "quotes": [{"text": "verbatim, <=25 words", "speaker": "string or null", "source_url": "string"}]
}`;

  const userMessage = `Cluster source bundle:

${sourceBlock}

Prior quotes (do not repeat):
${prior || "(none)"}

Return the new quotes JSON now.`;

  const response = await client.messages.create({
    model,
    max_tokens: 1200,
    system: systemPrompt,
    messages: [{ role: "user", content: userMessage }],
  });
  const text = response.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  const parsed = parseLooseJson(text);
  const quotesRaw = Array.isArray(parsed.quotes) ? parsed.quotes : [];
  const candidate: NoteQuote[] = quotesRaw
    .slice(0, remaining)
    .map((q) => {
      const obj = q as Record<string, unknown>;
      const speakerRaw = obj.speaker;
      return {
        text: String(obj.text ?? "").trim(),
        speaker:
          speakerRaw === null || speakerRaw === undefined || speakerRaw === ""
            ? null
            : String(speakerRaw),
        sourceUrl: String(obj.source_url ?? obj.sourceUrl ?? "").trim(),
      };
    })
    .filter((q) => q.text.length > 0 && q.sourceUrl.length > 0 && wordCount(q.text) <= 25);

  // Ground new quotes against source bytes; skip duplicates of existing
  // quotes (text+url match). Existing quotes can come from earlier
  // generations and shouldn't shadow the verbatim check.
  const merged: Notes = {
    ...input.current,
    quotes: candidate,
  };
  const grounded = groundNotes(merged, items).quotes;
  const existingKeys = new Set(input.current.quotes.map((q) => `${q.sourceUrl}::${q.text}`));
  const additions = grounded.filter((q) => !existingKeys.has(`${q.sourceUrl}::${q.text}`));

  await log.info("notes.more-quotes", "complete", {
    requested: remaining,
    added: additions.length,
  });

  // Combined still respects "one quote per source url" because groundNotes
  // applied per-source dedupe to the candidate set; we union with existing
  // ones explicitly here.
  const usedUrls = new Set(input.current.quotes.map((q) => q.sourceUrl));
  const combined = [...input.current.quotes];
  for (const q of additions) {
    if (usedUrls.has(q.sourceUrl)) continue;
    combined.push(q);
    usedUrls.add(q.sourceUrl);
    if (combined.length >= MAX_TOTAL_QUOTES) break;
  }
  return combined;
}

/**
 * Re-render the body HTML mirror after notes mutate (remix, more quotes,
 * etc.) so the WordPress handoff sees the latest state. Mirrors the
 * format used at initial draft creation.
 */
export function renderNotesBodyHtml(notes: Notes): string {
  return sanitizeDraftHtml(renderNotesHtml(notes));
}

function renderSourceBlock(items: Item[], sourceNonce: string): string {
  return items
    .map((item, i) =>
      renderUntrustedSource(
        {
          title: item.title,
          canonicalUrl: canonicalize(item.canonicalUrl),
          lede: item.lede,
          body: item.body,
        },
        sourceNonce,
        { index: i + 1, includeBody: true },
      ),
    )
    .join("\n\n");
}

function parseLooseJson(text: string): Record<string, unknown> {
  const cleaned = text
    .replace(/^\s*```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();
  try {
    return JSON.parse(cleaned) as Record<string, unknown>;
  } catch {
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (!m) return {};
    try {
      return JSON.parse(m[0]) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
}

interface Prompt {
  userId: string;
  systemPrompt: string;
  userMessage: string;
  sourceNonce: string;
}

function buildPrompt(items: Item[], userId: string): Prompt {
  const sourceNonce = newSourceNonce();
  const sourceBlock = renderSourceBlock(items, sourceNonce);

  const systemPrompt = `You are a research assistant for a writer who will write the post themselves.

Your job is NOT to write prose. Your job is to surface raw material the writer can choose from: a few distinct angles, verbatim quotes, and concrete factual claims with sources.

CONSTRAINTS:
- 3 to 5 angle ideas. Each is one short sentence (the angle) and one short sentence (why it works). Distinct framings, not paraphrases.
- 3 to 6 verbatim quotes. Each <= 25 words, exactly as written in the source. At most one quote per source URL. Include speaker if attributed. Include the source URL the quote was lifted from.
- 4 to 8 facts. Each is a single concrete claim (number, date, name, event), <= 25 words, with the source URL it came from. No opinions, no characterizations.
- Never invent facts or quotes. If a quote is not present verbatim in a source, omit it.
- Never paraphrase a quote and call it a quote.
- ${untrustedSourceContract(sourceNonce)}
- Output strictly the JSON envelope below. No prose before or after.

OUTPUT JSON ENVELOPE (exact shape):
{
  "topic": "one short noun phrase naming what this cluster is about",
  "ideas": [{"angle": "string", "rationale": "string"}],
  "quotes": [{"text": "verbatim, <=25 words", "speaker": "string or null", "source_url": "string"}],
  "facts": [{"text": "concrete claim, <=25 words", "source_url": "string"}]
}`;

  const userMessage = `Cluster source bundle:

${sourceBlock}

Return the notes JSON now.`;

  return { userId, systemPrompt, userMessage, sourceNonce };
}

async function runOnce(
  prompt: Prompt,
  log: ReturnType<typeof traceLogger>,
  userId: string,
): Promise<Notes> {
  const apiKey = await getAnthropicApiKey(userId);
  if (!apiKey) {
    await log.warn("notes.generate.run", "no API key; using stub");
    return stubNotes();
  }

  const model = await getAnthropicDraftModel(userId);
  const client = createAnthropicApiClient(apiKey, userId);
  const response = await client.messages.create({
    model,
    max_tokens: 2000,
    system: prompt.systemPrompt,
    messages: [{ role: "user", content: prompt.userMessage }],
  });

  const text = response.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  return parseNotes(text);
}

function parseNotes(text: string): Notes {
  const parsed = parseLooseJson(text);

  const topic = String(parsed.topic ?? "Notes");
  const ideasRaw = Array.isArray(parsed.ideas) ? parsed.ideas : [];
  const ideas = ideasRaw
    .slice(0, 5)
    .map((i) => {
      const obj = i as Record<string, unknown>;
      return {
        angle: String(obj.angle ?? "").trim(),
        rationale: String(obj.rationale ?? "").trim(),
      };
    })
    .filter((i) => i.angle.length > 0);

  const quotesRaw = Array.isArray(parsed.quotes) ? parsed.quotes : [];
  const quotes = quotesRaw
    .slice(0, 6)
    .map((q) => {
      const obj = q as Record<string, unknown>;
      const speakerRaw = obj.speaker;
      return {
        text: String(obj.text ?? "").trim(),
        speaker:
          speakerRaw === null || speakerRaw === undefined || speakerRaw === ""
            ? null
            : String(speakerRaw),
        sourceUrl: String(obj.source_url ?? obj.sourceUrl ?? "").trim(),
      };
    })
    .filter(
      (q) =>
        q.text.length > 0 &&
        q.sourceUrl.length > 0 &&
        // Drop oversize quotes rather than truncate them. A truncated quote is
        // a misquote (verbatim becomes partial), and copyright/no-slop both
        // depend on this cap holding. 25 words matches the drafter cap so
        // both modes agree on what counts as a fair-use pull.
        wordCount(q.text) <= 25,
    );

  const factsRaw = Array.isArray(parsed.facts) ? parsed.facts : [];
  const facts = factsRaw
    .slice(0, 8)
    .map((f) => {
      const obj = f as Record<string, unknown>;
      return {
        text: String(obj.text ?? "").trim(),
        sourceUrl: String(obj.source_url ?? obj.sourceUrl ?? "").trim(),
      };
    })
    .filter((f) => f.text.length > 0 && f.sourceUrl.length > 0 && wordCount(f.text) <= 25);

  return { topic, ideas, quotes, facts };
}

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Drop any quote or fact that the model couldn't actually source from the
 * cluster's items. URLs must match a known source; quote text must appear
 * verbatim in *the cited source's* bytes (not just somewhere in the
 * cluster, checking against any source would let a quote from article A
 * be misattributed to article B and still pass). Also caps quotes at one
 * per source URL so a single article can't fill the notebook view with
 * verbatim text. Blocks fabricated quotes, hallucinated URLs, prompt-
 * injected sources, and accidental misattribution.
 */
function groundNotes(notes: Notes, items: Item[]): Notes {
  // Map every URL the model could have cited (raw + canonicalized) back
  // to the per-source normalized corpus. Same slice as buildPrompt so we
  // accept exactly what the model saw.
  const corpusByUrl = new Map<string, string>();
  for (const item of items) {
    const head = `${item.title}\n${item.lede}`;
    const body = item.body ? item.body.slice(0, 4000) : "";
    const corpus = normalizeForVerbatim(`${head}\n${body}`);
    corpusByUrl.set(item.canonicalUrl, corpus);
    corpusByUrl.set(canonicalize(item.canonicalUrl), corpus);
  }

  const seenSources = new Set<string>();
  const quotes: NoteQuote[] = [];
  for (const q of notes.quotes) {
    const corpus = corpusByUrl.get(q.sourceUrl);
    if (!corpus) continue;
    const needle = normalizeForVerbatim(q.text);
    if (needle.length === 0) continue;
    if (!corpus.includes(needle)) continue;
    // One quote per source URL keeps a single article from dominating the
    // notebook view and matches the drafter's per-source cap.
    if (seenSources.has(q.sourceUrl)) continue;
    seenSources.add(q.sourceUrl);
    quotes.push(q);
  }

  const facts = notes.facts.filter((f) => corpusByUrl.has(f.sourceUrl));

  return { ...notes, quotes, facts };
}

function normalizeForVerbatim(text: string): string {
  // Smart-quote variants and whitespace are the two ways a real verbatim
  // quote slips its substring check. Lowercase covers proper-noun casing
  // drift on an otherwise faithful pull.
  return decodePromptXml(text)
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function decodePromptXml(s: string): string {
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderNotesHtml(notes: Notes): string {
  const parts: string[] = [];
  if (notes.ideas.length > 0) {
    parts.push("<h2>Ideas</h2><ul>");
    for (const idea of notes.ideas) {
      parts.push(
        `<li><strong>${escapeHtml(idea.angle)}</strong> - ${escapeHtml(idea.rationale)}</li>`,
      );
    }
    parts.push("</ul>");
  }
  if (notes.quotes.length > 0) {
    parts.push("<h2>Quotes</h2>");
    for (const q of notes.quotes) {
      const cite = q.speaker ? `${escapeHtml(q.speaker)}, ` : "";
      parts.push(
        `<blockquote>${escapeHtml(q.text)} <cite>${cite}<a href="${escapeHtml(
          q.sourceUrl,
        )}">source</a></cite></blockquote>`,
      );
    }
  }
  if (notes.facts.length > 0) {
    parts.push("<h2>Facts</h2><ul>");
    for (const f of notes.facts) {
      parts.push(`<li>${escapeHtml(f.text)} <a href="${escapeHtml(f.sourceUrl)}">source</a></li>`);
    }
    parts.push("</ul>");
  }
  return parts.join("\n");
}

function stubNotes(): Notes {
  return {
    topic: "Notes (no API key configured)",
    ideas: [
      {
        angle: "Set ANTHROPIC_API_KEY in /settings to see real ideas.",
        rationale: "This is a local-dev stub; the cluster pipeline ran fine.",
      },
    ],
    quotes: [],
    facts: [],
  };
}
