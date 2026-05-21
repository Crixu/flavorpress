"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/session";
import { getEffectiveDisabledExtensionIds } from "@/lib/v1/settings";
import {
  WORKFLOW_FOLDER_ALL,
  WORKFLOW_AUTOPUBLISH_ID,
  WORKFLOW_FRESHNESS_OPTIONS,
  normalizeWorkflowIntervalHours,
} from "./types";
import { deleteWorkflowAutopublishConfig, saveWorkflowAutopublishConfig } from "./server";

export async function saveWorkflowAutopublishAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  const outletId = String(formData.get("outletId") ?? "");
  if (!outletId) throw new Error("outletId required.");
  const disabled = await getEffectiveDisabledExtensionIds(session.userId);
  if (disabled.has(WORKFLOW_AUTOPUBLISH_ID)) {
    redirect("/settings?section=extensions&error=extension_locked_by_admin");
  }

  await saveWorkflowAutopublishConfig({
    outletId,
    userId: session.userId,
    folderScope: String(formData.get("folderScope") ?? WORKFLOW_FOLDER_ALL),
    previousFolderScope: formData.get("previousFolderScope")
      ? String(formData.get("previousFolderScope"))
      : null,
    enabled: String(formData.get("enabled") ?? "") === "1",
    intervalHours: normalizeWorkflowIntervalHours(formData.get("intervalHours")),
    autoUpdate: String(formData.get("autoUpdate") ?? "") === "1",
    freshSourceWindowHours: parseOption(
      formData.get("freshSourceWindowHours"),
      WORKFLOW_FRESHNESS_OPTIONS,
      24,
    ),
  });

  revalidatePath("/workflows");
  redirect("/workflows?saved=workflow_autopublish");
}

export async function deleteWorkflowAutopublishAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  const outletId = String(formData.get("outletId") ?? "");
  const folderScope = String(formData.get("folderScope") ?? "");
  if (!outletId || !folderScope) throw new Error("outletId and folderScope required.");
  const disabled = await getEffectiveDisabledExtensionIds(session.userId);
  if (disabled.has(WORKFLOW_AUTOPUBLISH_ID)) {
    redirect("/settings?section=extensions&error=extension_locked_by_admin");
  }

  await deleteWorkflowAutopublishConfig({ userId: session.userId, outletId, folderScope });

  revalidatePath("/workflows");
  redirect("/workflows?saved=workflow_deleted");
}

function parseOption<T extends readonly number[]>(
  raw: FormDataEntryValue | null,
  options: T,
  fallback: T[number],
): T[number] {
  const n = Number(raw);
  return options.includes(n) ? (n as T[number]) : fallback;
}
