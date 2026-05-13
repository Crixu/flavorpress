import "server-only";

import { type AnthropicLike, createAnthropicClient, extractText } from "../anthropic";
import { getAnthropicDraftModel } from "./settings";

export interface TagInput {
  title: string;
  body: string;
}

export interface TagOptions {
  client?: AnthropicLike;
}

const TAG_MAX_LEN = 32;
const TAG_MIN_COUNT = 3;
const TAG_MAX_COUNT = 8;

const SYSTEM_PROMPT = `You extract short topic tags from articles.
Tags are 1-3 words, lowercase, hyphenated for multi-word.
Return ${TAG_MIN_COUNT}-${TAG_MAX_COUNT} tags.
Output strict JSON: {"tags": ["tag1", "tag2", ...]}.
No preamble, no explanation, only the JSON object.`;

/**
 * Normalize a raw tag string into a canonical form.
 *
 * - Lowercased, trimmed, internal whitespace collapsed to a single hyphen.
 * - Trailing punctuation stripped.
 * - Non-alphanumeric (other than hyphens) removed.
 * - Returns null for empty results or tags longer than 32 characters.
 */
export function normalizeTag(raw: string): string | null {
  const trimmed = raw
    .trim()
    .toLowerCase()
    .replace(/[!?.,;:'"`]+$/g, "")
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+$/g, "");
  if (!trimmed || trimmed.length > TAG_MAX_LEN) return null;
  return trimmed;
}

/**
 * Extract LLM tags from an article. Returns up to 8 normalized tags;
 * empty array on any failure (no client, parse error, network).
 */
export async function extractItemTags(input: TagInput, opts: TagOptions = {}): Promise<string[]> {
  let client: AnthropicLike | null = opts.client ?? null;
  if (!client) {
    // createAnthropicClient() can throw on misconfigured CLI states; isolate that
    // from the network-call try so we always fail closed (return []).
    try {
      const result = await createAnthropicClient();
      client = result.client;
    } catch {
      return [];
    }
  }
  if (!client) return [];

  try {
    const model = await getAnthropicDraftModel();
    const message = await client.messages.create({
      model,
      max_tokens: 200,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `Title: ${input.title}\nBody: ${input.body.slice(0, 4000)}`,
        },
      ],
    });
    const text = extractText(message);
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return [];
    const parsed = JSON.parse(match[0]) as { tags?: unknown };
    if (!Array.isArray(parsed.tags)) return [];

    const seen = new Set<string>();
    const out: string[] = [];
    for (const raw of parsed.tags) {
      if (typeof raw !== "string") continue;
      const norm = normalizeTag(raw);
      if (!norm || seen.has(norm)) continue;
      seen.add(norm);
      out.push(norm);
      if (out.length >= TAG_MAX_COUNT) break;
    }
    return out;
  } catch {
    return [];
  }
}
