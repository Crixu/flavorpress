/**
 * User-facing data export.
 *
 * Snapshots the writer's drafts, voice profiles, outlets, sources, and
 * source-to-outlet assignments into a single JSON document the user can
 * download from /settings. Application passwords and other secrets are
 * stripped; binary BLOBs (centroids, function-word vectors) are dropped
 * because they are derived stats and the YAML style sheet covers the
 * human-meaningful part of the voice profile.
 */

import { db, ensureSchema, SINGLE_USER_ID } from "../db";

export const EXPORT_SCHEMA_VERSION = "1";

export interface ExportEnvelope {
  schemaVersion: string;
  generatedAt: number;
  user: ExportUser | null;
  outlets: ExportOutlet[];
  voiceProfiles: ExportVoiceProfile[];
  sourceFolders: ExportSourceFolder[];
  sources: ExportSource[];
  outletSourceAssignments: ExportOutletSourceAssignment[];
  drafts: ExportDraft[];
}

export interface ExportUser {
  id: string;
  email: string;
  nicheLabel: string | null;
  createdAt: number;
  lastActiveAt: number | null;
}

export interface ExportOutlet {
  id: string;
  baseUrl: string;
  displayName: string | null;
  username: string | null;
  kind: string | null;
  isDefault: boolean;
  connected: boolean;
  connectedAt: number | null;
  createdAt: number;
  lastUsedAt: number | null;
}

export interface ExportVoiceProfile {
  outletId: string;
  styleSheetYaml: string;
  archiveIndexSize: number;
  sentenceLengthMean: number | null;
  sentenceLengthVariance: number | null;
  hedgeFrequency: number | null;
  emDashDensity: number | null;
  quoteDensity: number | null;
  bannedTerms: string[];
  signatureTerms: string[];
  anchoredPostIds: string[];
  description: string | null;
  seedMethod: string | null;
  seedTranscript: string | null;
  lastRebuiltAt: number;
}

export interface ExportSourceFolder {
  id: string;
  name: string;
  sortOrder: number;
  createdAt: number;
}

export interface ExportSource {
  id: string;
  kind: string;
  url: string;
  displayName: string | null;
  folderId: string | null;
  trustScore: number;
  pollIntervalSeconds: number;
  active: boolean;
  createdAt: number;
}

export interface ExportOutletSourceAssignment {
  outletId: string;
  sourceId: string;
  createdAt: number;
}

export interface ExportDraft {
  id: string;
  clusterId: string;
  outletId: string;
  mode: string;
  state: string;
  headline: string;
  headlineAlternates: unknown;
  body: string;
  quotes: unknown;
  notes: string | null;
  voiceMatchScore: number;
  angleArchive: string | null;
  angleGap: string | null;
  wpPostId: number | null;
  wpEditLink: string | null;
  wpSyncedAt: number | null;
  createdAt: number;
  editedAt: number | null;
}

