/**
 * Regenerate the three headline alternates on a drafted post.
 *
 * Same voice profile, same body, fresh angles. The model sees every
 * headline the user has already rejected (current primary + current
 * alternates) and is told to avoid those framings; the failure mode
 * we design against is "three more variations of the same line".
 *
 * The current `headline` is preserved as primary. Only `headline_alternates`
 * is rewritten. The user picks a new alternate via the existing
 * `selectDraftHeadlineAction` flow, which keeps the swap atomic with no
 * second action surface to maintain.
 */

import { db } from "../db";
import { createAnthropicClient, extractText, LocalClaudeError } from "../anthropic";
import { getAnthropicDraftModel } from "./settings";
import {
  newSourceNonce,
  renderUntrustedPromptBlock,
  untrustedSourceContract,
} from "./prompt-safety";

const MAX_BODY_CONTEXT_CHARS = 1200;
const ALTERNATES_PER_REROLL = 3;

export interface RerollInput {
  draftId: string;
  userId: string;
}

export interface RerollResult {
  alternates: string[];
  /** True when the reroll fell back to the no-auth stub (no API key, no CLI). */
  isStub: boolean;
}

export class HeadlineRerollError extends Error {
  constructor(
    message: string,
    readonly code: "not-found" | "locked" | "invalid",
  ) {
    super(message);
  }
}

/**
 * Build the headline-reroll prompt. Exported for tests; the real entry
 * point is `rerollHeadlines`.
 */
export function buildRerollPrompt(opts: {
  styleSheet: string;
  description: string | null;
  bannedTerms: string[];
  signatureTerms: string[];
  bodyExcerpt: string;
  rejected: string[];
}): { systemPrompt: string; userMessage: string } {
  const descriptionBlock = opts.description ? `BLOG IDENTITY: ${opts.description}\n\n` : "";

  const bannedBlock =
    opts.bannedTerms.length > 0
      ? `BANNED TERMS (do not use): ${opts.bannedTerms.join(", ")}`
      : "BANNED TERMS: ostensibly, delve, moreover, crucial, leverage (verb), utilize";

  const signatureBlock =
    opts.signatureTerms.length > 0
      ? `\nSIGNATURE TERMS (the writer's vocabulary; reuse where it fits): ${opts.signatureTerms.join(
          ", ",
        )}`
      : "";

  const sourceNonce = newSourceNonce();
  const rejectedBlock = opts.rejected.map((h, i) => `  ${i + 1}. ${h}`).join("\n");
  const draftBlock = renderUntrustedPromptBlock(
    "source",
    sourceNonce,
    [
      { label: "REJECTED HEADLINES", value: rejectedBlock || "(none)", byteCap: 2000 },
      { label: "DRAFT BODY", value: opts.bodyExcerpt, byteCap: MAX_BODY_CONTEXT_CHARS },
    ],
    { attributes: { index: 1 } },
  );

  const systemPrompt = `You write headlines that match a specific writer's voice for a draft they've already written.

${descriptionBlock}VOICE STYLE SHEET:
${opts.styleSheet}

${bannedBlock}${signatureBlock}

CONSTRAINTS:
- Em-dashes are forbidden. Use semicolons or new sentences.
- No clickbait, no sensational openers, no marketing voice.
- Lead with a concrete noun or claim; no setup-then-reveal.
- Each headline is a different angle on the draft, not a rephrasing of the others.
- None may share the framing of any REJECTED HEADLINE. Pick a new entry point: a different subject, a different stance, a different beat. Do not repeat the rhetorical move that produced the rejected lines.
- ${untrustedSourceContract(sourceNonce)}
- Output strictly the JSON envelope below. No prose before or after.`;

  const userMessage = `${draftBlock}

Return ${ALTERNATES_PER_REROLL} fresh headlines as JSON:
{"headlines": ["string", "string", "string"]}`;

  return { systemPrompt, userMessage };
}

