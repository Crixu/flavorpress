"use server";

import { revalidatePath } from "next/cache";
import {
  clearFactCheckClaims,
  claimToAnnotation,
  runFactCheck,
} from "./server";
import type { ExtensionAnnotation } from "../types";

export interface RunResult {
  ok: true;
  annotations: ExtensionAnnotation[];
  ranAt: number;
}

export interface RunError {
  ok: false;
  error: string;
}

export async function runFactCheckAction(
  formData: FormData,
): Promise<RunResult | RunError> {
  const draftId = String(formData.get("draftId") ?? "");
  if (!draftId) return { ok: false, error: "draftId required." };
  try {
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

export async function clearFactCheckAction(
  formData: FormData,
): Promise<{ ok: true } | RunError> {
  const draftId = String(formData.get("draftId") ?? "");
  if (!draftId) return { ok: false, error: "draftId required." };
  await clearFactCheckClaims(draftId);
  revalidatePath(`/editor/${draftId}`);
  return { ok: true };
}
