import "server-only";

import { db, ensureSchema } from "../db";
import {
  DEFAULT_DRAFT_FORMAT,
  DRAFT_FORMAT_PRESETS,
  DRAFT_FORMATS,
  defaultDraftFormatOptions,
  isDraftFormat,
  presetDraftFormatOption,
  type DraftFormat,
  type DraftFormatOption,
} from "./draft-format";

export const MAX_OUTLET_FORMATS = 5;
export const MAX_FORMAT_NAME_LENGTH = 64;
export const MAX_FORMAT_INSTRUCTIONS_LENGTH = 1200;

interface OutletFormatRow {
  format_key: string;
  name: string;
  instructions: string;
  preset_id: string | null;
  sort_order: number;
}

function rowToOption(row: OutletFormatRow): DraftFormatOption {
  const presetId = isDraftFormat(row.preset_id) ? row.preset_id : null;
  return {
    key: String(row.format_key),
    name: String(row.name),
    instructions: String(row.instructions),
    presetId,
  };
}

function normalizeName(raw: FormDataEntryValue | null): string {
  const value = String(raw ?? "")
    .trim()
    .replace(/\s+/g, " ");
  if (!value) throw new Error("Format name required.");
  return value.slice(0, MAX_FORMAT_NAME_LENGTH);
}

function normalizeInstructions(raw: FormDataEntryValue | null): string {
  const value = String(raw ?? "").trim();
  if (!value) throw new Error("Format instructions required.");
  return value.slice(0, MAX_FORMAT_INSTRUCTIONS_LENGTH);
}

function normalizeKey(raw: FormDataEntryValue | null): string {
  const value = String(raw ?? "").trim();
  if (!value) throw new Error("formatKey required.");
  return value.slice(0, 120);
}

function normalizePreset(raw: FormDataEntryValue | null): DraftFormat {
  const value = String(raw ?? "").trim();
  if (!isDraftFormat(value)) throw new Error("Unknown format preset.");
  return value;
}

async function assertOutletOwner(outletId: string, userId: string): Promise<void> {
  const r = await db.execute({
    sql: `SELECT id FROM outlets WHERE id = ? AND user_id = ?`,
    args: [outletId, userId],
  });
  if (r.rows.length === 0) throw new Error("Outlet not found.");
}

async function loadPersistedOutletFormats(
  outletId: string,
  userId: string,
): Promise<DraftFormatOption[]> {
  const r = await db.execute({
    sql: `SELECT format_key, name, instructions, preset_id, sort_order
          FROM outlet_formats
          WHERE outlet_id = ? AND user_id = ?
          ORDER BY sort_order ASC, created_at ASC`,
    args: [outletId, userId],
  });
  return r.rows.map((row) => rowToOption(row as unknown as OutletFormatRow));
}

export async function listOutletFormats(
  outletId: string,
  userId: string,
): Promise<DraftFormatOption[]> {
  await ensureSchema();
  await assertOutletOwner(outletId, userId);
  const rows = await loadPersistedOutletFormats(outletId, userId);
  return rows.length > 0 ? rows : defaultDraftFormatOptions();
}

export async function listOutletFormatsForUser(
  userId: string,
): Promise<Map<string, DraftFormatOption[]>> {
  await ensureSchema();
  const r = await db.execute({
    sql: `SELECT outlet_id, format_key, name, instructions, preset_id, sort_order
          FROM outlet_formats
          WHERE user_id = ?
          ORDER BY outlet_id ASC, sort_order ASC, created_at ASC`,
    args: [userId],
  });
  const map = new Map<string, DraftFormatOption[]>();
  for (const row of r.rows as unknown as Array<OutletFormatRow & { outlet_id: string }>) {
    const outletId = String(row.outlet_id);
    const list = map.get(outletId) ?? [];
    list.push(rowToOption(row));
    map.set(outletId, list);
  }
  return map;
}

export async function resolveOutletDraftFormat(input: {
  outletId: string;
  userId: string;
  formatKey?: string | null;
}): Promise<DraftFormatOption> {
  const formats = await listOutletFormats(input.outletId, input.userId);
  const requested = String(input.formatKey ?? "").trim();
  const found = requested ? formats.find((format) => format.key === requested) : null;
  return found ?? formats[0] ?? presetDraftFormatOption(DEFAULT_DRAFT_FORMAT);
}

