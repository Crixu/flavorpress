"use server";

import { revalidatePath } from "next/cache";
import {
  applyFactCheckFix,
  clearFactCheckClaims,
  claimToAnnotation,
  runFactCheck,
  suggestFactCheckFix,
} from "./server";
import { requireEnabledExtensionSession } from "../access";
import type { ExtensionAnnotation } from "../types";
import { FACT_CHECK_ID, FACT_CHECK_LABEL } from "./types";

export interface RunResult {
  ok: true;
  annotations: ExtensionAnnotation[];
  ranAt: number;
}

export interface RunError {
  ok: false;
  error: string;
}

export async function runFactCheckAction(formData: FormData): Promise<RunResult | RunError> {
  const draftId = String(formData.get("draftId") ?? "");
  if (!draftId) return { ok: false, error: "draftId required." };
  try {
    await requireEnabledExtensionSession(FACT_CHECK_ID, FACT_CHECK_LABEL);
    const result = await runFactCheck(draftId);
    revalidatePath(`/editor/${draftId}`);
    return {
      ok: true,
      annotations: result.claims.map(claimToAnnotation),
      ranAt: result.ranAt,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export interface SuggestResult {
  ok: true;
  /** Verbatim substring of the current body HTML. */
  original: string;
  /** Proposed replacement HTML. */
  replacement: string;
  /** One-sentence justification rooted in the source. */
  rationale: string;
}

export async function suggestFactCheckFixAction(
  formData: FormData,
): Promise<SuggestResult | RunError> {
  const draftId = String(formData.get("draftId") ?? "");
  const claimId = String(formData.get("claimId") ?? "");
  if (!draftId) return { ok: false, error: "draftId required." };
  if (!claimId) return { ok: false, error: "claimId required." };
  try {
    await requireEnabledExtensionSession(FACT_CHECK_ID, FACT_CHECK_LABEL);
    const result = await suggestFactCheckFix(draftId, claimId);
    return {
      ok: true,
      original: result.original,
      replacement: result.replacement,
      rationale: result.rationale,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export interface ApplyResult {
  ok: true;
  annotations: ExtensionAnnotation[];
  ranAt: number | null;
}

export async function applyFactCheckFixAction(formData: FormData): Promise<ApplyResult | RunError> {
  const draftId = String(formData.get("draftId") ?? "");
  const claimId = String(formData.get("claimId") ?? "");
  const original = String(formData.get("original") ?? "");
  const replacement = String(formData.get("replacement") ?? "");
  if (!draftId) return { ok: false, error: "draftId required." };
  if (!claimId) return { ok: false, error: "claimId required." };
  if (!original || !replacement) {
    return { ok: false, error: "Suggestion missing; re-suggest before applying." };
  }
  try {
    await requireEnabledExtensionSession(FACT_CHECK_ID, FACT_CHECK_LABEL);
    const result = await applyFactCheckFix(draftId, claimId, original, replacement);
    revalidatePath(`/editor/${draftId}`);
    return {
      ok: true,
      annotations: result.claims.map(claimToAnnotation),
      ranAt: result.ranAt,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function clearFactCheckAction(formData: FormData): Promise<{ ok: true } | RunError> {
  const draftId = String(formData.get("draftId") ?? "");
  if (!draftId) return { ok: false, error: "draftId required." };
  try {
    await requireEnabledExtensionSession(FACT_CHECK_ID, FACT_CHECK_LABEL);
    await clearFactCheckClaims(draftId);
    revalidatePath(`/editor/${draftId}`);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
