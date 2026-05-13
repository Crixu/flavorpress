/**
 * LLM-at-ingest entity extractor.
 *
 * Why: the prior regex extractor (capitalized noun phrases of 1-3 tokens,
 * top 5 by frequency, hard stopword on "Apple") was good enough to get
 * Layer 2 clustering off the ground but it produces low-precision entity
 * lists. Topic search and the ranker both read these lists; bad tags
 * compound downstream. This module replaces the regex with a single
 * Anthropic call per item, cached by content_hash so re-runs are free.
 *
 * Auth: routed through createAnthropicClient. The user's local Claude
 * Code login handles the call by default; the API key path only kicks
 * in on Vercel. When neither is available, we fall back to the regex
 * extractor so ingest never blocks on missing credentials.
 *
 * Output shape: {entities, primary_subject, beat_tag}. entities replaces
 * the regex output; primary_subject is the single thing the article is
 * mainly about (used by ranker/draft-generator to pick the right voice
 * profile); beat_tag is a short topical lane label ("AI hardware",
 * "iPhone news") used to drive future folder-scoped clustering and the
 * adaptive fire threshold.
 */

import { db } from "../db";
import { createAnthropicClient, extractJson, extractText } from "../anthropic";
import { extractEntities as regexExtractEntities } from "./cluster-engine";
import { getAnthropicDraftModel } from "./settings";

export const PROMPT_VERSION = "2026-05-05.v1";

export interface EntityExtraction {
  entities: string[];
  primarySubject: string | null;
  beatTag: string | null;
  source: "llm" | "cache" | "regex";
}

interface ExtractionInput {
  title: string;
  lede: string;
  contentHash: string;
}

interface ModelOutput {
  entities?: unknown;
  primary_subject?: unknown;
  beat_tag?: unknown;
}

const SYSTEM_PROMPT = `You tag news items for a personal news reader. The user is a prosumer blogger who needs accurate entity tags so a topic search like "OpenAI's phone" returns the right cluster.

Return ONE JSON object and nothing else. No prose, no markdown fences. Schema:

{
  "entities": ["string", ...],
  "primary_subject": "string" | null,
  "beat_tag": "string" | null
}

entities: up to 6 named subjects this item is about. Lowercase. Include:
  - people (full names, lowercase): "sam altman", "tim cook"
  - organizations and brands: "openai", "apple", "anthropic"
  - products and technologies: "iphone", "gpt-5", "claude", "vision pro"
  - distinctive places when they're the topic: "taiwan", "brussels"
Skip:
  - publication names ("the verge", "bloomberg")
  - generic categorical terms ("technology", "company", "users", "market")
  - generic verbs and report words ("release", "launch", "rumor")
  - bare numbers, dates, monetary amounts
Order: most central to the article first.

primary_subject: the ONE entity the article is mainly about. Lowercase, must be one of the values in entities. Null if the article is genuinely about a topic with no single subject (e.g., a survey across multiple companies).

beat_tag: a 2-4 word lowercase topical lane this item belongs in. Examples:
  - "ai hardware"
  - "iphone product news"
  - "open source models"
  - "fermentation research"
  - "wordpress core"
  - "vc funding rounds"
Pick the lane a recurring reader would file this under. Be specific; "tech" is too broad. Null if the item is a one-off oddity that doesn't fit a recurring lane.

No em-dashes; use semicolons or new sentences if needed.`;

export async function extractItemEntities(input: ExtractionInput): Promise<EntityExtraction> {
  const model = await getAnthropicDraftModel();

  // 1. Cache check.
  const cached = await loadCached(input.contentHash, model);
  if (cached) return { ...cached, source: "cache" };

  // 2. LLM call.
  const llm = await runLLMExtraction(input, model);
  if (llm) {
    await persistCache(input.contentHash, model, llm);
    return { ...llm, source: "llm" };
  }

  // 3. Regex fallback. Never block ingest on missing credentials.
  const regexEntities = regexExtractEntities(input.title, input.lede).map((e) => e.toLowerCase());
  return {
    entities: regexEntities,
    primarySubject: regexEntities[0] ?? null,
    beatTag: null,
    source: "regex",
  };
}

async function runLLMExtraction(
  input: ExtractionInput,
  model: string,
): Promise<{ entities: string[]; primarySubject: string | null; beatTag: string | null } | null> {
  const { client } = await createAnthropicClient();
  if (!client) return null;

  try {
    const message = await client.messages.create({
      model,
      max_tokens: 400,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `TITLE: ${input.title}\n\nLEDE: ${input.lede}\n\nReturn the JSON now.`,
        },
      ],
    });
    const text = extractText(message);
    const parsed = extractJson<ModelOutput>(text);
    return normalizeExtraction(parsed);
  } catch {
    // Auth error, rate limit, malformed JSON: fall through to regex.
    // We don't surface this; ingest continues.
    return null;
  }
}

function normalizeExtraction(raw: ModelOutput): {
  entities: string[];
  primarySubject: string | null;
  beatTag: string | null;
} {
  const entities = stringArray(raw.entities).slice(0, 6);
  const primary = stringOrNull(raw.primary_subject);
  // Validate primary_subject is in entities; the prompt requires it but
  // the model occasionally returns a synonym or a slight variant. If it
  // isn't in the list, drop to null rather than carrying an orphan tag.
  const primarySubject = primary && entities.includes(primary) ? primary : null;
  const beatTag = stringOrNull(raw.beat_tag);
  return { entities, primarySubject, beatTag };
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of value) {
    if (typeof v !== "string") continue;
    const trimmed = v.trim().toLowerCase();
    if (trimmed.length === 0 || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

function stringOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase();
  return trimmed.length === 0 ? null : trimmed;
}

async function loadCached(
  contentHash: string,
  model: string,
): Promise<{ entities: string[]; primarySubject: string | null; beatTag: string | null } | null> {
  const r = await db.execute({
    sql: `SELECT entities, primary_subject, beat_tag FROM entity_cache
          WHERE content_hash = ? AND model = ? AND prompt_version = ?
          LIMIT 1`,
    args: [contentHash, model, PROMPT_VERSION],
  });
  if (r.rows.length === 0) return null;
  const row = r.rows[0]!;
  let entities: string[] = [];
  try {
    const parsed = JSON.parse(String(row.entities ?? "[]")) as unknown;
    if (Array.isArray(parsed)) {
      entities = parsed.filter((e): e is string => typeof e === "string");
    }
  } catch {
    return null;
  }
  return {
    entities,
    primarySubject: row.primary_subject ? String(row.primary_subject) : null,
    beatTag: row.beat_tag ? String(row.beat_tag) : null,
  };
}

async function persistCache(
  contentHash: string,
  model: string,
  result: { entities: string[]; primarySubject: string | null; beatTag: string | null },
): Promise<void> {
  await db.execute({
    sql: `INSERT OR REPLACE INTO entity_cache
          (content_hash, model, prompt_version, entities, primary_subject, beat_tag, computed_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: [
      contentHash,
      model,
      PROMPT_VERSION,
      JSON.stringify(result.entities),
      result.primarySubject,
      result.beatTag,
      Date.now(),
    ],
  });
}
