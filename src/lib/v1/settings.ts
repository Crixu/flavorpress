/**
 * Per-user settings stored in the DB so each writer can edit them from
 * /settings instead of bouncing to a terminal to edit .env.
 *
 * Lookup precedence: user DB value (set via UI), then process.env fallback. This
 * preserves existing .env-only setups and lets ops override locally
 * without touching the DB.
 */

import { db, ensureSchema } from "../db";
import { decryptSecret, encryptSecret, isEncryptedSecret } from "../secret-crypto";

export const SETTING_KEYS = {
  anthropicApiKey: "anthropic_api_key",
  anthropicDraftModel: "anthropic_draft_model",
  relatedImagesLicenseFilter: "related_images_license_filter",
  disabledExtensions: "disabled_extensions",
} as const;

export type SettingKey = (typeof SETTING_KEYS)[keyof typeof SETTING_KEYS];

const DEPLOYMENT_SETTING_KEYS = {
  globallyDisabledExtensions: "globally_disabled_extensions",
} as const;

const DEFAULT_DRAFT_MODEL = "claude-haiku-4-5-20251001";
const SENSITIVE_SETTING_PATTERN = /(^|_)(api_key|password|secret|token|credential)(_|$)/i;

export function isSensitiveSettingKey(key: string): boolean {
  return key === SETTING_KEYS.anthropicApiKey || SENSITIVE_SETTING_PATTERN.test(key);
}

function normalizeUserId(userId: string): string {
  const trimmed = userId.trim();
  if (!trimmed) throw new Error("userId required for settings.");
  return trimmed;
}

/**
 * Read any user_settings row. Built-in keys live in SETTING_KEYS;
 * extension-owned keys (e.g. x_bridge_template) are passed as raw
 * strings so the extension layer can keep its key constants local.
 */
export async function getSetting(key: string, userId: string): Promise<string | null> {
  await ensureSchema();
  const scopedUserId = normalizeUserId(userId);
  const r = await db.execute({
    sql: `SELECT value FROM user_settings WHERE user_id = ? AND key = ?`,
    args: [scopedUserId, key],
  });
  if (r.rows.length === 0) return null;
  const v = r.rows[0]!.value;
  if (v === null || v === undefined) return null;
  const s = String(v);
  if (s.length === 0) return null;
  if (!isSensitiveSettingKey(key)) return s;
  if (isEncryptedSecret(s)) return decryptSecret(s);

  await db.execute({
    sql: `UPDATE user_settings SET value = ?, updated_at = ? WHERE user_id = ? AND key = ?`,
    args: [encryptSecret(s), Date.now(), scopedUserId, key],
  });
  return s;
}

export async function setSetting(key: string, userId: string, value: string | null): Promise<void> {
  await ensureSchema();
  const scopedUserId = normalizeUserId(userId);
  if (value === null || value.trim() === "") {
    await db.execute({
      sql: `DELETE FROM user_settings WHERE user_id = ? AND key = ?`,
      args: [scopedUserId, key],
    });
    return;
  }
  const trimmed = value.trim();
  const storedValue = isSensitiveSettingKey(key) ? encryptSecret(trimmed) : trimmed;
  await db.execute({
    sql: `INSERT INTO user_settings (user_id, key, value, updated_at) VALUES (?, ?, ?, ?)
          ON CONFLICT(user_id, key) DO UPDATE SET
            value = excluded.value,
            updated_at = excluded.updated_at`,
    args: [scopedUserId, key, storedValue, Date.now()],
  });
}

function normalizeAnthropicKey(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("sk-ant-...")) return null;
  return trimmed;
}

export async function getAnthropicApiKey(userId: string): Promise<string | null> {
  const fromDb = await getSetting(SETTING_KEYS.anthropicApiKey, userId);
  return normalizeAnthropicKey(fromDb) ?? normalizeAnthropicKey(process.env.ANTHROPIC_API_KEY);
}

