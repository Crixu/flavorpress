import "server-only";

import { db, ensureSchema } from "@/lib/db";
import { requireSession } from "@/lib/session";
import { fingerprintText, voiceMatchScore } from "@/lib/v1/style-sheet";
import type { ExtensionAnnotation, ServerExtensionEntry } from "../types";
import {
  MAX_VOICE_GUARD_NOTES,
  VOICE_GUARD_ID,
  type VoiceGuardNote,
  type VoiceGuardNoteKind,
  type VoiceGuardSeverity,
} from "./types";

const AI_PHRASES = [
  "it is worth noting",
  "delve",
  "dive into",
  "in today's fast-paced",
  "tapestry",
  "landscape",
  "leverage",
  "unlock",
  "game changer",
];

const HEDGES = ["perhaps", "maybe", "arguably", "it seems", "it appears", "kind of", "sort of"];

export async function runVoiceGuard(
  draftId: string,
): Promise<{ notes: VoiceGuardNote[]; ranAt: number }> {
  const session = await requireSession();
  await ensureSchema();
  const loaded = await loadDraftAndProfile(draftId, session.userId);
  if (!loaded) throw new Error("Draft not found.");
  if (loaded.bodyText.length < 80) throw new Error("Draft is too short to check voice.");
  const ranAt = Date.now();
  const notes = buildNotes(draftId, loaded, ranAt);
  await persistNotes(draftId, notes, session.userId, ranAt);
  return { notes, ranAt };
}

export async function loadVoiceGuardNotes(
  draftId: string,
): Promise<{ notes: VoiceGuardNote[]; ranAt: number | null }> {
  const session = await requireSession();
  await ensureSchema();
  const ownership = await db.execute({
    sql: `SELECT id FROM drafts WHERE id = ? AND user_id = ?`,
    args: [draftId, session.userId],
  });
  if (ownership.rows.length === 0) return { notes: [], ranAt: null };
  const [notesR, runR] = await Promise.all([
    db.execute({
      sql: `SELECT id, draft_id, note_index, kind, severity, span_text, note, suggestion, created_at
            FROM voice_guard_notes
            WHERE draft_id = ?
            ORDER BY note_index ASC`,
      args: [draftId],
    }),
    db.execute({ sql: `SELECT ran_at FROM voice_guard_runs WHERE draft_id = ?`, args: [draftId] }),
  ]);
  return {
    notes: notesR.rows.map(mapNoteRow),
    ranAt: runR.rows[0] ? Number(runR.rows[0]!.ran_at) : null,
  };
}

export async function clearVoiceGuardNotes(draftId: string): Promise<void> {
  const session = await requireSession();
  await ensureSchema();
  await db.batch([
    {
      sql: `DELETE FROM voice_guard_notes
            WHERE draft_id = ? AND draft_id IN (SELECT id FROM drafts WHERE user_id = ?)`,
      args: [draftId, session.userId],
    },
    {
      sql: `DELETE FROM voice_guard_runs
            WHERE draft_id = ? AND draft_id IN (SELECT id FROM drafts WHERE user_id = ?)`,
      args: [draftId, session.userId],
    },
  ]);
}

export function voiceGuardNoteToAnnotation(note: VoiceGuardNote): ExtensionAnnotation {
  return {
    id: note.id,
    index: note.noteIndex,
    spanText: note.spanText,
    tone: note.severity === "fix" ? "negative" : note.severity === "watch" ? "neutral" : "positive",
    title: `Voice ${note.noteIndex} · ${note.kind.replace(/_/g, " ")}`,
    body: `${note.note} ${note.suggestion}`.trim(),
    linkUrl: null,
    linkTitle: null,
  };
}

async function loadDraftAndProfile(draftId: string, userId: string) {
  const [draftR, voiceR] = await db.batch([
    {
      sql: `SELECT id, outlet_id, body, voice_match_score
            FROM drafts WHERE id = ? AND user_id = ?`,
      args: [draftId, userId],
    },
    {
      sql: `SELECT function_word_distribution, sentence_length_mean, sentence_length_variance,
                   hedge_frequency, em_dash_density, banned_terms, signature_terms
            FROM voice_profiles
            WHERE outlet_id = (SELECT outlet_id FROM drafts WHERE id = ? AND user_id = ?)
              AND user_id = ?`,
      args: [draftId, userId, userId],
    },
  ]);
  if (draftR.rows.length === 0) return null;
  const voice = voiceR.rows[0];
  return {
    bodyText: stripHtml(String(draftR.rows[0]!.body ?? "")),
    savedScore: Number(draftR.rows[0]!.voice_match_score ?? 0),
    profileDistribution: voice?.function_word_distribution
      ? new Float32Array(new Uint8Array(voice.function_word_distribution as ArrayBuffer).buffer)
      : null,
    sentenceLengthMean: voice ? Number(voice.sentence_length_mean ?? 0) : 0,
    bannedTerms: voice?.banned_terms ? parseStringArray(String(voice.banned_terms)) : [],
    signatureTerms: voice?.signature_terms ? parseStringArray(String(voice.signature_terms)) : [],
  };
}

