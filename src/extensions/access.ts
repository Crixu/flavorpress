import "server-only";

import { extensionIdAllowedForPlan } from "./registry";
import { requireSession } from "@/lib/session";
import { getUserPlan } from "@/lib/plans";
import { getEffectiveDisabledExtensionIds, getPaidExtensionIds } from "@/lib/v1/settings";

export async function requireEnabledExtensionSession(extensionId: string, label: string) {
  const session = await requireSession();
  const [disabled, plan, paidExtensionIds] = await Promise.all([
    getEffectiveDisabledExtensionIds(session.userId),
    getUserPlan(session.userId),
    getPaidExtensionIds(),
  ]);
  if (!extensionIdAllowedForPlan(extensionId, plan.plan, paidExtensionIds)) {
    throw new Error(`${label} requires the paid plan.`);
  }
  if (disabled.has(extensionId)) {
    throw new Error(`${label} is disabled in Settings.`);
  }
  return session;
}
