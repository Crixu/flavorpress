"use server";

import { revalidatePath } from "next/cache";
import { requireEnabledExtensionSession } from "../access";
import {
  clearAngleBuilderSuggestions,
  loadAngleBuilderSuggestions,
  runAngleBuilder,
} from "./server";
import { ANGLE_BUILDER_ID, ANGLE_BUILDER_LABEL, type AngleBuilderSuggestion } from "./types";

export interface AngleBuilderPayload {
  suggestions: AngleBuilderSuggestion[];
  ranAt: number | null;
}

type Result = { ok: true; payload: AngleBuilderPayload } | { ok: false; error: string };

export async function loadAngleBuilderAction(formData: FormData): Promise<Result> {
  const draftId = String(formData.get("draftId") ?? "");
  if (!draftId) return { ok: false, error: "draftId required." };
  try {
    await requireEnabledExtensionSession(ANGLE_BUILDER_ID, ANGLE_BUILDER_LABEL);
    return { ok: true, payload: await loadAngleBuilderSuggestions(draftId) };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

export async function runAngleBuilderAction(formData: FormData): Promise<Result> {
  const draftId = String(formData.get("draftId") ?? "");
  if (!draftId) return { ok: false, error: "draftId required." };
  try {
    await requireEnabledExtensionSession(ANGLE_BUILDER_ID, ANGLE_BUILDER_LABEL);
    const result = await runAngleBuilder(draftId);
    revalidatePath(`/editor/${draftId}`);
    return { ok: true, payload: { suggestions: result.suggestions, ranAt: result.ranAt } };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

export async function clearAngleBuilderAction(
  formData: FormData,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const draftId = String(formData.get("draftId") ?? "");
  if (!draftId) return { ok: false, error: "draftId required." };
  try {
    await requireEnabledExtensionSession(ANGLE_BUILDER_ID, ANGLE_BUILDER_LABEL);
    await clearAngleBuilderSuggestions(draftId);
    revalidatePath(`/editor/${draftId}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
