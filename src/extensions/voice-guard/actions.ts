"use server";

import { revalidatePath } from "next/cache";
import { requireEnabledExtensionSession } from "../access";
import type { ExtensionAnnotation } from "../types";
import {
  clearVoiceGuardNotes,
  loadVoiceGuardNotes,
  runVoiceGuard,
  voiceGuardNoteToAnnotation,
} from "./server";
import { VOICE_GUARD_ID, VOICE_GUARD_LABEL } from "./types";

type Result =
  | { ok: true; annotations: ExtensionAnnotation[]; ranAt: number | null }
  | { ok: false; error: string };

export async function runVoiceGuardAction(formData: FormData): Promise<Result> {
  const draftId = String(formData.get("draftId") ?? "");
  if (!draftId) return { ok: false, error: "draftId required." };
  try {
    await requireEnabledExtensionSession(VOICE_GUARD_ID, VOICE_GUARD_LABEL);
    const result = await runVoiceGuard(draftId);
    revalidatePath(`/editor/${draftId}`);
    return {
      ok: true,
      annotations: result.notes.map(voiceGuardNoteToAnnotation),
      ranAt: result.ranAt,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function clearVoiceGuardAction(formData: FormData): Promise<Result> {
  const draftId = String(formData.get("draftId") ?? "");
  if (!draftId) return { ok: false, error: "draftId required." };
  try {
    await requireEnabledExtensionSession(VOICE_GUARD_ID, VOICE_GUARD_LABEL);
    await clearVoiceGuardNotes(draftId);
    revalidatePath(`/editor/${draftId}`);
    return { ok: true, annotations: [], ranAt: null };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function loadVoiceGuardAction(formData: FormData): Promise<Result> {
  const draftId = String(formData.get("draftId") ?? "");
  if (!draftId) return { ok: false, error: "draftId required." };
  try {
    await requireEnabledExtensionSession(VOICE_GUARD_ID, VOICE_GUARD_LABEL);
    const result = await loadVoiceGuardNotes(draftId);
    return {
      ok: true,
      annotations: result.notes.map(voiceGuardNoteToAnnotation),
      ranAt: result.ranAt,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