export async function rerollHeadlines(input: RerollInput): Promise<RerollResult> {
  const r = await db.execute({
    sql: `SELECT id, headline, headline_alternates, body, outlet_id, wp_post_id
          FROM drafts WHERE id = ? AND user_id = ?`,
    args: [input.draftId, input.userId],
  });
  if (r.rows.length === 0) {
    throw new HeadlineRerollError("Draft not found.", "not-found");
  }
  const row = r.rows[0]!;
  if (row.wp_post_id) {
    throw new HeadlineRerollError(
      "Headline already sent to WordPress. Edit the title in WordPress.",
      "locked",
    );
  }

  const currentHeadline = String(row.headline ?? "");
  const currentAlternates: string[] = row.headline_alternates
    ? JSON.parse(String(row.headline_alternates))
    : [];
  const rejected = dedupeKeepOrder(
    [currentHeadline, ...currentAlternates].filter((s) => s.trim().length > 0),
  );
  const bodyExcerpt = stripHtml(String(row.body ?? "")).slice(0, MAX_BODY_CONTEXT_CHARS);
  const outletId = String(row.outlet_id ?? "");

  const profile = await loadVoiceFields(outletId, input.userId);
  const prompt = buildRerollPrompt({
    styleSheet: profile.styleSheet,
    description: profile.description,
    bannedTerms: profile.bannedTerms,
    signatureTerms: profile.signatureTerms,
    bodyExcerpt,
    rejected,
  });

  const generated = await callModel(input.userId, prompt);
  const fresh = dedupeKeepOrder(
    generated.headlines
      .map((h) => h.trim())
      .filter((h) => h.length > 0)
      .filter((h) => !rejected.some((r) => sameHeadline(r, h))),
  ).slice(0, ALTERNATES_PER_REROLL);

  // If the model handed back nothing usable (collapsed onto rejected set,
  // or returned empties), keep the previous alternates rather than wiping
  // the only working escape hatch. The button just acts as a no-op; the
  // caller can show "no fresh angles found" if it wants to.
  const nextAlternates = fresh.length > 0 ? fresh : currentAlternates;

  if (fresh.length > 0) {
    await db.execute({
      sql: `UPDATE drafts
            SET headline_alternates = ?, edited_at = ?
            WHERE id = ? AND user_id = ?`,
      args: [JSON.stringify(nextAlternates), Date.now(), input.draftId, input.userId],
    });
  }

  return { alternates: nextAlternates, isStub: generated.isStub };
}

interface VoiceFields {
  styleSheet: string;
  description: string | null;
  bannedTerms: string[];
  signatureTerms: string[];
}

async function loadVoiceFields(outletId: string, userId: string): Promise<VoiceFields> {
  if (!outletId) return defaults();
  const r = await db.execute({
    sql: `SELECT style_sheet_yaml, description, banned_terms, signature_terms
          FROM voice_profiles WHERE outlet_id = ? AND user_id = ?`,
    args: [outletId, userId],
  });
  if (r.rows.length === 0) return defaults();
  const row = r.rows[0]!;
  return {
    styleSheet: String(row.style_sheet_yaml ?? "") || defaultStyleSheet(),
    description: row.description ? String(row.description) : null,
    bannedTerms: row.banned_terms ? JSON.parse(String(row.banned_terms)) : [],
    signatureTerms: row.signature_terms ? JSON.parse(String(row.signature_terms)) : [],
  };
}

function defaults(): VoiceFields {
  return {
    styleSheet: defaultStyleSheet(),
    description: null,
    bannedTerms: [],
    signatureTerms: [],
  };
}

function defaultStyleSheet(): string {
  return `tone: direct, opinionated, no marketing voice
sentence_length_mean: 18 words
sentence_length_variance: high
hedge_frequency: low
em_dash_density: 0
opener_pattern: declarative noun-first
closer_pattern: single-sentence kicker`;
}

interface ModelResult {
  headlines: string[];
  isStub: boolean;
}

async function callModel(
  userId: string,
  prompt: {
    systemPrompt: string;
    userMessage: string;
  },
): Promise<ModelResult> {
  const { client } = await createAnthropicClient(userId);
  if (!client) return stub();

  const model = await getAnthropicDraftModel(userId);
  try {
    const message = await client.messages.create({
      model,
      max_tokens: 400,
      system: prompt.systemPrompt,
      messages: [{ role: "user", content: prompt.userMessage }],
    });
    return { headlines: parseHeadlines(extractText(message)), isStub: false };
  } catch (err) {
    if (err instanceof LocalClaudeError && err.kind === "auth") {
      return stub();
    }
    throw err;
  }
}

function stub(): ModelResult {
  return {
    headlines: [
      "Reroll skeleton (no API key configured)",
      "Set ANTHROPIC_API_KEY to wire the real reroll",
      "Local dev placeholder for headline reroll",
    ],
    isStub: true,
  };
}

function parseHeadlines(text: string): string[] {
  const cleaned = text
    .replace(/^\s*```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        parsed = JSON.parse(m[0]);
      } catch {
        parsed = {};
      }
    }
  }
  const list = Array.isArray(parsed.headlines) ? parsed.headlines : [];
  return list.map((h) => String(h));
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function dedupeKeepOrder(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    const key = v.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out;
}

function sameHeadline(a: string, b: string): boolean {
  return normalize(a) === normalize(b);
}

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
