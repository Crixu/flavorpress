import "server-only";

/**
 * Fact-check extension server half. Owns the Anthropic call, the
 * persistence in `fact_check_claims`, and the conversion from internal
 * FactCheckClaim rows to the generic ExtensionAnnotation shape that the
 * editor surface consumes.
 *
 * The model is asked to return claim_text as a verbatim substring of
 * the body so the article overlay can highlight without storing
 * fragile DOM offsets.
 */

import Anthropic from "@anthropic-ai/sdk";
import { db, ensureSchema } from "@/lib/db";
import { requireSession } from "@/lib/session";
import { extractText, extractJson } from "@/lib/anthropic";
import { sanitizeDraftHtml } from "@/lib/draft-html-sanitizer";
import { getAnthropicApiKey, getAnthropicDraftModel } from "@/lib/v1/settings";
import { wrapUntrustedSource } from "@/lib/v1/prompt-safety";
import type { ExtensionAnnotation, ServerExtensionEntry } from "../types";
import { FACT_CHECK_ID, MAX_CLAIMS, VERDICTS, type FactCheckClaim, type Verdict } from "./types";

interface ModelClaim {
  claim_text?: unknown;
  verdict?: unknown;
  comment?: unknown;
  source_url?: unknown;
  source_title?: unknown;
}

const SYSTEM_PROMPT = `You are a fact-checker for a personal blog draft. Identify the most check-worthy factual claims (numbers, dates, names of people or organizations, attributed quotes, causal statements). Skip opinions, value judgments, and the writer's framing.

For each claim, run web searches to verify it, then return a one-sentence assessment plus the single best source URL.

Hard rules:
- claim_text MUST be a verbatim substring of the draft body, copied character-for-character. Do not paraphrase. If the exact wording is awkward to highlight, pick a shorter substring that still conveys the claim.
- Pick at most ${MAX_CLAIMS} claims. Fewer is fine. Skip claims you cannot meaningfully verify.
- comment is one sentence, plain prose, no em-dashes (use semicolons or new sentences).
- verdict is exactly one of: supported, disputed, unverified.
- source_url is a real URL you actually visited via web search; null only when verdict is unverified.

Return JSON only, matching:
{"claims": [{"claim_text": "...", "verdict": "supported", "comment": "...", "source_url": "https://...", "source_title": "..."}]}`;

