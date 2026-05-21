import "server-only";

import { requireSession } from "@/lib/session";
import { getEffectiveDisabledExtensionIds } from "@/lib/v1/settings";

export async function requireEnabledExtensionSession(extensionId: string, label: string) {
  const session = await requireSession();
  const disabled = await getEffectiveDisabledExtensionIds(session.userId);
  if (disabled.has(extensionId)) {
    throw new Error(`${label} is disabled in Settings.`);
  }
  return session;
}