function parseJson(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function parseStringArray(value: unknown): string[] {
  const parsed = parseJson(value);
  if (Array.isArray(parsed)) return parsed.filter((x): x is string => typeof x === "string");
  return [];
}

function num(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function buildExportEnvelope(userId = SINGLE_USER_ID): Promise<ExportEnvelope> {
  await ensureSchema();

  const [userRows, outletRows, voiceRows, folderRows, sourceRows, outletSourceRows, draftRows] =
    await Promise.all([
      db.execute({
        sql: `SELECT id, email, niche_label, created_at, last_active_at
            FROM users WHERE id = ?`,
        args: [userId],
      }),
      db.execute({
        sql: `SELECT id, base_url, display_name, username, kind, is_default,
                   app_password_encrypted, connected_at, created_at, last_used_at
            FROM outlets WHERE user_id = ?
            ORDER BY is_default DESC, created_at ASC`,
        args: [userId],
      }),
      db.execute({
        sql: `SELECT outlet_id, style_sheet_yaml, archive_index_size,
                   sentence_length_mean, sentence_length_variance,
                   hedge_frequency, em_dash_density, quote_density,
                   banned_terms, signature_terms, anchored_post_ids,
                   description, seed_method, seed_transcript, last_rebuilt_at
            FROM voice_profiles WHERE user_id = ?
            ORDER BY last_rebuilt_at DESC`,
        args: [userId],
      }),
      db.execute({
        sql: `SELECT id, name, sort_order, created_at
            FROM source_folders WHERE user_id = ?
            ORDER BY sort_order ASC, created_at ASC`,
        args: [userId],
      }),
      db.execute({
        sql: `SELECT id, kind, url, display_name, folder_id, trust_score,
                   poll_interval_seconds, active, created_at
            FROM sources WHERE user_id = ?
            ORDER BY created_at ASC`,
        args: [userId],
      }),
      db.execute({
        sql: `SELECT os.outlet_id, os.source_id, os.created_at
            FROM outlet_sources os
            JOIN outlets o ON o.id = os.outlet_id
            JOIN sources s ON s.id = os.source_id
            WHERE o.user_id = ? AND s.user_id = ?
            ORDER BY os.created_at ASC, os.outlet_id ASC, os.source_id ASC`,
        args: [userId, userId],
      }),
      db.execute({
        sql: `SELECT id, cluster_id, outlet_id, mode, state, headline,
                   headline_alternates, body, quotes, notes, voice_match_score,
                   angle_archive, angle_gap, wp_post_id, wp_edit_link,
                   wp_synced_at, created_at, edited_at
            FROM drafts WHERE user_id = ?
            ORDER BY created_at ASC`,
        args: [userId],
      }),
    ]);

  const user: ExportUser | null = userRows.rows.length
    ? {
        id: String(userRows.rows[0]!.id),
        email: String(userRows.rows[0]!.email),
        nicheLabel: userRows.rows[0]!.niche_label ? String(userRows.rows[0]!.niche_label) : null,
        createdAt: Number(userRows.rows[0]!.created_at),
        lastActiveAt: userRows.rows[0]!.last_active_at
          ? Number(userRows.rows[0]!.last_active_at)
          : null,
      }
    : null;

  const outlets: ExportOutlet[] = outletRows.rows.map((row) => ({
    id: String(row.id),
    baseUrl: String(row.base_url),
    displayName: row.display_name ? String(row.display_name) : null,
    username: row.username ? String(row.username) : null,
    kind: row.kind ? String(row.kind) : null,
    isDefault: Number(row.is_default) === 1,
    connected: row.app_password_encrypted !== null,
    connectedAt: row.connected_at ? Number(row.connected_at) : null,
    createdAt: Number(row.created_at),
    lastUsedAt: row.last_used_at ? Number(row.last_used_at) : null,
  }));

  const voiceProfiles: ExportVoiceProfile[] = voiceRows.rows.map((row) => ({
    outletId: String(row.outlet_id),
    styleSheetYaml: String(row.style_sheet_yaml),
    archiveIndexSize: Number(row.archive_index_size),
    sentenceLengthMean: num(row.sentence_length_mean),
    sentenceLengthVariance: num(row.sentence_length_variance),
    hedgeFrequency: num(row.hedge_frequency),
    emDashDensity: num(row.em_dash_density),
    quoteDensity: num(row.quote_density),
    bannedTerms: parseStringArray(row.banned_terms),
    signatureTerms: parseStringArray(row.signature_terms),
    anchoredPostIds: parseStringArray(row.anchored_post_ids),
    description: row.description ? String(row.description) : null,
    seedMethod: row.seed_method ? String(row.seed_method) : null,
    seedTranscript: row.seed_transcript ? String(row.seed_transcript) : null,
    lastRebuiltAt: Number(row.last_rebuilt_at),
  }));

  const sourceFolders: ExportSourceFolder[] = folderRows.rows.map((row) => ({
    id: String(row.id),
    name: String(row.name),
    sortOrder: Number(row.sort_order),
    createdAt: Number(row.created_at),
  }));

  const sources: ExportSource[] = sourceRows.rows.map((row) => ({
    id: String(row.id),
    kind: String(row.kind),
    url: String(row.url),
    displayName: row.display_name ? String(row.display_name) : null,
    folderId: row.folder_id ? String(row.folder_id) : null,
    trustScore: Number(row.trust_score ?? 0.5),
    pollIntervalSeconds: Number(row.poll_interval_seconds),
    active: Number(row.active) === 1,
    createdAt: Number(row.created_at),
  }));

  const outletSourceAssignments: ExportOutletSourceAssignment[] = outletSourceRows.rows.map(
    (row) => ({
      outletId: String(row.outlet_id),
      sourceId: String(row.source_id),
      createdAt: Number(row.created_at),
    }),
  );

  const drafts: ExportDraft[] = draftRows.rows.map((row) => ({
    id: String(row.id),
    clusterId: String(row.cluster_id),
    outletId: String(row.outlet_id ?? ""),
    mode: String(row.mode ?? "drafter"),
    state: String(row.state),
    headline: String(row.headline),
    headlineAlternates: parseJson(row.headline_alternates),
    body: String(row.body),
    quotes: parseJson(row.quotes),
    notes: row.notes ? String(row.notes) : null,
    voiceMatchScore: Number(row.voice_match_score),
    angleArchive: row.angle_archive ? String(row.angle_archive) : null,
    angleGap: row.angle_gap ? String(row.angle_gap) : null,
    wpPostId:
      row.wp_post_id !== null && row.wp_post_id !== undefined ? Number(row.wp_post_id) : null,
    wpEditLink: row.wp_edit_link ? String(row.wp_edit_link) : null,
    wpSyncedAt: row.wp_synced_at ? Number(row.wp_synced_at) : null,
    createdAt: Number(row.created_at),
    editedAt: row.edited_at ? Number(row.edited_at) : null,
  }));

  return {
    schemaVersion: EXPORT_SCHEMA_VERSION,
    generatedAt: Date.now(),
    user,
    outlets,
    voiceProfiles,
    sourceFolders,
    sources,
    outletSourceAssignments,
    drafts,
  };
}

export function exportFilename(generatedAt: number): string {
  const d = new Date(generatedAt);
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}-${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
  return `flavorpress-export-${stamp}.json`;
}