export async function runFactCheck(
  draftId: string,
): Promise<{ claims: FactCheckClaim[]; ranAt: number }> {
  const session = await requireSession();
  await ensureSchema();

  const draftRow = await db.execute({
    sql: `SELECT id, body FROM drafts WHERE id = ? AND user_id = ?`,
    args: [draftId, session.userId],
  });
  if (draftRow.rows.length === 0) throw new Error("Draft not found.");
  const bodyText = stripHtml(String(draftRow.rows[0]!.body ?? ""));
  if (bodyText.length < 60) {
    throw new Error("Draft is too short to fact-check.");
  }

  // Fact-check uses Anthropic's web_search server tool, which is only
  // available on the API. The drafting auth path is irrelevant here;
  // we read the key directly so a misconfigured local-Claude setup
  // (flag forced on Vercel, flag forced without `claude` installed)
  // does not block fact-check on a perfectly usable API key. The
  // resolver throws on those config-error states; we don't want that
  // throw to roll over a working API path.
  const apiKey = await getAnthropicApiKey();
  if (!apiKey) {
    const cliForced = process.env.FLAVORPRESS_LOCAL_CLAUDE === "1";
    throw new Error(
      cliForced
        ? "Fact-check requires an Anthropic API key (it uses Anthropic's web_search server tool, which the local Claude Code login does not expose). Add a key on /settings, then retry."
        : "No Anthropic API key configured. Add one on /settings, then retry.",
    );
  }
  const model = await getAnthropicDraftModel();
  const client = new Anthropic({ apiKey });

  // Cap web_search at MAX_CLAIMS. The model still needs one lookup per
  // checkable claim; doubling that budget gave a hostile body room to
  // burn through the API quota via injected "search again" prompts.
  const tools: Anthropic.Messages.Tool[] = [
    {
      type: "web_search_20250305",
      name: "web_search",
      max_uses: MAX_CLAIMS,
    } as unknown as Anthropic.Messages.Tool,
  ];
  // Keep the stripped draft text verbatim because the model must return
  // claim_text as a substring of this exact string; escaping entities would
  // make claims like "AT&T" come back as "AT&amp;T" and fail acceptance.
  const { fragment: draftBlock } = wrapUntrustedSource(bodyText, { preserveMarkup: true });
  const messages: Anthropic.Messages.MessageParam[] = [
    {
      role: "user",
      content: `${draftBlock}\nReturn the JSON now.`,
    },
  ];

  // Web search can return stop_reason="pause_turn" to checkpoint a
  // long-running turn; continuing means feeding the assistant's
  // content back as-is on the next request. Loop until the model
  // reaches a terminal stop reason. Bounded so a stuck turn doesn't
  // burn through the API quota indefinitely. Two rounds is enough for
  // a legitimate long search; more was a denial-of-wallet vector.
  const MAX_PAUSE_ROUNDS = 2;
  let pauseRounds = 0;
  let message = await client.messages.create({
    model,
    max_tokens: 4000,
    system: SYSTEM_PROMPT,
    tools,
    messages,
  });
  const visitedUrlKeys = collectVisitedUrlKeys(message);
  while (message.stop_reason === "pause_turn") {
    if (++pauseRounds > MAX_PAUSE_ROUNDS) {
      throw new Error(
        `Fact-checker stalled in pause_turn loop; aborting after ${MAX_PAUSE_ROUNDS} continuations.`,
      );
    }
    messages.push({
      role: "assistant",
      content: message.content as unknown as Anthropic.Messages.ContentBlockParam[],
    });
    message = await client.messages.create({
      model,
      max_tokens: 4000,
      system: SYSTEM_PROMPT,
      tools,
      messages,
    });
    for (const k of collectVisitedUrlKeys(message)) visitedUrlKeys.add(k);
  }

  const text = extractText(message);
  let parsed: { claims?: ModelClaim[] };
  try {
    parsed = extractJson<{ claims?: ModelClaim[] }>(text);
  } catch (err) {
    throw new Error(
      `Fact-checker did not return valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const accepted = filterAcceptedClaims(parsed.claims ?? [], bodyText, visitedUrlKeys);
  const ranAt = Date.now();

  await db.execute({
    sql: `DELETE FROM fact_check_claims WHERE draft_id = ?`,
    args: [draftId],
  });

  const persisted: FactCheckClaim[] = [];
  for (const c of accepted) {
    const id = crypto.randomUUID();
    await db.execute({
      sql: `INSERT INTO fact_check_claims
            (id, draft_id, claim_index, claim_text, verdict, comment,
             source_url, source_title, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        id,
        draftId,
        c.claimIndex,
        c.claimText,
        c.verdict,
        c.comment,
        c.sourceUrl,
        c.sourceTitle,
        ranAt,
      ],
    });
    persisted.push({ id, draftId, createdAt: ranAt, ...c });
  }

  // Persist a run-level row even when zero claims were accepted.
  // Without this, a successful "we ran the checker, nothing to flag"
  // outcome looks identical to "never run" after a page reload.
  await persistFactCheckRun(draftId, persisted, ranAt);

  return { claims: persisted, ranAt };
}

const RUN_KEY = "latest";

/**
 * Upsert a per-draft run summary in `fact_check_results`. We use the
 * existing aggregate table rather than a new column so the v1 schema
 * stays put; the (draft_id, capability_id, idempotency_key) UNIQUE
 * constraint plus a deterministic id let us INSERT OR REPLACE without
 * row churn.
 */
