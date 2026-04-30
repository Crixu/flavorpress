"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { setSetting, SETTING_KEYS, type SettingKey } from "./settings";

const ANTHROPIC_KEY_PATTERN = /^sk-ant-[a-zA-Z0-9_-]{10,}$/;

const VALIDATORS: Partial<Record<SettingKey, (value: string) => string | null>> = {
  [SETTING_KEYS.anthropicApiKey]: (v) =>
    ANTHROPIC_KEY_PATTERN.test(v) ? null : "anthropic_key_invalid",
};

function isAllowedKey(key: string): key is SettingKey {
  return (Object.values(SETTING_KEYS) as string[]).includes(key);
}

/**
 * Save (or clear) a single setting. The form must include a `key` field
 * that names which setting is being edited; an empty `value` clears the
 * stored value and reverts to the .env fallback.
 */
export async function saveSettingAction(formData: FormData): Promise<void> {
  const key = String(formData.get("key") ?? "");
  if (!isAllowedKey(key)) {
    redirect("/settings?error=invalid_key");
  }
  const settingKey = key as SettingKey;
  const value = String(formData.get("value") ?? "").trim();

  if (value === "") {
    await setSetting(settingKey, null);
    revalidatePath("/settings");
    redirect(`/settings?cleared=${encodeURIComponent(settingKey)}`);
  }

  const validator = VALIDATORS[settingKey];
  const error = validator ? validator(value) : null;
  if (error) {
    revalidatePath("/settings");
    redirect(`/settings?error=${encodeURIComponent(error)}`);
  }

  await setSetting(settingKey, value);
  revalidatePath("/settings");
  redirect(`/settings?saved=${encodeURIComponent(settingKey)}`);
}

export async function clearSettingAction(formData: FormData): Promise<void> {
  const key = String(formData.get("key") ?? "");
  if (!isAllowedKey(key)) {
    redirect("/settings?error=invalid_key");
  }
  await setSetting(key as SettingKey, null);
  revalidatePath("/settings");
  redirect(`/settings?cleared=${encodeURIComponent(key)}`);
}
