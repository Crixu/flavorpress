/**
 * Layer 3 merge oracle.
 *
 * When Layer 2 (entity overlap + trigram cosine) misses but the candidate
 * pair sits in the ambiguous near-miss zone, we ask Claude whether the
 * two items cover the SAME specific story. This closes the orphaning gap
 * caused by Layer 2 being too literal: a story rewritten with different
 * entity choices and a divergent headline often falls just under the
 * trigram and overlap thresholds even though a reader would group them.
 *
 * Bounded: cluster-engine caps the number of near-miss candidates per
 * ingest, so this never balloons into a Sonnet call per (incoming, window)
 * pair. Cached by the ordered pair of content_hashes so re-runs are free.
 *
 * Auth: routed through createAnthropicClient so the local Claude Code
 * login handles the call by default. Returns null when no client is
 * available (cluster-engine treats null as "no merge", same as before).
 */

import { db } from "../db";
import { createAnthropicClient, extractJson, extractText } from "../anthropic";
import { getAnthropicDraftModel } from "./settings";

export const ORACLE_PROMPT_VERSION = "2026-05-05.v1";

export interface MergeOracleInput {
  aHash: string;
  aTitle: string;
  aLede: string;
  bHash: string;
  bTitle: string;
  bLede: string;
}

export interface MergeOracleResult {
  sameStory: boolean;
  reason: string | null;
  source: "llm" | "cache";
}

interface ModelOutput {
  same_story?: unknown;
  reason?: unknown;
}

const SYSTEM_PROMPT = `You decide whether two news items cover the SAME specific story for a news clustering system.

Return ONE JSON object and nothing else. Schema:

{ "same_story": true | false, "reason": "string" }

SAME story means they cover the SAME specific event:
- the same announcement, launch, ruling, incident, transaction
- about the same primary subject at the same point in time
- one might quote or build on the other; that's still the same story

DIFFERENT story means:
- same broader topic but different specific events
- same subject, different angles ("Apple's chip strategy" vs "Apple's M5 launch")
- one is reaction/opinion to the other on a separate news beat
- different time periods or different incidents

Be strict. False positives merge unrelated stories into one cluster, which is worse than leaving them apart. When in doubt, return false.

reason: one short sentence. No em-dashes; use semicolons or new sentences if you need to add detail (you should not).`;

export async function askMergeOracle(input: MergeOracleInput): Promise<MergeOracleResult | null> {
  const [hashA, hashB] = orderHashes(input.aHash, input.bHash);
  const model = await getAnthropicDraftModel();
  // Cache hit shortcut.
  const cached = await loadCached(hashA, hashB, model);
  if (cached) return { ...cached, source: "cache" };

  const { client } = await createAnthropicClient();
  if (!client) return null;

  // The model sees the items in cache-canonical order so the prompt is
  // identical regardless of which side called the oracle. This makes
  // identical pairs hit cache in either order.
  const [aSide, bSide] = orderItems(input);

  try {
    const message = await client.messages.create({
      model,
      max_tokens: 200,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `ITEM A:\nTitle: ${aSide.title}\nLede: ${aSide.lede}\n\nITEM B:\nTitle: ${bSide.title}\nLede: ${bSide.lede}\n\nReturn the JSON now.`,
        },
      ],
    });
    const text = extractText(message);
    const parsed = extractJson<ModelOutput>(text);
    const sameStory = typeof parsed.same_story === "boolean" ? parsed.same_story : false;
    const reason =
      typeof parsed.reason === "string" && parsed.reason.trim().length > 0
        ? parsed.reason.trim().slice(0, 240)
        : null;
    await persistCache(hashA, hashB, model, sameStory, reason);
    return { sameStory, reason, source: "llm" };
  } catch {
    // Auth, rate limit, malformed JSON: treat as "no decision". The
    // caller will fall through to the existing "leave orphaned" path.
    return null;
  }
}

function orderHashes(a: string, b: string): [string, string] {
  return a <= b ? [a, b] : [b, a];
}

function orderItems(
  input: MergeOracleInput,
): [{ title: string; lede: string }, { title: string; lede: string }] {
  if (input.aHash <= input.bHash) {
    return [
      { title: input.aTitle, lede: input.aLede },
      { title: input.bTitle, lede: input.bLede },
    ];
  }
  return [
    { title: input.bTitle, lede: input.bLede },
    { title: input.aTitle, lede: input.aLede },
  ];
}

async function loadCached(
  hashA: string,
  hashB: string,
  model: string,
): Promise<{ sameStory: boolean; reason: string | null } | null> {
  const r = await db.execute({
    sql: `SELECT same_story, reason FROM merge_oracle_cache
          WHERE hash_a = ? AND hash_b = ? AND model = ? AND prompt_version = ?
          LIMIT 1`,
    args: [hashA, hashB, model, ORACLE_PROMPT_VERSION],
  });
  if (r.rows.length === 0) return null;
  return {
    sameStory: Number(r.rows[0]!.same_story ?? 0) === 1,
    reason: r.rows[0]!.reason ? String(r.rows[0]!.reason) : null,
  };
}

async function persistCache(
  hashA: string,
  hashB: string,
  model: string,
  sameStory: boolean,
  reason: string | null,
): Promise<void> {
  await db.execute({
    sql: `INSERT OR REPLACE INTO merge_oracle_cache
          (hash_a, hash_b, model, prompt_version, same_story, reason, computed_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: [hashA, hashB, model, ORACLE_PROMPT_VERSION, sameStory ? 1 : 0, reason, Date.now()],
  });
}
