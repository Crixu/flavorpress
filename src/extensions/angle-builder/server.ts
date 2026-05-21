import "server-only";

import { createAnthropicClient, extractJson, extractText } from "@/lib/anthropic";
import { db, ensureSchema } from "@/lib/db";
import { requireSession } from "@/lib/session";
import { getAnthropicDraftModel } from "@/lib/v1/settings";
import {
  newSourceNonce,
  renderUntrustedPromptBlock,
  untrustedSourceContract,
} from "@/lib/v1/prompt-safety";
import type { ServerExtensionEntry } from "../types";
import {
  ANGLE_BUILDER_ID,
  MAX_ANGLES,
  type AngleBuilderKind,
  type AngleBuilderSuggestion,
} from "./types";

interface ModelAngle {
  kind?: unknown;
  title?: unknown;
  thesis?: unknown;
  why?: unknown;
  source_cue?: unknown;
}

const KINDS: AngleBuilderKind[] = ["archive", "gap", "stance", "reader"];
const KIND_LABELS: Record<AngleBuilderKind, string> = {
  archive: "Archive contrast",
  gap: "Undercovered detail",
  stance: "Sharper stance",
  reader: "Reader on-ramp",
};

const SYSTEM_PROMPT = `You propose draft angles for a prosumer blogger.

Return JSON only:
{"angles":[{"kind":"archive","title":"...","thesis":"...","why":"...","source_cue":"..."}]}

Hard rules:
- Return exactly four angles, one per kind: archive, gap, stance, reader.
- Every angle must be grounded in the provided draft and source bundle.
- title is at most 90 characters.
- thesis is one sentence the writer could use as the draft's controlling idea.
- why is one short sentence explaining why this angle is worth writing today.
- source_cue names the source detail that makes the angle defensible.
- No em-dashes. No markdown. No invented facts.`;

export async function runAngleBuilder(
  draftId: string,
): Promise<{ suggestions: AngleBuilderSuggestion[]; ranAt: number }> {
  const session = await requireSession();
  await ensureSchema();
  const draft = await loadDraftBundle(draftId, session.userId);
  if (!draft) throw new Error("Draft not found.");
  if (draft.bodyText.length < 80) throw new Error("Draft is too short to build angles.");

  const handle = await createAnthropicClient(session.userId);
  const ranAt = Date.now();
  if (!handle.client) {
    throw new Error("No Anthropic auth configured. Add a key on /settings, then retry.");
  }

  const sourceNonce = newSourceNonce();
  const sourceBlock = renderUntrustedPromptBlock(
    "source",
    sourceNonce,
    [
      { label: "HEADLINE", value: draft.headline || "(none)", byteCap: 500 },
      { label: "DRAFT", value: draft.bodyText, byteCap: 10000 },
      {
        label: "SOURCES",
        value: draft.sources
          .map((s, i) => `${i + 1}. ${s.title}\n${s.lede}\n${s.url}`)
          .join("\n\n"),
        byteCap: 16000,
      },
      { label: "VOICE PROFILE", value: draft.voiceProfile ?? "(not configured)", byteCap: 4000 },
    ],
    { attributes: { draft_id: draftId } },
  );

  const message = await handle.client.messages.create({
    model: await getAnthropicDraftModel(session.userId),
    max_tokens: 1600,
    system: `${SYSTEM_PROMPT}\n\n${untrustedSourceContract(sourceNonce)}`,
    messages: [{ role: "user", content: `${sourceBlock}\nReturn JSON now.` }],
  });

  let parsed: { angles?: ModelAngle[] };
  try {
    parsed = extractJson(extractText(message));
  } catch {
    parsed = { angles: [] };
  }
  const suggestions = normalizeAngles(draftId, parsed.angles ?? [], ranAt);
  if (suggestions.length === 0) {
    throw new Error(
      "Angle builder did not return usable source-grounded angles. Retry after editing the draft or sources.",
    );
  }
  return { suggestions: await persistSuggestions(draftId, suggestions, session.userId), ranAt };
}

export async function loadAngleBuilderSuggestions(
  draftId: string,
): Promise<{ suggestions: AngleBuilderSuggestion[]; ranAt: number | null }> {
  const session = await requireSession();
  await ensureSchema();
  const ownership = await db.execute({
    sql: `SELECT id FROM drafts WHERE id = ? AND user_id = ?`,
    args: [draftId, session.userId],
  });
  if (ownership.rows.length === 0) return { suggestions: [], ranAt: null };
  const [rows, run] = await Promise.all([
    db.execute({
      sql: `SELECT id, draft_id, angle_index, kind, label, title, thesis, why, source_cue, created_at
            FROM angle_builder_suggestions
            WHERE draft_id = ?
            ORDER BY angle_index ASC`,
      args: [draftId],
    }),
    db.execute({
      sql: `SELECT ran_at FROM angle_builder_runs WHERE draft_id = ?`,
      args: [draftId],
    }),
  ]);
  return {
    suggestions: rows.rows.map(mapSuggestionRow),
    ranAt: run.rows[0] ? Number(run.rows[0]!.ran_at) : null,
  };
}