export async function getAnthropicDraftModel(userId: string): Promise<string> {
  const fromDb = await getSetting(SETTING_KEYS.anthropicDraftModel, userId);
  return fromDb ?? process.env.ANTHROPIC_DRAFT_MODEL ?? DEFAULT_DRAFT_MODEL;
}

export interface SettingsSnapshot {
  anthropicApiKey: { hasValue: boolean; source: "db" | "env" | "none"; preview: string | null };
  anthropicDraftModel: { value: string; source: "db" | "env" | "default" };
  disabledExtensionIds: string[];
  adminDisabledExtensionIds: string[];
  globallyDisabledExtensionIds: string[];
  /**
   * Values for extension-registered settings, keyed by setting key.
   * Sourced strictly from the DB; extensions decide their own env-var
   * fallbacks when they read the value at runtime.
   */
  extensionSettings: Record<string, { value: string | null; source: "db" | "none" }>;
}

/**
 * Disabled extensions are stored as a JSON array of extension IDs. An
 * absent setting is treated as "all enabled," which keeps the default
 * working without seeding a row, and means new extensions ship enabled.
 */
export async function getDisabledExtensionIds(userId: string): Promise<Set<string>> {
  const raw = await getSetting(SETTING_KEYS.disabledExtensions, userId);
  if (!raw) return new Set();
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((x): x is string => typeof x === "string"));
  } catch {
    return new Set();
  }
}

export async function setExtensionEnabled(
  extensionId: string,
  enabled: boolean,
  userId: string,
): Promise<void> {
  const current = await getDisabledExtensionIds(userId);
  if (enabled) current.delete(extensionId);
  else current.add(extensionId);
  if (current.size === 0) {
    await setSetting(SETTING_KEYS.disabledExtensions, userId, null);
    return;
  }
  await setSetting(SETTING_KEYS.disabledExtensions, userId, JSON.stringify([...current].sort()));
}

/**
 * Admin-enforced per-user extension access. Rows are sparse: no row means
 * the user is allowed to access the extension, and a row with enabled=0
 * blocks access regardless of the user's own Settings preference.
 */
export async function getAdminDisabledExtensionIds(userId: string): Promise<Set<string>> {
  await ensureSchema();
  const scopedUserId = normalizeUserId(userId);
  const r = await db.execute({
    sql: `SELECT extension_id FROM user_extension_access
          WHERE user_id = ? AND enabled = 0`,
    args: [scopedUserId],
  });
  return new Set(r.rows.map((row) => String(row.extension_id)));
}

export async function setUserExtensionAccess(
  extensionId: string,
  userId: string,
  enabled: boolean,
): Promise<void> {
  await ensureSchema();
  const scopedUserId = normalizeUserId(userId);
  if (enabled) {
    await db.execute({
      sql: `DELETE FROM user_extension_access
            WHERE user_id = ? AND extension_id = ?`,
      args: [scopedUserId, extensionId],
    });
    return;
  }

  await db.execute({
    sql: `INSERT INTO user_extension_access (user_id, extension_id, enabled, updated_at)
          VALUES (?, ?, 0, ?)
          ON CONFLICT(user_id, extension_id) DO UPDATE SET
            enabled = 0,
            updated_at = excluded.updated_at`,
    args: [scopedUserId, extensionId, Date.now()],
  });
}

/**
 * Deployment-wide kill switch for extensions. Stored once in
 * deployment_settings (singleton, no user_id scope) so an admin can flip
 * an extension off for every user at once. Effective state at runtime is
 * the union of this set with the user's own disabled set; see
 * getEffectiveDisabledExtensionIds.
 */
export async function getGloballyDisabledExtensionIds(): Promise<Set<string>> {
  await ensureSchema();
  const r = await db.execute({
    sql: `SELECT value FROM deployment_settings WHERE key = ?`,
    args: [DEPLOYMENT_SETTING_KEYS.globallyDisabledExtensions],
  });
  if (r.rows.length === 0) return new Set();
  const raw = r.rows[0]!.value;
  if (raw === null || raw === undefined) return new Set();
  try {
    const parsed = JSON.parse(String(raw)) as unknown;
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((x): x is string => typeof x === "string"));
  } catch {
    return new Set();
  }
}