export async function ensurePersistedOutletFormats(
  outletId: string,
  userId: string,
): Promise<DraftFormatOption[]> {
  await assertOutletOwner(outletId, userId);
  const existing = await loadPersistedOutletFormats(outletId, userId);
  if (existing.length > 0) return existing;

  const now = Date.now();
  await db.batch(
    DRAFT_FORMATS.map((format, index) => {
      const preset = DRAFT_FORMAT_PRESETS[format];
      return {
        sql: `INSERT INTO outlet_formats
              (outlet_id, user_id, format_key, name, instructions, preset_id,
               sort_order, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          outletId,
          userId,
          format,
          preset.name,
          preset.instructions,
          preset.presetId,
          index,
          now,
          now,
        ],
      };
    }),
    "write",
  );
  return loadPersistedOutletFormats(outletId, userId);
}

export async function updateOutletFormat(input: {
  outletId: string;
  userId: string;
  formatKey: FormDataEntryValue | null;
  name: FormDataEntryValue | null;
  instructions: FormDataEntryValue | null;
}): Promise<void> {
  await ensureSchema();
  const formatKey = normalizeKey(input.formatKey);
  const name = normalizeName(input.name);
  const instructions = normalizeInstructions(input.instructions);
  await ensurePersistedOutletFormats(input.outletId, input.userId);
  const r = await db.execute({
    sql: `UPDATE outlet_formats
          SET name = ?, instructions = ?, updated_at = ?
          WHERE outlet_id = ? AND user_id = ? AND format_key = ?`,
    args: [name, instructions, Date.now(), input.outletId, input.userId, formatKey],
  });
  if (r.rowsAffected === 0) throw new Error("Format not found.");
}

export async function addPresetOutletFormat(input: {
  outletId: string;
  userId: string;
  preset: FormDataEntryValue | null;
}): Promise<void> {
  await ensureSchema();
  const presetId = normalizePreset(input.preset);
  const existing = await ensurePersistedOutletFormats(input.outletId, input.userId);
  if (existing.length >= MAX_OUTLET_FORMATS) {
    throw new Error(`Each outlet can have at most ${MAX_OUTLET_FORMATS} formats.`);
  }
  if (existing.some((format) => format.key === presetId)) {
    throw new Error("That preset is already enabled for this outlet.");
  }
  const preset = DRAFT_FORMAT_PRESETS[presetId];
  const now = Date.now();
  const result = await db.execute({
    sql: `INSERT INTO outlet_formats
          (outlet_id, user_id, format_key, name, instructions, preset_id,
           sort_order, created_at, updated_at)
          SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?
          WHERE (SELECT COUNT(*) FROM outlet_formats
                 WHERE outlet_id = ? AND user_id = ?) < ?`,
    args: [
      input.outletId,
      input.userId,
      presetId,
      preset.name,
      preset.instructions,
      preset.presetId,
      existing.length,
      now,
      now,
      input.outletId,
      input.userId,
      MAX_OUTLET_FORMATS,
    ],
  });
  if (result.rowsAffected === 0) {
    throw new Error(`Each outlet can have at most ${MAX_OUTLET_FORMATS} formats.`);
  }
}

export async function addCustomOutletFormat(input: {
  outletId: string;
  userId: string;
  name: FormDataEntryValue | null;
  instructions: FormDataEntryValue | null;
}): Promise<void> {
  await ensureSchema();
  const name = normalizeName(input.name);
  const instructions = normalizeInstructions(input.instructions);
  const existing = await ensurePersistedOutletFormats(input.outletId, input.userId);
  if (existing.length >= MAX_OUTLET_FORMATS) {
    throw new Error(`Each outlet can have at most ${MAX_OUTLET_FORMATS} formats.`);
  }
  const key = `custom:${crypto.randomUUID()}`;
  const now = Date.now();
  const result = await db.execute({
    sql: `INSERT INTO outlet_formats
          (outlet_id, user_id, format_key, name, instructions, preset_id,
           sort_order, created_at, updated_at)
          SELECT ?, ?, ?, ?, ?, NULL, ?, ?, ?
          WHERE (SELECT COUNT(*) FROM outlet_formats
                 WHERE outlet_id = ? AND user_id = ?) < ?`,
    args: [
      input.outletId,
      input.userId,
      key,
      name,
      instructions,
      existing.length,
      now,
      now,
      input.outletId,
      input.userId,
      MAX_OUTLET_FORMATS,
    ],
  });
  if (result.rowsAffected === 0) {
    throw new Error(`Each outlet can have at most ${MAX_OUTLET_FORMATS} formats.`);
  }
}

export async function removeOutletFormat(input: {
  outletId: string;
  userId: string;
  formatKey: FormDataEntryValue | null;
}): Promise<void> {
  await ensureSchema();
  const formatKey = normalizeKey(input.formatKey);
  const existing = await ensurePersistedOutletFormats(input.outletId, input.userId);
  if (existing.length <= 1) {
    throw new Error("Each outlet needs at least one format.");
  }
  const format = existing.find((entry) => entry.key === formatKey);
  if (!format) throw new Error("Format not found.");
  await db.execute({
    sql: `DELETE FROM outlet_formats
          WHERE outlet_id = ? AND user_id = ? AND format_key = ?`,
    args: [input.outletId, input.userId, formatKey],
  });
  await compactSortOrder(input.outletId, input.userId);
}

export async function restoreDefaultOutletFormats(input: {
  outletId: string;
  userId: string;
}): Promise<void> {
  await ensureSchema();
  await assertOutletOwner(input.outletId, input.userId);
  await db.execute({
    sql: `DELETE FROM outlet_formats WHERE outlet_id = ? AND user_id = ?`,
    args: [input.outletId, input.userId],
  });
}

async function compactSortOrder(outletId: string, userId: string): Promise<void> {
  const rows = await loadPersistedOutletFormats(outletId, userId);
  await db.batch(
    rows.map((format, index) => ({
      sql: `UPDATE outlet_formats
            SET sort_order = ?, updated_at = ?
            WHERE outlet_id = ? AND user_id = ? AND format_key = ?`,
      args: [index, Date.now(), outletId, userId, format.key],
    })),
    "write",
  );
}
