"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/session";
import { setExtensionEnabled, setSetting, SETTING_KEYS } from "./settings";
import { findExtensionMetadata } from "@/extensions/registry";
import { SOURCE_EXTENSIONS } from "@/extensions/source-extensions";
import type { ExtensionSettingField } from "@/extensions/types";

const ANTHROPIC_KEY_PATTERN = /^sk-ant-[a-zA-Z0-9_-]{10,}$/;
const SETTINGS_SECTIONS = new Set([
  "authentication",
  "models",
  "extensions",
  "library",
  "workflow-autopublish",
]);

type Validator = (value: string) => string | null;

const BUILT_IN_VALIDATORS: Record<string, Validator> = {
  [SETTING_KEYS.anthropicApiKey]: (v) =>
    ANTHROPIC_KEY_PATTERN.test(v) ? null : "anthropic_key_invalid",
};

function findExtensionSettingField(key: string): ExtensionSettingField | null {
  for (const ext of SOURCE_EXTENSIONS) {
    const field = ext.settings?.find((f) => f.key === key);
    if (field) return field;
  }
  return null;
}

function isAllowedKey(key: string): boolean {
  if ((Object.values(SETTING_KEYS) as string[]).includes(key)) return true;
  return findExtensionSettingField(key) !== null;
}

function getValidator(key: string): Validator | null {
  if (BUILT_IN_VALIDATORS[key]) return BUILT_IN_VALIDATORS[key];
  const field = findExtensionSettingField(key);
  return field?.validate ?? null;
}

function settingsRedirectUrl(
  formData: FormData,
  params: Record<string, string>,
): `/settings?${string}` {
  const search = new URLSearchParams();
  const section = String(formData.get("section") ?? "");
  if (SETTINGS_SECTIONS.has(section)) search.set("section", section);
  for (const [key, value] of Object.entries(params)) {
    search.set(key, value);
  }
  return `/settings?${search.toString()}`;
}

/**
 * Save (or clear) a single setting. The form must include a `key` field
 * that names which setting is being edited; an empty `value` clears the
 * stored value and reverts to the .env fallback.
 */
export async function saveSettingAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  const key = String(formData.get("key") ?? "");
  if (!isAllowedKey(key)) {
    redirect(settingsRedirectUrl(formData, { error: "invalid_key" }));
  }
  const value = String(formData.get("value") ?? "").trim();

  if (value === "") {
    await setSetting(key, session.userId, null);
    revalidatePath("/settings");
    redirect(settingsRedirectUrl(formData, { cleared: key }));
  }

  const validator = getValidator(key);
  const error = validator ? validator(value) : null;
  if (error) {
    revalidatePath("/settings");
    redirect(settingsRedirectUrl(formData, { error }));
  }

  await setSetting(key, session.userId, value);
  revalidatePath("/settings");
  redirect(settingsRedirectUrl(formData, { saved: key }));
}

export async function clearSettingAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  const key = String(formData.get("key") ?? "");
  if (!isAllowedKey(key)) {
    redirect(settingsRedirectUrl(formData, { error: "invalid_key" }));
  }
  await setSetting(key, session.userId, null);
  revalidatePath("/settings");
  redirect(settingsRedirectUrl(formData, { cleared: key }));
}

/**
 * Enable or disable a single editor extension. The form must include an
 * `extensionId` matching a registered extension and an `enabled` flag
 * ("1" to enable, anything else to disable). Editor and settings routes
 * are revalidated so the right rail updates the next time the editor
 * server-renders.
 */
export async function toggleExtensionAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  const extensionId = String(formData.get("extensionId") ?? "");
  if (!findExtensionMetadata(extensionId)) {
    redirect(settingsRedirectUrl(formData, { error: "invalid_extension" }));
  }
  const enabled = String(formData.get("enabled") ?? "") === "1";
  await setExtensionEnabled(extensionId, enabled, session.userId);
  revalidatePath("/settings");
  revalidatePath("/", "layout");
  revalidatePath("/editor", "layout");
  redirect(
    settingsRedirectUrl(formData, {
      section: "extensions",
      extension: extensionId,
      state: enabled ? "enabled" : "disabled",
    }),
  );
}
