import "server-only";

/**
 * Comment-courtroom extension — server half. Runs a fixed jury of five
 * reader personas against the draft and persists a nested comment
 * thread the writer can read in the right rail before publishing.
 *
 * Like related-images, this extension is not span-anchored: it produces
 * a thread, not per-claim margin comments. `loadAnnotations` therefore
 * returns an empty payload, and the Panel hydrates its own state via a
 * dedicated server action.
 *
 * The model is asked for a tree (top-level comments with optional
 * replies). We flatten it to rows with parent_id pointers so the panel
 * can render the nesting without storing JSON blobs.
 */

import { createAnthropicClient } from "@/lib/anthropic";
import { extractText, extractJson } from "@/lib/anthropic";
import { getAnthropicDraftModel } from "@/lib/v1/settings";
import {
  newSourceNonce,
  renderUntrustedPromptBlock,
  untrustedSourceContract,
} from "@/lib/v1/prompt-safety";
import { db, ensureSchema } from "@/lib/db";
import { requireSession } from "@/lib/session";
import type { ServerExtensionEntry } from "../types";
import {
  COMMENT_COURTROOM_ID,
  MAX_DEPTH,
  MAX_TOP_LEVEL,
  MIN_TOP_LEVEL,
  PERSONAS,
  PERSONA_KEYS,
  type CourtroomComment,
  type PersonaKey,
} from "./types";

interface ModelComment {
  persona?: unknown;
  body?: unknown;
  replies?: unknown;
}

const MIN_BODY_CHARS = 60;

const SYSTEM_PROMPT = buildSystemPrompt();

function buildSystemPrompt(): string {
  const personaLines = PERSONA_KEYS.map(
    (key) => `- ${key} (${PERSONAS[key].label}): ${PERSONAS[key].description}`,
  ).join("\n");

  return `You are simulating the comment thread that might appear under a personal blog post. The writer wants to feel the room before publishing; do not write fan mail and do not write hate.

Available personas (use exactly these keys; each persona may appear at most once at the top level):
${personaLines}

Output a thread as JSON. Schema:
{
  "comments": [
    {
      "persona": "enthusiast",
      "body": "<one to three short sentences>",
      "replies": [
        { "persona": "skeptic", "body": "..." }
      ]
    }
  ]
}

Hard rules:
- ${MIN_TOP_LEVEL} to ${MAX_TOP_LEVEL} top-level comments. Scale to draft length; longer drafts can take more comments, very short drafts get fewer.
- Replies are optional. Maximum reply depth is ${MAX_DEPTH} (a top-level comment, then a reply, then a reply to that reply at most).
- Each comment is one to three sentences. No comment longer than 280 characters.
- Comments react to the draft as written. Reference specific lines, claims, or moves; do not write generic praise or generic skepticism.
- Personas are personalities, not catchphrases. Do not start the body with the persona name. Do not greet ("hey", "hi", "great post"). Just write the comment.
- Replies must engage the parent comment, not just restate the persona. A reply that ignores its parent is invalid.
- No em-dashes. Use semicolons or new sentences instead.
- No emojis.
- Plain prose. No markdown formatting in the body.
- Match the language of the draft. German draft, German comments. English draft, English comments.
- Do not invent facts about the writer or the draft's subject. Only reference what is in the draft.

Return JSON only.`;
}

