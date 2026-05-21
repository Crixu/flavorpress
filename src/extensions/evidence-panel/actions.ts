"use server";

import { revalidatePath } from "next/cache";
import { requireEnabledExtensionSession } from "../access";
import type { ExtensionAnnotation } from "../types";
import {
  clearEvidencePanelItems,
  evidenceItemToAnnotation,
  loadEvidencePanelItems,
  runEvidencePanel,
} from "./server";
import { EVIDENCE_PANEL_ID, EVIDENCE_PANEL_LABEL } from "./types";

type RunResult =
  | { ok: true; annotations: ExtensionAnnotation[]; ranAt: number | null }
  | { ok: false; error: string };

export async function runEvidencePanelAction(formData: FormData): Promise<RunResult> {
  const draftId = String(formData.get("draftId") ?? "");
  if (!draftId) return { ok: false, error: "draftId required." };
  try {
    await requireEnabledExtensionSession(EVIDENCE_PANEL_ID, EVIDENCE_PANEL_LABEL);
    const result = await runEvidencePanel(draftId);
    revalidatePath(`/editor/${draftId}`);
    return {
      ok: true,
      annotations: result.items.map(evidenceItemToAnnotation),
      ranAt: result.ranAt,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function clearEvidencePanelAction(formData: FormData): Promise<RunResult> {
  const draftId = String(formData.get("draftId") ?? "");
  if (!draftId) return { ok: false, error: "draftId required." };
  try {
    await requireEnabledExtensionSession(EVIDENCE_PANEL_ID, EVIDENCE_PANEL_LABEL);
    await clearEvidencePanelItems(draftId);
    revalidatePath(`/editor/${draftId}`);
    return { ok: true, annotations: [], ranAt: null };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function loadEvidencePanelAction(formData: FormData): Promise<RunResult> {
  const draftId = String(formData.get("draftId") ?? "");
  if (!draftId) return { ok: false, error: "draftId required." };
  try {
    await requireEnabledExtensionSession(EVIDENCE_PANEL_ID, EVIDENCE_PANEL_LABEL);
    const result = await loadEvidencePanelItems(draftId);
    return {
      ok: true,
      annotations: result.items.map(evidenceItemToAnnotation),
      ranAt: result.ranAt,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
