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
import type { ExtensionAnnotation, ServerExtensionEntry } from "../types";
import {
  EVIDENCE_PANEL_ID,
  MAX_EVIDENCE_ITEMS,
  type EvidenceItem,
  type EvidenceStatus,
} from "./types";

interface ModelEvidence {
  claim_text?: unknown;
  status?: unknown;
  note?: unknown;
  source_title?: unknown;
  source_url?: unknown;
  quote_text?: unknown;
}

const SYSTEM_PROMPT = `You are checking a blog draft against the source bundle attached to it.

Return JSON only:
{"items":[{"claim_text":"...","status":"strong","note":"...","source_title":"...","source_url":"...","quote_text":"..."}]}

Hard rules:
- claim_text must be a verbatim substring of the draft body.
- status is exactly one of strong, thin, missing.
- strong means the attached sources directly support the claim.
- thin means the sources partly support it but the draft overstates or lacks context.
- missing means the claim is not supported by the attached sources.
- quote_text is a short source excerpt when useful, otherwise null.
- Pick at most ${MAX_EVIDENCE_ITEMS} important claims.
- No em-dashes. No markdown. Do not use outside knowledge.`;

export async function runEvidencePanel(
  draftId: string,
): Promise<{ items: EvidenceItem[]; ranAt: number }> {
  const session = await requireSession();
  await ensureSchema();
  const draft = await loadDraftBundle(draftId, session.userId);
  if (!draft) throw new Error("Draft not found.");
  if (draft.bodyText.length < 80) throw new Error("Draft is too short to check evidence.");

  const handle = await createAnthropicClient(session.userId);
  if (!handle.client)
    throw new Error("No Anthropic auth configured. Add a key on /settings, then retry.");

  const sourceNonce = newSourceNonce();
  const sourceBlock = renderUntrustedPromptBlock(
    "source",
    sourceNonce,
    [
      { label: "DRAFT", value: draft.bodyText, byteCap: 12000 },
      {
        label: "SOURCES",
        value: draft.sources
          .map((s, i) => `${i + 1}. ${s.title}\n${s.text}\n${s.url}`)
          .join("\n\n"),
        byteCap: 22000,
      },
    ],
    { attributes: { draft_id: draftId } },
  );

  const message = await handle.client.messages.create({
    model: await getAnthropicDraftModel(session.userId),
    max_tokens: 2200,
    system: `${SYSTEM_PROMPT}\n\n${untrustedSourceContract(sourceNonce)}`,
    messages: [{ role: "user", content: `${sourceBlock}\nReturn JSON now.` }],
  });

  let parsed: { items?: ModelEvidence[] };
  try {
    parsed = extractJson(extractText(message));
  } catch {
    parsed = { items: [] };
  }
  const ranAt = Date.now();
  const items = normalizeItems(draftId, parsed.items ?? [], draft.bodyText, ranAt);
  await persistItems(draftId, items, session.userId, ranAt);
  return { items, ranAt };
}

export async function loadEvidencePanelItems(
  draftId: string,
): Promise<{ items: EvidenceItem[]; ranAt: number | null }> {
  const session = await requireSession();
  await ensureSchema();
  const ownership = await db.execute({
    sql: `SELECT id FROM drafts WHERE id = ? AND user_id = ?`,
    args: [draftId, session.userId],
  });
  if (ownership.rows.length === 0) return { items: [], ranAt: null };
  const [itemsR, runR] = await Promise.all([
    db.execute({
      sql: `SELECT id, draft_id, item_index, claim_text, status, note, source_title,
                   source_url, quote_text, created_at
            FROM evidence_panel_items
            WHERE draft_id = ?
            ORDER BY item_index ASC`,
      args: [draftId],
    }),
    db.execute({
      sql: `SELECT ran_at FROM evidence_panel_runs WHERE draft_id = ?`,
      args: [draftId],
    }),
  ]);
  return {
    items: itemsR.rows.map(mapItemRow),
    ranAt: runR.rows[0] ? Number(runR.rows[0]!.ran_at) : null,
  };
}

export async function clearEvidencePanelItems(draftId: string): Promise<void> {
  const session = await requireSession();
  await ensureSchema();
  await db.batch([
    {
      sql: `DELETE FROM evidence_panel_items
            WHERE draft_id = ? AND draft_id IN (SELECT id FROM drafts WHERE user_id = ?)`,
      args: [draftId, session.userId],
    },
    {
      sql: `DELETE FROM evidence_panel_runs
            WHERE draft_id = ? AND draft_id IN (SELECT id FROM drafts WHERE user_id = ?)`,
      args: [draftId, session.userId],
    },
  ]);
}

export function evidenceItemToAnnotation(item: EvidenceItem): ExtensionAnnotation {
  return {
    id: item.id,
    index: item.itemIndex,
    spanText: item.claimText,
    tone:
      item.status === "strong" ? "positive" : item.status === "missing" ? "negative" : "neutral",
    title: `Evidence ${item.itemIndex} · ${item.status}`,
    body: item.note,
    linkUrl: item.sourceUrl,
    linkTitle: item.sourceTitle,
  };
}