export async function runCommentCourtroom(
  draftId: string,
): Promise<{ comments: CourtroomComment[]; ranAt: number }> {
  const session = await requireSession();
  await ensureSchema();

  const draftRow = await db.execute({
    sql: `SELECT id, headline, body FROM drafts WHERE id = ? AND user_id = ?`,
    args: [draftId, session.userId],
  });
  if (draftRow.rows.length === 0) throw new Error("Draft not found.");
  const headline = String(draftRow.rows[0]!.headline ?? "").trim();
  const bodyText = stripHtml(String(draftRow.rows[0]!.body ?? ""));
  if (bodyText.length < MIN_BODY_CHARS) {
    throw new Error("Draft is too short to simulate comments; write a few more sentences first.");
  }

  const handle = await createAnthropicClient(session.userId);
  if (!handle.client) {
    throw new Error("No Anthropic auth configured. Add a key on /settings, then retry.");
  }
  const model = await getAnthropicDraftModel();

  const sourceNonce = newSourceNonce();
  const draftBlock = renderUntrustedPromptBlock(
    "source",
    sourceNonce,
    [
      { label: "HEADLINE", value: headline || "(none)", byteCap: 500 },
      { label: "BODY", value: bodyText, byteCap: 12000 },
    ],
    { attributes: { index: 1 } },
  );

  const userPrompt = `${untrustedSourceContract(sourceNonce)}

DRAFT:
${draftBlock}

Return the JSON now.`;

  const message = await handle.client.messages.create({
    model,
    max_tokens: 2400,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userPrompt }],
  });

  const text = extractText(message);
  let parsed: { comments?: ModelComment[] };
  try {
    parsed = extractJson<{ comments?: ModelComment[] }>(text);
  } catch (err) {
    throw new Error(
      `Courtroom did not return valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const persisted = await persistRun(draftId, parsed.comments ?? [], session.userId);
  return persisted;
}

async function persistRun(
  draftId: string,
  raw: ModelComment[],
  userId: string,
): Promise<{ comments: CourtroomComment[]; ranAt: number }> {
  const ranAt = Date.now();
  const flat = flattenTree(draftId, raw, ranAt);

  await db.execute({
    sql: `DELETE FROM comment_courtroom_comments WHERE draft_id = ?
          AND draft_id IN (SELECT id FROM drafts WHERE user_id = ?)`,
    args: [draftId, userId],
  });

  for (const c of flat) {
    await db.execute({
      sql: `INSERT INTO comment_courtroom_comments
            (id, draft_id, parent_id, persona_key, depth, sort_order, body, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [c.id, c.draftId, c.parentId, c.personaKey, c.depth, c.sortOrder, c.body, c.createdAt],
    });
  }

  await db.execute({
    sql: `INSERT INTO comment_courtroom_runs (draft_id, ran_at)
          SELECT ?, ? WHERE EXISTS (SELECT 1 FROM drafts WHERE id = ? AND user_id = ?)
          ON CONFLICT(draft_id) DO UPDATE SET ran_at = excluded.ran_at`,
    args: [draftId, ranAt, draftId, userId],
  });

  return { comments: flat, ranAt };
}

/**
 * Walk the model's tree, drop anything malformed, enforce caps, and
 * return a flat list with stable parent pointers and sibling ordering.
 *
 * The model is told the rules in the system prompt, but defense-in-depth
 * here keeps a misbehaving response from blowing out the panel: we cap
 * top-level count, depth, and per-comment length on the way in.
 */
function flattenTree(draftId: string, raw: ModelComment[], ranAt: number): CourtroomComment[] {
  const out: CourtroomComment[] = [];
  let topLevelCount = 0;
  const seenTopLevelPersonas = new Set<PersonaKey>();

  function visit(node: ModelComment, parentId: string | null, depth: number): void {
    if (depth > MAX_DEPTH) return;
    const personaRaw = typeof node.persona === "string" ? node.persona.trim().toLowerCase() : "";
    if (!(PERSONA_KEYS as readonly string[]).includes(personaRaw)) return;
    const personaKey = personaRaw as PersonaKey;
    const body = typeof node.body === "string" ? node.body.trim() : "";
    if (!body) return;
    const cleaned = sanitizeBody(body);
    if (!cleaned) return;

    if (depth === 0) {
      if (topLevelCount >= MAX_TOP_LEVEL) return;
      if (seenTopLevelPersonas.has(personaKey)) return;
      seenTopLevelPersonas.add(personaKey);
      topLevelCount += 1;
    }

    const id = crypto.randomUUID();
    out.push({
      id,
      draftId,
      parentId,
      personaKey,
      depth,
      sortOrder: out.length,
      body: cleaned,
      createdAt: ranAt,
    });

    const replies = Array.isArray(node.replies) ? (node.replies as ModelComment[]) : [];
    for (const reply of replies) {
      visit(reply, id, depth + 1);
    }
  }

  for (const node of raw) {
    if (topLevelCount >= MAX_TOP_LEVEL) break;
    visit(node, null, 0);
  }
  return out;
}

