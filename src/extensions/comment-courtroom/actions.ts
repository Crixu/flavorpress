"use server";

import { revalidatePath } from "next/cache";
import { clearCommentCourtroom, loadCourtroomComments, runCommentCourtroom } from "./server";
import { requireEnabledExtensionSession } from "../access";
import { COMMENT_COURTROOM_ID, COMMENT_COURTROOM_LABEL } from "./types";
import type { CourtroomComment } from "./types";

export interface CourtroomPayload {
  comments: CourtroomComment[];
  ranAt: number | null;
}

export type CourtroomActionResult =
  | { ok: true; payload: CourtroomPayload }
  | { ok: false; error: string };

export async function loadCommentCourtroomAction(
  formData: FormData,
): Promise<CourtroomActionResult> {
  const draftId = String(formData.get("draftId") ?? "");
  if (!draftId) return { ok: false, error: "draftId required." };
  try {
    await requireEnabledExtensionSession(COMMENT_COURTROOM_ID, COMMENT_COURTROOM_LABEL);
    const payload = await loadCourtroomComments(draftId);
    return { ok: true, payload };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function runCommentCourtroomAction(
  formData: FormData,
): Promise<CourtroomActionResult> {
  const draftId = String(formData.get("draftId") ?? "");
  if (!draftId) return { ok: false, error: "draftId required." };
  try {
    await requireEnabledExtensionSession(COMMENT_COURTROOM_ID, COMMENT_COURTROOM_LABEL);
    const payload = await runCommentCourtroom(draftId);
    revalidatePath(`/editor/${draftId}`);
    return { ok: true, payload };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function clearCommentCourtroomAction(
  formData: FormData,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const draftId = String(formData.get("draftId") ?? "");
  if (!draftId) return { ok: false, error: "draftId required." };
  try {
    await requireEnabledExtensionSession(COMMENT_COURTROOM_ID, COMMENT_COURTROOM_LABEL);
    await clearCommentCourtroom(draftId);
    revalidatePath(`/editor/${draftId}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
