"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/session";
import { getEffectiveDisabledExtensionIds } from "@/lib/v1/settings";
import {
  WORKFLOW_AUTOPUBLISH_ID,
  WORKFLOW_FRESHNESS_OPTIONS,
  WORKFLOW_INTERVAL_OPTIONS,
} from "./types";
import { saveWorkflowAutopublishConfig } from "./server";

export async function saveWorkflowAutopublishAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  const outletId = String(formData.get("outletId") ?? "");
  if (!outletId) throw new Error("outletId required.");
  const section =
    String(formData.get("section") ?? "") === "workflow-autopublish"
      ? "workflow-autopublish"
      : "extensions";
  const disabled = await getEffectiveDisabledExtensionIds(session.userId);
  if (disabled.has(WORKFLOW_AUTOPUBLISH_ID)) {
    redirect(`/settings?section=${section}&error=extension_locked_by_admin`);
  }

  await saveWorkflowAutopublishConfig({
    outletId,
    userId: session.userId,
    enabled: String(formData.get("enabled") ?? "") === "1",
    intervalHours: parseOption(formData.get("intervalHours"), WORKFLOW_INTERVAL_OPTIONS, 12),
    autoUpdate: String(formData.get("autoUpdate") ?? "") === "1",
    freshSourceWindowHours: parseOption(
      formData.get("freshSourceWindowHours"),
      WORKFLOW_FRESHNESS_OPTIONS,
      24,
    ),
  });

  revalidatePath("/settings");
  redirect(`/settings?section=${section}&saved=workflow_autopublish`);
}

function parseOption<T extends readonly number[]>(
  raw: FormDataEntryValue | null,
  options: T,
  fallback: T[number],
): T[number] {
  const n = Number(raw);
  return options.includes(n) ? (n as T[number]) : fallback;
}