/**
 * Defensive cleanup for one comment body. Strips em-dashes (writer's
 * voice rule), collapses whitespace, and clips to a hard maximum so a
 * runaway model response can't push a paragraph into a margin comment.
 */
function sanitizeBody(s: string): string {
  const cleaned = s
    .replace(/\s+/g, " ")
    .replace(/[—–]/g, "; ")
    .replace(/\s*;\s*/g, "; ")
    .trim();
  if (!cleaned) return "";
  return cleaned.length > 320 ? `${cleaned.slice(0, 317).trimEnd()}…` : cleaned;
}

export async function loadCourtroomComments(
  draftId: string,
): Promise<{ comments: CourtroomComment[]; ranAt: number | null }> {
  const session = await requireSession();
  await ensureSchema();

  // Verify the draft belongs to the session user before returning any data.
  const ownership = await db.execute({
    sql: `SELECT id FROM drafts WHERE id = ? AND user_id = ?`,
    args: [draftId, session.userId],
  });
  if (ownership.rows.length === 0) {
    return { comments: [], ranAt: null };
  }

  const [r, runRow] = await Promise.all([
    db.execute({
      sql: `SELECT id, draft_id, parent_id, persona_key, depth, sort_order, body, created_at
            FROM comment_courtroom_comments
            WHERE draft_id = ?
            ORDER BY sort_order ASC`,
      args: [draftId],
    }),
    db.execute({
      sql: `SELECT ran_at FROM comment_courtroom_runs WHERE draft_id = ?`,
      args: [draftId],
    }),
  ]);
  const comments: CourtroomComment[] = r.rows.map((row) => ({
    id: String(row.id),
    draftId: String(row.draft_id),
    parentId: row.parent_id ? String(row.parent_id) : null,
    personaKey: String(row.persona_key) as PersonaKey,
    depth: Number(row.depth),
    sortOrder: Number(row.sort_order),
    body: String(row.body),
    createdAt: Number(row.created_at),
  }));
  const ranAt = runRow.rows.length > 0 ? Number(runRow.rows[0]!.ran_at) : null;
  return { comments, ranAt };
}

export async function clearCommentCourtroom(draftId: string): Promise<void> {
  const session = await requireSession();
  await ensureSchema();

  // Verify the draft belongs to the session user before deleting any data.
  const ownership = await db.execute({
    sql: `SELECT id FROM drafts WHERE id = ? AND user_id = ?`,
    args: [draftId, session.userId],
  });
  if (ownership.rows.length === 0) throw new Error("Draft not found.");

  await db.execute({
    sql: `DELETE FROM comment_courtroom_comments WHERE draft_id = ?
          AND draft_id IN (SELECT id FROM drafts WHERE user_id = ?)`,
    args: [draftId, session.userId],
  });
  await db.execute({
    sql: `DELETE FROM comment_courtroom_runs WHERE draft_id = ?
          AND draft_id IN (SELECT id FROM drafts WHERE user_id = ?)`,
    args: [draftId, session.userId],
  });
}

export const commentCourtroomServerEntry: ServerExtensionEntry = {
  id: COMMENT_COURTROOM_ID,
  // Comments are not span-anchored; the article overlay has nothing to
  // wrap. Hydration goes through the panel's own server action.
  async loadAnnotations() {
    return { annotations: [], ranAt: null };
  },
};

function stripHtml(html: string): string {
  return html
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/(p|h\d|li|blockquote)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
