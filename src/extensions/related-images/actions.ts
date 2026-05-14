"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/session";
import {
  clearRelatedImages,
  getLicenseFilter,
  loadRelatedImages,
  runRelatedImageSearch,
  setLicenseFilter,
} from "./server";
import { LICENSE_CODES, type LicenseCode, type RelatedImageResult } from "./types";

export interface RelatedImagesPayload {
  results: RelatedImageResult[];
  ranAt: number | null;
  licenseFilter: LicenseCode[];
}

export interface RunOk {
  ok: true;
  payload: RelatedImagesPayload;
}

export interface RunError {
  ok: false;
  error: string;
}

export async function loadRelatedImagesAction(formData: FormData): Promise<RunOk | RunError> {
  const draftId = String(formData.get("draftId") ?? "");
  if (!draftId) return { ok: false, error: "draftId required." };
  const [{ results, ranAt }, licenseFilter] = await Promise.all([
    loadRelatedImages(draftId),
    getLicenseFilter(),
  ]);
  return { ok: true, payload: { results, ranAt, licenseFilter } };
}

export async function runRelatedImagesAction(formData: FormData): Promise<RunOk | RunError> {
  const draftId = String(formData.get("draftId") ?? "");
  if (!draftId) return { ok: false, error: "draftId required." };
  try {
    const { results, ranAt, licenseFilter } = await runRelatedImageSearch(draftId);
    revalidatePath(`/editor/${draftId}`);
    return {
      ok: true,
      payload: { results, ranAt, licenseFilter },
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function clearRelatedImagesAction(
  formData: FormData,
): Promise<{ ok: true } | RunError> {
  const draftId = String(formData.get("draftId") ?? "");
  if (!draftId) return { ok: false, error: "draftId required." };
  await clearRelatedImages(draftId);
  revalidatePath(`/editor/${draftId}`);
  return { ok: true };
}

export async function setLicenseFilterAction(formData: FormData): Promise<RunOk | RunError> {
  try {
    const session = await requireSession();
    const draftId = String(formData.get("draftId") ?? "");
    const raw = String(formData.get("codes") ?? "");
    const codes = raw
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter((s): s is LicenseCode => (LICENSE_CODES as readonly string[]).includes(s));
    const licenseFilter = await setLicenseFilter(codes, session.userId);
    if (draftId) {
      const { results, ranAt } = await loadRelatedImages(draftId);
      return {
        ok: true,
        payload: { results, ranAt, licenseFilter },
      };
    }
    return {
      ok: true,
      payload: { results: [], ranAt: null, licenseFilter },
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