export async function setExtensionGloballyEnabled(
  extensionId: string,
  enabled: boolean,
): Promise<void> {
  await ensureSchema();
  const current = await getGloballyDisabledExtensionIds();
  if (enabled) current.delete(extensionId);
  else current.add(extensionId);
  const now = Date.now();
  if (current.size === 0) {
    await db.execute({
      sql: `DELETE FROM deployment_settings WHERE key = ?`,
      args: [DEPLOYMENT_SETTING_KEYS.globallyDisabledExtensions],
    });
    return;
  }
  await db.execute({
    sql: `INSERT INTO deployment_settings (key, value, updated_at)
          VALUES (?, ?, ?)
          ON CONFLICT(key) DO UPDATE SET
            value = excluded.value,
            updated_at = excluded.updated_at`,
    args: [
      DEPLOYMENT_SETTING_KEYS.globallyDisabledExtensions,
      JSON.stringify([...current].sort()),
      now,
    ],
  });
}

/**
 * The set the runtime should gate on. Union of the deployment-wide kill
 * switch, admin-enforced user blocks, and the user's own preferences.
 */
export async function getEffectiveDisabledExtensionIds(userId: string): Promise<Set<string>> {
  const [global, admin, user] = await Promise.all([
    getGloballyDisabledExtensionIds(),
    getAdminDisabledExtensionIds(userId),
    getDisabledExtensionIds(userId),
  ]);
  for (const id of admin) global.add(id);
  for (const id of user) global.add(id);
  return global;
}

function previewSecret(value: string): string {
  if (value.length <= 8) return "•".repeat(value.length);
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

export async function loadSettingsSnapshot(
  userId: string,
  extensionSettingKeys: string[] = [],
): Promise<SettingsSnapshot> {
  await ensureSchema();
  const [dbApiKey, dbModel, disabled, adminDisabled, globallyDisabled, extensionValues] =
    await Promise.all([
      getSetting(SETTING_KEYS.anthropicApiKey, userId),
      getSetting(SETTING_KEYS.anthropicDraftModel, userId),
      getDisabledExtensionIds(userId),
      getAdminDisabledExtensionIds(userId),
      getGloballyDisabledExtensionIds(),
      Promise.all(extensionSettingKeys.map(async (k) => [k, await getSetting(k, userId)] as const)),
    ]);

  const envApiKey = normalizeAnthropicKey(process.env.ANTHROPIC_API_KEY);
  const apiKeyValue = normalizeAnthropicKey(dbApiKey) ?? envApiKey;

  const modelValue = dbModel ?? process.env.ANTHROPIC_DRAFT_MODEL ?? DEFAULT_DRAFT_MODEL;

  const extensionSettings: SettingsSnapshot["extensionSettings"] = {};
  for (const [key, value] of extensionValues) {
    extensionSettings[key] = {
      value: value && isSensitiveSettingKey(key) ? previewSecret(value) : value,
      source: value ? "db" : "none",
    };
  }

  return {
    anthropicApiKey: {
      hasValue: apiKeyValue !== null,
      source: dbApiKey ? "db" : envApiKey ? "env" : "none",
      preview: apiKeyValue ? previewSecret(apiKeyValue) : null,
    },
    anthropicDraftModel: {
      value: modelValue,
      source: dbModel ? "db" : process.env.ANTHROPIC_DRAFT_MODEL ? "env" : "default",
    },
    disabledExtensionIds: [...disabled].sort(),
    adminDisabledExtensionIds: [...adminDisabled].sort(),
    globallyDisabledExtensionIds: [...globallyDisabled].sort(),
    extensionSettings,
  };
}

export const SETTING_DEFAULTS = {
  anthropicDraftModel: DEFAULT_DRAFT_MODEL,
} as const;