async function persistFactCheckRun(
  draftId: string,
  claims: FactCheckClaim[],
  ranAt: number,
): Promise<void> {
  const flagged = claims.filter((c) => c.verdict === "disputed").map((c) => c.id);
  const passed = flagged.length === 0 ? 1 : 0;
  const runId = `${draftId}::${FACT_CHECK_ID}::${RUN_KEY}`;
  await db.execute({
    sql: `INSERT OR REPLACE INTO fact_check_results
          (id, draft_id, capability_id, idempotency_key, passed,
           flagged_claim_ids, raw_response, computed_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [runId, draftId, FACT_CHECK_ID, RUN_KEY, passed, JSON.stringify(flagged), null, ranAt],
  });
}

export async function loadFactCheckRunAt(draftId: string): Promise<number | null> {
  const session = await requireSession();
  await ensureSchema();

  // Verify the draft belongs to the session user before returning any data.
  const ownership = await db.execute({
    sql: `SELECT id FROM drafts WHERE id = ? AND user_id = ?`,
    args: [draftId, session.userId],
  });
  if (ownership.rows.length === 0) return null;

  const r = await db.execute({
    sql: `SELECT computed_at FROM fact_check_results
          WHERE draft_id = ? AND capability_id = ? AND idempotency_key = ?`,
    args: [draftId, FACT_CHECK_ID, RUN_KEY],
  });
  if (r.rows.length === 0) return null;
  return Number(r.rows[0]!.computed_at);
}

export async function loadFactCheckClaims(draftId: string): Promise<FactCheckClaim[]> {
  const session = await requireSession();
  await ensureSchema();

  // Verify the draft belongs to the session user before returning any data.
  const ownership = await db.execute({
    sql: `SELECT id FROM drafts WHERE id = ? AND user_id = ?`,
    args: [draftId, session.userId],
  });
  if (ownership.rows.length === 0) return [];

  const r = await db.execute({
    sql: `SELECT id, draft_id, claim_index, claim_text, verdict, comment,
                 source_url, source_title, created_at
          FROM fact_check_claims
          WHERE draft_id = ?
          ORDER BY claim_index ASC`,
    args: [draftId],
  });
  return r.rows.map((row) => ({
    id: String(row.id),
    draftId: String(row.draft_id),
    claimIndex: Number(row.claim_index),
    claimText: String(row.claim_text),
    verdict: String(row.verdict) as Verdict,
    comment: String(row.comment),
    sourceUrl: row.source_url ? String(row.source_url) : null,
    sourceTitle: row.source_title ? String(row.source_title) : null,
    createdAt: Number(row.created_at),
  }));
}

export interface FactCheckFixSuggestion {
  /** Verbatim substring of the current body HTML the user can review. */
  original: string;
  /** Proposed HTML replacement that would land in the draft on Apply. */
  replacement: string;
  /** One-sentence justification rooted in the source. */
  rationale: string;
}

/**
 * Generate a proposed rewrite for a single claim without touching the
 * draft. The user reads it in the panel and explicitly applies, retries,
 * or dismisses; this is the "checkpoint between model and draft" the
 * scope rule cares about.
 *
 * The model is asked to return `original_html_substring` (a verbatim
 * substring of the current body HTML) and `replacement_html` so the
 * follow-up `applyFactCheckFix` is a single-shot string replace.
 */
export async function suggestFactCheckFix(
  draftId: string,
  claimId: string,
): Promise<FactCheckFixSuggestion> {
  const session = await requireSession();
  await ensureSchema();

  const { body, claim } = await loadDraftAndClaim(draftId, claimId, session.userId);
  if (claim.verdict !== "disputed" && claim.verdict !== "unverified") {
    throw new Error("Only disputed or unverified claims can be fixed.");
  }

  // Same pattern as runFactCheck: read the API key directly so a forced
  // CLI flag with a valid key still works. The auth resolver throws on
  // FLAVORPRESS_LOCAL_CLAUDE=1 if it can't find the local `claude`
  // binary, and we don't want a misconfigured CLI to roll over a
  // perfectly usable API key, especially since fact-check requires the
  // API anyway and the user already paired the two flows.
  const apiKey = await getAnthropicApiKey();
  if (!apiKey) {
    const cliForced = process.env.FLAVORPRESS_LOCAL_CLAUDE === "1";
    throw new Error(
      cliForced
        ? "Fact-check fix requires an Anthropic API key (the local Claude Code login does not expose the rewrite path). Add a key on /settings, then retry."
        : "No Anthropic API key configured. Add one on /settings, then retry.",
    );
  }
  const model = await getAnthropicDraftModel();
  const client = new Anthropic({ apiKey });

  // The source URL/title is shown only for citation context. We do NOT
  // give the model a fetcher or web_search here, so it has no way to
  // read the source. The fact-check pass already visited the source and
  // distilled what matters into `comment`; the prompt below treats that
  // comment as the only authority on what's correct. Without this
  // constraint the model would lean on training-data guesses and write
  // unverified text into the draft.
  const sourceCitation = claim.sourceUrl
    ? `${claim.sourceTitle ? `${claim.sourceTitle}; ` : ""}${claim.sourceUrl}`
    : "No source URL was verified for this claim.";

  // These fields came from untrusted text (the draft was assembled from
  // third-party sources; the comment and citation may include model or
  // web-provided text). Wrap each so an injection in any of them can't
  // redirect the rewriter.
  // body is HTML the model must echo back a verbatim substring of; preserve
  // markup so `body.includes(original)` still matches on apply.
  const { fragment: bodyBlock } = wrapUntrustedSource(body, { preserveMarkup: true });
  const { fragment: claimBlock } = wrapUntrustedSource(claim.claimText, { maxBytes: 4 * 1024 });
  const { fragment: commentBlock } = wrapUntrustedSource(claim.comment, { maxBytes: 4 * 1024 });
  const { fragment: sourceBlock } = wrapUntrustedSource(sourceCitation, { maxBytes: 2 * 1024 });

  const userPrompt = `DRAFT BODY HTML:
${bodyBlock}
FLAGGED CLAIM (verbatim text from the body):
${claimBlock}
VERDICT: ${claim.verdict}
FACT-CHECK COMMENT (the ONLY authority on what's true here):
${commentBlock}
SOURCE CITATION (for attribution only; do not fetch):
${sourceBlock}

You have no way to read the source from this turn. Treat the FACT-CHECK COMMENT block as the only verified information. Do not draw on training-data recall for figures, dates, names, or causal claims.

Propose a rewrite of ONLY the sentence(s) containing the flagged claim. Preserve surrounding voice, length, and HTML structure. Change as little as possible; do not touch unrelated sentences.

Decide between two strategies based on the comment:
1. CORRECT: the comment names a specific, verified value (a number, date, name, or attribution). Apply that value in place of the wrong one.
2. SOFTEN: the comment does not name a specific replacement (it just says the claim is contested or unverified). Do not invent a corrected figure. Instead, hedge or attribute the claim ("according to <source>", "reportedly", "estimates vary") or remove the specific while keeping the surrounding sentence intact.

Return JSON only:
{
  "original_html_substring": "...",
  "replacement_html": "...",
  "rationale": "..."
}

Hard rules:
- original_html_substring MUST be a verbatim substring of the body HTML, copied character-for-character. Pick the smallest substring that fully contains the flagged claim and the surrounding sentence boundary.
- replacement_html keeps the same outer HTML tags as original_html_substring; only inner prose changes.
- No invented facts. If the comment does not give you a value, do not write one.
- No em-dashes; use semicolons or new sentences.
- rationale is one sentence of plain prose, addressed to the writer, naming what changed and why; start with "Correct:" or "Soften:" matching the strategy you used.`;

  const response = await client.messages.create({
    model,
    max_tokens: 1500,
    messages: [{ role: "user", content: userPrompt }],
  });

  const text = extractText(response);
  let parsed: {
    original_html_substring?: unknown;
    replacement_html?: unknown;
    rationale?: unknown;
  };
  try {
    parsed = extractJson(text);
  } catch (err) {
    throw new Error(
      `Fix-claim model did not return valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const original =
    typeof parsed.original_html_substring === "string" ? parsed.original_html_substring : "";
  const replacement =
    typeof parsed.replacement_html === "string" ? sanitizeDraftHtml(parsed.replacement_html) : "";
  const rationale =
    typeof parsed.rationale === "string" && parsed.rationale.trim().length > 0
      ? parsed.rationale.trim()
      : "Rewrite proposed by fact-check.";
  if (!original || !replacement) {
    throw new Error("Fix-claim model returned an empty rewrite.");
  }
  if (!body.includes(original)) {
    throw new Error("Suggested original span isn't in the draft body; try again.");
  }
  if (!spanCoversClaim(original, claim.claimText)) {
    // The model picked a different substring of the body than the one
    // tied to this claim. Without this check, applyFactCheckFix would
    // happily replace unrelated draft text. Fail loud instead of
    // mutating the wrong sentence.
    throw new Error("Suggested span doesn't cover the flagged claim; try again.");
  }
  if (original === replacement) {
    throw new Error("Suggestion was identical to the original; nothing to apply.");
  }

  return { original, replacement, rationale };
}

/**
 * The model's `original_html_substring` may include surrounding tags
 * (e.g. a whole `<p>...</p>`). The persisted `claim.claimText` is a
 * verbatim substring of the *stripped* body. Compare on stripped text
 * so a span that wraps the claim with extra HTML still passes, while
 * a span that points at unrelated draft text fails.
 *
 * Comparison is case-insensitive so a claim whose first character was
 * lowercased by sentence-boundary expansion still matches.
 */
function spanCoversClaim(originalHtml: string, claimText: string): boolean {
  const haystack = stripHtml(originalHtml).toLowerCase();
  const needle = claimText.toLowerCase();
  if (!needle) return false;
  return haystack.indexOf(needle) !== -1;
}

/**
 * Apply a previously-suggested rewrite. Re-verifies the substring is
 * still present (the body could have changed since suggestion, e.g.
 * another claim's fix was applied first) and refuses on drift rather
 * than mutating partially.
 */
export async function applyFactCheckFix(
  draftId: string,
  claimId: string,
  original: string,
  replacement: string,
): Promise<{ claims: FactCheckClaim[]; ranAt: number | null }> {
  const session = await requireSession();
  await ensureSchema();

  if (!original || !replacement) {
    throw new Error("Suggestion was empty; re-suggest before applying.");
  }
  if (original === replacement) {
    throw new Error("Suggestion equals the original; nothing to apply.");
  }

  const { body, claim } = await loadDraftAndClaim(draftId, claimId, session.userId);
  if (claim.verdict !== "disputed" && claim.verdict !== "unverified") {
    throw new Error("Only disputed or unverified claims can be fixed.");
  }
  if (!body.includes(original)) {
    throw new Error("Draft has changed since the suggestion; re-suggest before applying.");
  }
  if (!spanCoversClaim(original, claim.claimText)) {
    // Apply takes `original` from the client; re-confirm it still maps
    // to this claim before overwriting any draft text.
    throw new Error("Suggested span doesn't cover the flagged claim; re-suggest.");
  }

  const cleanReplacement = sanitizeDraftHtml(replacement);
  if (!cleanReplacement) {
    throw new Error("Suggestion was empty after sanitization; re-suggest before applying.");
  }

  const newBody = body.replace(original, cleanReplacement);

  await db.execute({
    sql: `UPDATE drafts SET body = ?, edited_at = ? WHERE id = ? AND user_id = ?`,
    args: [newBody, Date.now(), draftId, session.userId],
  });
  await db.execute({
    sql: `DELETE FROM fact_check_claims WHERE id = ? AND draft_id = ?`,
    args: [claimId, draftId],
  });

  // The replacement may swallow other claims whose `claim_text` lived
  // inside the rewritten span (e.g. two checked claims in the same
  // sentence). Those rows would otherwise survive as stale annotations
  // pointing at text that no longer exists in the body. Drop any whose
  // claim text is no longer findable in the new body.
  const survivors = await pruneStaleClaims(draftId, newBody);

  const ranAt = await loadFactCheckRunAt(draftId);
  if (ranAt !== null) {
    await persistFactCheckRun(draftId, survivors, ranAt);
  }
  return { claims: survivors, ranAt };
}

/**
 * Compare each remaining claim's persisted `claim_text` against the
 * stripped form of the new body. Drop rows that no longer map to any
 * span. Returns the survivors in their original order.
 */
async function pruneStaleClaims(draftId: string, newBody: string): Promise<FactCheckClaim[]> {
  const remaining = await loadFactCheckClaims(draftId);
  const haystack = stripHtml(newBody).toLowerCase();
  const survivors: FactCheckClaim[] = [];
  const stale: string[] = [];
  for (const c of remaining) {
    if (haystack.indexOf(c.claimText.toLowerCase()) === -1) {
      stale.push(c.id);
    } else {
      survivors.push(c);
    }
  }
  if (stale.length > 0) {
    const placeholders = stale.map(() => "?").join(",");
    await db.execute({
      sql: `DELETE FROM fact_check_claims WHERE draft_id = ? AND id IN (${placeholders})`,
      args: [draftId, ...stale],
    });
  }
  return survivors;
}

interface LoadedClaim {
  claimText: string;
  verdict: Verdict;
  comment: string;
  sourceUrl: string | null;
  sourceTitle: string | null;
}

async function loadDraftAndClaim(
  draftId: string,
  claimId: string,
  userId: string,
): Promise<{ body: string; claim: LoadedClaim }> {
  const draftRow = await db.execute({
    sql: `SELECT id, body, wp_post_id FROM drafts WHERE id = ? AND user_id = ?`,
    args: [draftId, userId],
  });
  if (draftRow.rows.length === 0) throw new Error("Draft not found.");
  if (draftRow.rows[0]!.wp_post_id) {
    // Sent drafts are read-only in FlavorPress; the editor branch that
    // hosts fact-check fixes no longer renders for them. This guard backs
    // that up against hand-crafted requests.
    throw new Error("This draft has been sent to WordPress and can no longer be edited here.");
  }
  const body = String(draftRow.rows[0]!.body ?? "");

  const claimRow = await db.execute({
    sql: `SELECT claim_text, verdict, comment, source_url, source_title
          FROM fact_check_claims WHERE id = ? AND draft_id = ?`,
    args: [claimId, draftId],
  });
  if (claimRow.rows.length === 0) throw new Error("Claim not found.");
  const row = claimRow.rows[0]!;
  return {
    body,
    claim: {
      claimText: String(row.claim_text),
      verdict: String(row.verdict) as Verdict,
      comment: String(row.comment),
      sourceUrl: row.source_url ? String(row.source_url) : null,
      sourceTitle: row.source_title ? String(row.source_title) : null,
    },
  };
}

export async function clearFactCheckClaims(draftId: string): Promise<void> {
  const session = await requireSession();
  await ensureSchema();

  // Verify the draft belongs to the session user before deleting any data.
  const ownership = await db.execute({
    sql: `SELECT id FROM drafts WHERE id = ? AND user_id = ?`,
    args: [draftId, session.userId],
  });
  if (ownership.rows.length === 0) throw new Error("Draft not found.");

  await db.execute({
    sql: `DELETE FROM fact_check_claims WHERE draft_id = ?`,
    args: [draftId],
  });
  await db.execute({
    sql: `DELETE FROM fact_check_results
          WHERE draft_id = ? AND capability_id = ?`,
    args: [draftId, FACT_CHECK_ID],
  });
}

export function claimToAnnotation(c: FactCheckClaim): ExtensionAnnotation {
  return {
    id: c.id,
    index: c.claimIndex,
    spanText: c.claimText,
    tone:
      c.verdict === "supported" ? "positive" : c.verdict === "disputed" ? "negative" : "neutral",
    title: `Claim ${c.claimIndex} · ${capitalize(c.verdict)}`,
    body: c.comment,
    linkUrl: c.sourceUrl,
    linkTitle: c.sourceTitle,
  };
}

export const factCheckServerEntry: ServerExtensionEntry = {
  id: FACT_CHECK_ID,
  async loadAnnotations(draftId) {
    // ranAt comes from the run row, not from claim timestamps. A
    // successful zero-claim run still has a run row, so the panel
    // shows "checked Xm ago" instead of looking unchecked.
    const [claims, runAt] = await Promise.all([
      loadFactCheckClaims(draftId),
      loadFactCheckRunAt(draftId),
    ]);
    return {
      annotations: claims.map(claimToAnnotation),
      ranAt: runAt,
    };
  },
};

function filterAcceptedClaims(
  raw: ModelClaim[],
  bodyText: string,
  visitedUrlKeys: Set<string>,
): Array<Omit<FactCheckClaim, "id" | "draftId" | "createdAt">> {
  const accepted: Array<Omit<FactCheckClaim, "id" | "draftId" | "createdAt">> = [];
  const haystack = bodyText.toLowerCase();
  const seen = new Set<string>();

  for (const c of raw) {
    if (accepted.length >= MAX_CLAIMS) break;
    const claimText = typeof c.claim_text === "string" ? c.claim_text.trim() : "";
    const verdictRaw = typeof c.verdict === "string" ? c.verdict.trim().toLowerCase() : "";
    const comment = typeof c.comment === "string" ? c.comment.trim() : "";
    if (!claimText || !comment) continue;
    if (!VERDICTS.includes(verdictRaw as Verdict)) continue;
    if (haystack.indexOf(claimText.toLowerCase()) === -1) continue;
    const dedupeKey = claimText.toLowerCase();
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const sourceUrlRaw =
      typeof c.source_url === "string" && /^https?:\/\//i.test(c.source_url)
        ? c.source_url.trim()
        : null;
    // Provenance check. The model can hallucinate plausible URLs that
    // the web_search tool never visited. Compare against the host+path
    // keys harvested from web_search_tool_result blocks; treat any
    // unvalidated URL as missing rather than as a real source.
    const key = sourceUrlRaw ? canonicalUrlKey(sourceUrlRaw) : null;
    const sourceUrl = sourceUrlRaw && key !== null && visitedUrlKeys.has(key) ? sourceUrlRaw : null;
    const sourceTitle =
      typeof c.source_title === "string" && c.source_title.trim().length > 0
        ? c.source_title.trim().slice(0, 240)
        : null;

    // Factual verdicts (supported, disputed) require a provenance-
    // validated source. Without one we drop the claim rather than
    // showing a verdict the panel can't back up. Unverified is allowed
    // to render with no link.
    const verdict = verdictRaw as Verdict;
    if (verdict !== "unverified" && sourceUrl === null) continue;

    accepted.push({
      claimIndex: accepted.length + 1,
      claimText,
      verdict,
      comment,
      sourceUrl,
      sourceTitle: sourceUrl === null ? null : sourceTitle,
    });
  }
  return accepted;
}

/**
 * Walk the assistant message for `web_search_tool_result` blocks and
 * collect a normalized host+path key for every URL the tool actually
 * visited. Used to validate the URLs the model writes into its JSON
 * answer; anything outside this set is treated as a hallucination.
 */
function collectVisitedUrlKeys(message: Anthropic.Messages.Message): Set<string> {
  const out = new Set<string>();
  const blocks = message.content as ReadonlyArray<unknown>;
  for (const block of blocks) {
    if (!isObject(block)) continue;
    if (block.type !== "web_search_tool_result") continue;
    const content = block.content;
    if (!Array.isArray(content)) continue;
    for (const item of content) {
      if (!isObject(item)) continue;
      const url = item.url;
      if (typeof url !== "string") continue;
      const key = canonicalUrlKey(url);
      if (key !== null) out.add(key);
    }
  }
  return out;
}

/**
 * Normalize a URL for cross-comparison: lowercased host plus path
 * with trailing slash trimmed. Query and fragment are dropped so a
 * model URL stripped of utm_* params still matches the visited URL.
 */
function canonicalUrlKey(s: string): string | null {
  try {
    const u = new URL(s);
    let path = u.pathname;
    if (path !== "/" && path.endsWith("/")) path = path.slice(0, -1);
    return `${u.host.toLowerCase()}${path}`;
  } catch {
    return null;
  }
}

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Strip HTML tags and decode entities so the body text we send to the
 * model matches, character-for-character, the text the browser renders
 * (which is what `wrapFirstOccurrence` searches via `textContent`).
 *
 * The previous implementation only decoded a handful of named entities,
 * which meant a draft containing `&rsquo;` or `&hellip;` would prompt
 * the model with the literal entity, the model would copy the entity
 * into claim_text verbatim, and the client would fail to find the
 * span (since the rendered article contains the decoded character).
 */
function stripHtml(html: string): string {
  const tagsStripped = html
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/(p|h\d|li|blockquote)>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  return decodeHtmlEntities(tagsStripped)
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Decode the named entities common in prose plus numeric/hex entities.
 * Covers smart punctuation, dashes, ellipsis, common typographic
 * symbols, and currency. Unknown named entities are left untouched
 * (they're rare in blog drafts; if needed later, swap in `he`).
 */
const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  // Smart quotes and primes
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  sbquo: "‚",
  bdquo: "„",
  prime: "′",
  Prime: "″",
  // Dashes, spaces, ellipsis
  ndash: "–",
  mdash: "—",
  hellip: "…",
  ensp: " ",
  emsp: " ",
  thinsp: " ",
  zwnj: "‌",
  zwj: "‍",
  // Common symbols
  copy: "©",
  reg: "®",
  trade: "™",
  middot: "·",
  bull: "•",
  sect: "§",
  para: "¶",
  deg: "°",
  // Math/typography
  times: "×",
  divide: "÷",
  plusmn: "±",
  minus: "−",
  // Currency
  cent: "¢",
  pound: "£",
  yen: "¥",
  euro: "€",
  // Punctuation
  iexcl: "¡",
  iquest: "¿",
  laquo: "«",
  raquo: "»",
  brvbar: "¦",
  // Arrows
  larr: "←",
  rarr: "→",
  uarr: "↑",
  darr: "↓",
  harr: "↔",
};

function decodeHtmlEntities(s: string): string {
  // Numeric entities first: &#123; (decimal) and &#x7B; / &#X7B; (hex).
  const numericDecoded = s.replace(/&#([xX])?([0-9a-fA-F]+);/g, (match, hexFlag, code) => {
    const n = Number.parseInt(code, hexFlag ? 16 : 10);
    if (!Number.isFinite(n) || n < 0 || n > 0x10ffff) return match;
    try {
      return String.fromCodePoint(n);
    } catch {
      return match;
    }
  });
  // Named entities; unknowns are left in place.
  return numericDecoded.replace(
    /&([a-zA-Z][a-zA-Z0-9]+);/g,
    (match, name: string) => NAMED_ENTITIES[name] ?? match,
  );
}