async function persistItems(
  draftId: string,
  items: EvidenceItem[],
  userId: string,
  ranAt: number,
): Promise<void> {
  await db.execute({
    sql: `DELETE FROM evidence_panel_items
          WHERE draft_id = ? AND draft_id IN (SELECT id FROM drafts WHERE user_id = ?)`,
    args: [draftId, userId],
  });
  for (const item of items) {
    await db.execute({
      sql: `INSERT INTO evidence_panel_items
            (id, draft_id, item_index, claim_text, status, note, source_title,
             source_url, quote_text, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        item.id,
        draftId,
        item.itemIndex,
        item.claimText,
        item.status,
        item.note,
        item.sourceTitle,
        item.sourceUrl,
        item.quoteText,
        ranAt,
      ],
    });
  }
  await db.execute({
    sql: `INSERT INTO evidence_panel_runs (draft_id, ran_at)
          SELECT ?, ? WHERE EXISTS (SELECT 1 FROM drafts WHERE id = ? AND user_id = ?)
          ON CONFLICT(draft_id) DO UPDATE SET ran_at = excluded.ran_at`,
    args: [draftId, ranAt, draftId, userId],
  });
}

async function loadDraftBundle(draftId: string, userId: string) {
  const [draftR, sourcesR] = await db.batch([
    {
      sql: `SELECT id, cluster_id, body FROM drafts WHERE id = ? AND user_id = ?`,
      args: [draftId, userId],
    },
    {
      sql: `SELECT title, lede, body, canonical_url
            FROM items
            WHERE cluster_id = (SELECT cluster_id FROM drafts WHERE id = ? AND user_id = ?)
              AND user_id = ?
            ORDER BY published_at DESC
            LIMIT 16`,
      args: [draftId, userId, userId],
    },
  ]);
  if (draftR.rows.length === 0) return null;
  return {
    bodyText: stripHtml(String(draftR.rows[0]!.body ?? "")),
    sources: sourcesR.rows.map((row) => ({
      title: String(row.title ?? ""),
      text: stripHtml(String(row.body ?? row.lede ?? "")).slice(0, 2400),
      url: String(row.canonical_url ?? ""),
    })),
  };
}

function normalizeItems(
  draftId: string,
  raw: ModelEvidence[],
  bodyText: string,
  ranAt: number,
): EvidenceItem[] {
  const out: EvidenceItem[] = [];
  for (const entry of raw) {
    if (out.length >= MAX_EVIDENCE_ITEMS) break;
    const claimText = clean(String(entry.claim_text ?? ""), 320);
    if (!claimText || !bodyText.includes(claimText)) continue;
    const statusRaw = String(entry.status ?? "");
    const status: EvidenceStatus =
      statusRaw === "strong" || statusRaw === "missing" || statusRaw === "thin"
        ? statusRaw
        : "thin";
    const note = clean(String(entry.note ?? ""), 260);
    if (!note) continue;
    out.push({
      id: crypto.randomUUID(),
      draftId,
      itemIndex: out.length + 1,
      claimText,
      status,
      note,
      sourceTitle: nullableClean(entry.source_title, 180),
      sourceUrl: nullableUrl(entry.source_url),
      quoteText: nullableClean(entry.quote_text, 260),
      createdAt: ranAt,
    });
  }
  return out;
}

function mapItemRow(row: Record<string, unknown>): EvidenceItem {
  return {
    id: String(row.id),
    draftId: String(row.draft_id),
    itemIndex: Number(row.item_index),
    claimText: String(row.claim_text),
    status: String(row.status) as EvidenceStatus,
    note: String(row.note),
    sourceTitle: row.source_title ? String(row.source_title) : null,
    sourceUrl: row.source_url ? String(row.source_url) : null,
    quoteText: row.quote_text ? String(row.quote_text) : null,
    createdAt: Number(row.created_at),
  };
}

function clean(value: string, max: number): string {
  return value.replace(/[—–]/g, "; ").replace(/\s+/g, " ").trim().slice(0, max);
}

function nullableClean(value: unknown, max: number): string | null {
  const cleaned = clean(String(value ?? ""), max);
  return cleaned || null;
}

function nullableUrl(value: unknown): string | null {
  const cleaned = clean(String(value ?? ""), 500);
  if (!cleaned) return null;
  try {
    const url = new URL(cleaned);
    return url.protocol === "http:" || url.protocol === "https:" ? cleaned : null;
  } catch {
    return null;
  }
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export const evidencePanelServerEntry: ServerExtensionEntry = {
  id: EVIDENCE_PANEL_ID,
  async loadAnnotations(draftId) {
    const loaded = await loadEvidencePanelItems(draftId);
    return {
      annotations: loaded.items.map(evidenceItemToAnnotation),
      ranAt: loaded.ranAt,
    };
  },
};
