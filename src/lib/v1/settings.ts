/**
 * App-level settings stored in the DB so the user can edit them from
 * /settings instead of bouncing to a terminal to edit .env.
 *
 * Lookup precedence: DB value (set via UI) → process.env fallback. This
 * preserves existing .env-only setups and lets ops override locally
 * without touching the DB.
 */

import { db, ensureSchema } from "../db";

export const SETTING_KEYS = {
  anthropicApiKey: "anthropic_api_key",
  anthropicDraftModel: "anthropic_draft_model",
} as const;

export type SettingKey = (typeof SETTING_KEYS)[keyof typeof SETTING_KEYS];

const DEFAULT_DRAFT_MODEL = "claude-haiku-4-5-20251001";

export async function getSetting(key: SettingKey): Promise<string | null> {
  await ensureSchema();
  const r = await db.execute({
    sql: `SELECT value FROM app_settings WHERE key = ?`,
    args: [key],
  });
  if (r.rows.length === 0) return null;
  const v = r.rows[0]!.value;
  if (v === null || v === undefined) return null;
  const s = String(v);
  return s.length > 0 ? s : null;
}

export async function setSetting(
  key: SettingKey,
  value: string | null,
): Promise<void> {
  await ensureSchema();
  if (value === null || value.trim() === "") {
    await db.execute({
      sql: `DELETE FROM app_settings WHERE key = ?`,
      args: [key],
    });
    return;
  }
  await db.execute({
    sql: `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    args: [key, value.trim(), Date.now()],
  });
}

function normalizeAnthropicKey(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("sk-ant-...")) return null;
  return trimmed;
}

export async function getAnthropicApiKey(): Promise<string | null> {
  const fromDb = await getSetting(SETTING_KEYS.anthropicApiKey);
  return normalizeAnthropicKey(fromDb) ?? normalizeAnthropicKey(process.env.ANTHROPIC_API_KEY);
}

export async function getAnthropicDraftModel(): Promise<string> {
  const fromDb = await getSetting(SETTING_KEYS.anthropicDraftModel);
  return fromDb ?? process.env.ANTHROPIC_DRAFT_MODEL ?? DEFAULT_DRAFT_MODEL;
}

export interface SettingsSnapshot {
  anthropicApiKey: { hasValue: boolean; source: "db" | "env" | "none"; preview: string | null };
  anthropicDraftModel: { value: string; source: "db" | "env" | "default" };
}

function previewSecret(value: string): string {
  if (value.length <= 8) return "•".repeat(value.length);
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

export async function loadSettingsSnapshot(): Promise<SettingsSnapshot> {
  await ensureSchema();
  const [dbApiKey, dbModel] = await Promise.all([
    getSetting(SETTING_KEYS.anthropicApiKey),
    getSetting(SETTING_KEYS.anthropicDraftModel),
  ]);

  const envApiKey = normalizeAnthropicKey(process.env.ANTHROPIC_API_KEY);
  const apiKeyValue = normalizeAnthropicKey(dbApiKey) ?? envApiKey;

  const modelValue =
    dbModel ?? process.env.ANTHROPIC_DRAFT_MODEL ?? DEFAULT_DRAFT_MODEL;

  return {
    anthropicApiKey: {
      hasValue: apiKeyValue !== null,
      source: dbApiKey
        ? "db"
        : envApiKey
          ? "env"
          : "none",
      preview: apiKeyValue ? previewSecret(apiKeyValue) : null,
    },
    anthropicDraftModel: {
      value: modelValue,
      source: dbModel ? "db" : process.env.ANTHROPIC_DRAFT_MODEL ? "env" : "default",
    },
  };
}

export const SETTING_DEFAULTS = {
  anthropicDraftModel: DEFAULT_DRAFT_MODEL,
} as const;