function buildNotes(
  draftId: string,
  loaded: NonNullable<Awaited<ReturnType<typeof loadDraftAndProfile>>>,
  ranAt: number,
): VoiceGuardNote[] {
  const notes: VoiceGuardNote[] = [];
  const add = (
    kind: VoiceGuardNoteKind,
    severity: VoiceGuardSeverity,
    spanText: string,
    note: string,
    suggestion: string,
  ) => {
    if (notes.length >= MAX_VOICE_GUARD_NOTES) return;
    notes.push({
      id: crypto.randomUUID(),
      draftId,
      noteIndex: notes.length + 1,
      kind,
      severity,
      spanText,
      note,
      suggestion,
      createdAt: ranAt,
    });
  };

  const score =
    loaded.profileDistribution && loaded.profileDistribution.length > 0
      ? voiceMatchScore(fingerprintText(loaded.bodyText), loaded.profileDistribution)
      : loaded.savedScore;
  if (score > 0 && score < 75) {
    add(
      "score",
      "watch",
      firstSentence(loaded.bodyText),
      `Voice match is ${score}, below the 75 target.`,
      "Rewrite the opener in the outlet's usual rhythm before pushing to WordPress.",
    );
  }

  for (const term of loaded.bannedTerms.slice(0, 30)) {
    const hit = findTermSentence(loaded.bodyText, term);
    if (hit)
      add(
        "banned_term",
        "fix",
        hit,
        `"${term}" is on this outlet's banned list.`,
        "Cut it or replace it with a term the writer actually uses.",
      );
  }

  for (const phrase of AI_PHRASES) {
    const hit = findTermSentence(loaded.bodyText, phrase);
    if (hit)
      add(
        "ai_phrase",
        "fix",
        hit,
        `"${phrase}" reads generic.`,
        "Make the sentence more concrete or remove the filler.",
      );
  }

  const emDashHit = loaded.bodyText.match(/[^.!?]{0,90}—[^.!?]{0,90}/)?.[0]?.trim();
  if (emDashHit) {
    add(
      "em_dash",
      "fix",
      emDashHit,
      "This voice rule bans em-dashes.",
      "Use a semicolon, colon, or sentence break.",
    );
  }

  for (const hedge of HEDGES) {
    const hit = findTermSentence(loaded.bodyText, hedge);
    if (hit)
      add(
        "hedge",
        "watch",
        hit,
        `"${hedge}" weakens the line.`,
        "Keep it only if the source evidence is genuinely uncertain.",
      );
  }

  const longSentence = findLongSentence(loaded.bodyText, loaded.sentenceLengthMean);
  if (longSentence) {
    add(
      "sentence_length",
      "watch",
      longSentence,
      "This sentence is much longer than the profile baseline.",
      "Split the claim and keep the sharper half.",
    );
  }

  if (notes.length === 0) {
    add(
      "voice_profile",
      "good",
      firstSentence(loaded.bodyText),
      "No obvious voice drift found.",
      "Do a final read for judgment and source fit.",
    );
  }
  return notes;
}

async function persistNotes(
  draftId: string,
  notes: VoiceGuardNote[],
  userId: string,
  ranAt: number,
): Promise<void> {
  await db.execute({
    sql: `DELETE FROM voice_guard_notes
          WHERE draft_id = ? AND draft_id IN (SELECT id FROM drafts WHERE user_id = ?)`,
    args: [draftId, userId],
  });
  for (const note of notes) {
    await db.execute({
      sql: `INSERT INTO voice_guard_notes
            (id, draft_id, note_index, kind, severity, span_text, note, suggestion, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        note.id,
        draftId,
        note.noteIndex,
        note.kind,
        note.severity,
        note.spanText,
        note.note,
        note.suggestion,
        ranAt,
      ],
    });
  }
  await db.execute({
    sql: `INSERT INTO voice_guard_runs (draft_id, ran_at)
          SELECT ?, ? WHERE EXISTS (SELECT 1 FROM drafts WHERE id = ? AND user_id = ?)
          ON CONFLICT(draft_id) DO UPDATE SET ran_at = excluded.ran_at`,
    args: [draftId, ranAt, draftId, userId],
  });
}

function mapNoteRow(row: Record<string, unknown>): VoiceGuardNote {
  return {
    id: String(row.id),
    draftId: String(row.draft_id),
    noteIndex: Number(row.note_index),
    kind: String(row.kind) as VoiceGuardNoteKind,
    severity: String(row.severity) as VoiceGuardSeverity,
    spanText: String(row.span_text),
    note: String(row.note),
    suggestion: String(row.suggestion),
    createdAt: Number(row.created_at),
  };
}

function parseStringArray(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function findTermSentence(text: string, term: string): string | null {
  const lower = text.toLowerCase();
  const needle = term.toLowerCase();
  const index = lower.indexOf(needle);
  if (index < 0) return null;
  return sentenceAround(text, index);
}

function findLongSentence(text: string, mean: number): string | null {
  const threshold = Math.max(34, mean > 0 ? Math.round(mean * 2.2) : 34);
  return splitSentences(text).find((s) => wordCount(s) > threshold) ?? null;
}

function sentenceAround(text: string, index: number): string {
  const before = text.lastIndexOf(".", index);
  const after = text.indexOf(".", index);
  return text.slice(before >= 0 ? before + 1 : 0, after >= 0 ? after + 1 : text.length).trim();
}

function firstSentence(text: string): string {
  return splitSentences(text)[0] ?? text.slice(0, 180).trim();
}

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export const voiceGuardServerEntry: ServerExtensionEntry = {
  id: VOICE_GUARD_ID,
  async loadAnnotations(draftId) {
    const loaded = await loadVoiceGuardNotes(draftId);
    return {
      annotations: loaded.notes.map(voiceGuardNoteToAnnotation),
      ranAt: loaded.ranAt,
    };
  },
};