export async function clearAngleBuilderSuggestions(draftId: string): Promise<void> {
  const session = await requireSession();
  await ensureSchema();
  await db.batch([
    {
      sql: `DELETE FROM angle_builder_suggestions
            WHERE draft_id = ? AND draft_id IN (SELECT id FROM drafts WHERE user_id = ?)`,
      args: [draftId, session.userId],
    },
    {
      sql: `DELETE FROM angle_builder_runs
            WHERE draft_id = ? AND draft_id IN (SELECT id FROM drafts WHERE user_id = ?)`,
      args: [draftId, session.userId],
    },
  ]);
}

async function persistSuggestions(
  draftId: string,
  suggestions: AngleBuilderSuggestion[],
  userId: string,
): Promise<AngleBuilderSuggestion[]> {
  const ranAt = suggestions[0]?.createdAt ?? Date.now();
  await db.execute({
    sql: `DELETE FROM angle_builder_suggestions
          WHERE draft_id = ? AND draft_id IN (SELECT id FROM drafts WHERE user_id = ?)`,
    args: [draftId, userId],
  });
  for (const s of suggestions) {
    await db.execute({
      sql: `INSERT INTO angle_builder_suggestions
            (id, draft_id, angle_index, kind, label, title, thesis, why, source_cue, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        s.id,
        draftId,
        s.angleIndex,
        s.kind,
        s.label,
        s.title,
        s.thesis,
        s.why,
        s.sourceCue,
        ranAt,
      ],
    });
  }
  await db.execute({
    sql: `INSERT INTO angle_builder_runs (draft_id, ran_at)
          SELECT ?, ? WHERE EXISTS (SELECT 1 FROM drafts WHERE id = ? AND user_id = ?)
          ON CONFLICT(draft_id) DO UPDATE SET ran_at = excluded.ran_at`,
    args: [draftId, ranAt, draftId, userId],
  });
  return suggestions;
}

async function loadDraftBundle(draftId: string, userId: string) {
  const [draftR, sourcesR, voiceR] = await db.batch([
    {
      sql: `SELECT id, cluster_id, outlet_id, headline, body
            FROM drafts WHERE id = ? AND user_id = ?`,
      args: [draftId, userId],
    },
    {
      sql: `SELECT i.title, i.lede, i.body, i.canonical_url
            FROM items i
            WHERE i.cluster_id = (SELECT cluster_id FROM drafts WHERE id = ? AND user_id = ?)
              AND i.user_id = ?
            ORDER BY i.published_at DESC
            LIMIT 12`,
      args: [draftId, userId, userId],
    },
    {
      sql: `SELECT style_sheet_yaml, description
            FROM voice_profiles
            WHERE outlet_id = (SELECT outlet_id FROM drafts WHERE id = ? AND user_id = ?)
              AND user_id = ?`,
      args: [draftId, userId, userId],
    },
  ]);
  if (draftR.rows.length === 0) return null;
  const draft = draftR.rows[0]!;
  const voice = voiceR.rows[0];
  return {
    headline: String(draft.headline ?? ""),
    bodyText: stripHtml(String(draft.body ?? "")),
    voiceProfile: voice
      ? `${String(voice.description ?? "")}\n${String(voice.style_sheet_yaml ?? "")}`.trim()
      : null,
    sources: sourcesR.rows.map((row) => ({
      title: String(row.title ?? ""),
      lede: String(row.lede ?? row.body ?? "").slice(0, 1600),
      url: String(row.canonical_url ?? ""),
    })),
  };
}

function normalizeAngles(
  draftId: string,
  raw: ModelAngle[],
  ranAt: number,
): AngleBuilderSuggestion[] {
  const byKind = new Map<AngleBuilderKind, AngleBuilderSuggestion>();
  for (const entry of raw) {
    const kindRaw = String(entry.kind ?? "");
    if (!KINDS.includes(kindRaw as AngleBuilderKind)) continue;
    const kind = kindRaw as AngleBuilderKind;
    const title = clean(String(entry.title ?? ""), 120);
    const thesis = clean(String(entry.thesis ?? ""), 260);
    const why = clean(String(entry.why ?? ""), 220);
    const sourceCue = clean(String(entry.source_cue ?? ""), 220);
    if (!title || !thesis || !why || !sourceCue || byKind.has(kind)) continue;
    byKind.set(kind, {
      id: crypto.randomUUID(),
      draftId,
      angleIndex: KINDS.indexOf(kind) + 1,
      kind,
      label: KIND_LABELS[kind],
      title,
      thesis,
      why,
      sourceCue,
      createdAt: ranAt,
    });
  }
  return KINDS.map((kind) => byKind.get(kind))
    .filter((suggestion): suggestion is AngleBuilderSuggestion => Boolean(suggestion))
    .slice(0, MAX_ANGLES);
}

function mapSuggestionRow(row: Record<string, unknown>): AngleBuilderSuggestion {
  return {
    id: String(row.id),
    draftId: String(row.draft_id),
    angleIndex: Number(row.angle_index),
    kind: String(row.kind) as AngleBuilderKind,
    label: String(row.label),
    title: String(row.title),
    thesis: String(row.thesis),
    why: String(row.why),
    sourceCue: String(row.source_cue),
    createdAt: Number(row.created_at),
  };
}

function clean(value: string, max: number): string {
  return value.replace(/[—–]/g, "; ").replace(/\s+/g, " ").trim().slice(0, max);
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export const angleBuilderServerEntry: ServerExtensionEntry = {
  id: ANGLE_BUILDER_ID,
  async loadAnnotations() {
    return { annotations: [], ranAt: null };
  },
};
