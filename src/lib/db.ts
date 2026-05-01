/**
 * libSQL client + v1 schema.
 *
 * Single shared database. Logical tenancy: every row carries `user_id`.
 * Per-user encryption is application-layer envelope encryption on
 * sensitive columns (Application Password, archive blobs).
 *
 * Local dev: file-based SQLite at .data/flavorpress.db.
 * Production: Turso via LIBSQL_URL + LIBSQL_AUTH_TOKEN.
 */

import { createClient, type Client } from "@libsql/client";
import path from "node:path";
import fs from "node:fs";

const dataDir = path.join(process.cwd(), ".data");
if (!process.env.LIBSQL_URL && !fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const url =
  process.env.LIBSQL_URL ?? `file:${path.join(dataDir, "flavorpress.db")}`;
const authToken = process.env.LIBSQL_AUTH_TOKEN;

export const db: Client = createClient({ url, authToken });

let initialized = false;
export async function ensureSchema(): Promise<void> {
  if (initialized) return;
  initialized = true;

  // === migration: bring older schemas up to v1.1 (1:N outlets) ===
  // Use IF NOT EXISTS for greenfield, then a targeted migration pass.
  await migrateLegacyTables();

  await db.batch(
    [
      `CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        niche_label TEXT,
        created_at INTEGER NOT NULL,
        last_active_at INTEGER
      )`,

      // Outlets — a writer can publish to many WordPress sites; each has its
      // own voice profile, derived from that outlet's archive. The 1:N
      // relationship is fundamental: contextwindow.blog and a side blog
      // are different voices. Drafts pick an outlet at the moment of draft.
      `CREATE TABLE IF NOT EXISTS outlets (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        base_url TEXT NOT NULL,
        display_name TEXT,
        username TEXT,
        app_password_encrypted BLOB,
        kind TEXT,
        is_default INTEGER DEFAULT 0,
        last_error TEXT,
        connected_at INTEGER,
        created_at INTEGER NOT NULL,
        last_used_at INTEGER,
        UNIQUE(user_id, base_url)
      )`,
      `CREATE INDEX IF NOT EXISTS idx_outlets_user ON outlets(user_id)`,

      `CREATE TABLE IF NOT EXISTS source_folders (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        UNIQUE(user_id, name)
      )`,
      `CREATE INDEX IF NOT EXISTS idx_source_folders_user ON source_folders(user_id, sort_order)`,

      `CREATE TABLE IF NOT EXISTS sources (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        url TEXT NOT NULL,
        display_name TEXT,
        folder_id TEXT,
        trust_score REAL DEFAULT 0.5,
        poll_interval_seconds INTEGER NOT NULL DEFAULT 300,
        last_polled_at INTEGER,
        last_error TEXT,
        last_etag TEXT,
        last_modified TEXT,
        backoff_until INTEGER,
        paused_until INTEGER,
        active INTEGER DEFAULT 1,
        created_at INTEGER NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_sources_user ON sources(user_id)`,
      `CREATE INDEX IF NOT EXISTS idx_sources_poll ON sources(active, last_polled_at)`,
      `CREATE INDEX IF NOT EXISTS idx_sources_folder ON sources(folder_id)`,

      // Outlet ↔ source assignment. Empty assignment for an outlet means
      // "all user sources" (zero-config default). Only present rows
      // narrow the slice. Cluster engine still runs at user scope so a
      // story spanning both outlets gets one cluster with one trust sum.
      `CREATE TABLE IF NOT EXISTS outlet_sources (
        outlet_id TEXT NOT NULL,
        source_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (outlet_id, source_id)
      )`,
      `CREATE INDEX IF NOT EXISTS idx_outlet_sources_outlet ON outlet_sources(outlet_id)`,
      `CREATE INDEX IF NOT EXISTS idx_outlet_sources_source ON outlet_sources(source_id)`,

      `CREATE TABLE IF NOT EXISTS items (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        canonical_url TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        doi TEXT,
        title TEXT NOT NULL,
        lede TEXT NOT NULL,
        body TEXT,
        authors TEXT,
        published_at INTEGER NOT NULL,
        fetched_at INTEGER NOT NULL,
        entities TEXT,
        cluster_id TEXT,
        UNIQUE(canonical_url, user_id)
      )`,
      `CREATE INDEX IF NOT EXISTS idx_items_user_published ON items(user_id, published_at DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_items_cluster ON items(cluster_id)`,

      `CREATE TABLE IF NOT EXISTS embedding_cache (
        canonical_url TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        embedding_model TEXT NOT NULL,
        embedding_version TEXT NOT NULL,
        embedding BLOB NOT NULL,
        computed_at INTEGER NOT NULL,
        PRIMARY KEY (canonical_url, content_hash, embedding_model, embedding_version)
      )`,

      `CREATE TABLE IF NOT EXISTS clusters (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        centroid BLOB,
        embedding_model TEXT,
        embedding_version TEXT,
        primary_entities TEXT,
        formed_at INTEGER NOT NULL,
        fired_at INTEGER,
        source_count INTEGER NOT NULL DEFAULT 0,
        ranker_score REAL,
        capability_version_pin TEXT,
        state TEXT NOT NULL DEFAULT 'forming'
      )`,
      `CREATE INDEX IF NOT EXISTS idx_clusters_user_state ON clusters(user_id, state, ranker_score DESC)`,

      `CREATE TABLE IF NOT EXISTS drafts (
        id TEXT PRIMARY KEY,
        cluster_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        outlet_id TEXT NOT NULL,
        capability_version_pin TEXT NOT NULL,
        mode TEXT NOT NULL DEFAULT 'drafter',
        headline TEXT NOT NULL,
        headline_alternates TEXT,
        body TEXT NOT NULL,
        quotes TEXT,
        notes TEXT,
        voice_match_score REAL NOT NULL,
        angle_archive TEXT,
        angle_gap TEXT,
        fact_check_result_id TEXT,
        originality_result_id TEXT,
        trace_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        edited_at INTEGER,
        edit_distance_from_original REAL,
        wp_post_id INTEGER,
        wp_edit_link TEXT,
        state TEXT NOT NULL DEFAULT 'pre-rendered'
      )`,
      `CREATE INDEX IF NOT EXISTS idx_drafts_user_cluster ON drafts(user_id, cluster_id)`,
      `CREATE INDEX IF NOT EXISTS idx_drafts_outlet ON drafts(outlet_id)`,

      // Voice profile is per-outlet (not per-user). Each outlet's archive
      // produces a distinct stylometric fingerprint.
      `CREATE TABLE IF NOT EXISTS voice_profiles (
        outlet_id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        style_sheet_yaml TEXT NOT NULL,
        archive_index_size INTEGER NOT NULL,
        function_word_distribution BLOB,
        sentence_length_mean REAL,
        sentence_length_variance REAL,
        hedge_frequency REAL,
        em_dash_density REAL,
        quote_density REAL,
        banned_terms TEXT,
        signature_terms TEXT,
        anchored_post_ids TEXT,
        description TEXT,
        last_rebuilt_at INTEGER NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_voice_user ON voice_profiles(user_id)`,

      `CREATE TABLE IF NOT EXISTS ranker_signals (
        cluster_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        archive_overlap REAL NOT NULL,
        beat_match REAL NOT NULL,
        source_trust REAL NOT NULL,
        composite REAL NOT NULL,
        computed_at INTEGER NOT NULL,
        PRIMARY KEY (cluster_id, user_id)
      )`,

      `CREATE TABLE IF NOT EXISTS ranker_corrections (
        user_id TEXT NOT NULL,
        cluster_pattern TEXT NOT NULL,
        weight_delta REAL NOT NULL,
        signal_id TEXT,
        reason TEXT,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (user_id, cluster_pattern, signal_id)
      )`,

      `CREATE TABLE IF NOT EXISTS fact_check_results (
        id TEXT PRIMARY KEY,
        draft_id TEXT NOT NULL,
        capability_id TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        passed INTEGER NOT NULL,
        flagged_claim_ids TEXT,
        raw_response TEXT,
        computed_at INTEGER NOT NULL,
        UNIQUE(draft_id, capability_id, idempotency_key)
      )`,

      // Per-claim fact-check rows. The aggregate run summary lives in
      // fact_check_results; this table is what the editor renders as
      // Google-Docs-style margin comments. claim_text is the verbatim
      // substring lifted from the draft body so the client can highlight
      // it without storing fragile DOM offsets.
      `CREATE TABLE IF NOT EXISTS fact_check_claims (
        id TEXT PRIMARY KEY,
        draft_id TEXT NOT NULL,
        claim_index INTEGER NOT NULL,
        claim_text TEXT NOT NULL,
        verdict TEXT NOT NULL,
        comment TEXT NOT NULL,
        source_url TEXT,
        source_title TEXT,
        created_at INTEGER NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_fact_check_claims_draft ON fact_check_claims(draft_id, claim_index)`,

      `CREATE TABLE IF NOT EXISTS originality_results (
        id TEXT PRIMARY KEY,
        draft_id TEXT NOT NULL,
        capability_id TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        score REAL NOT NULL,
        flagged_spans TEXT,
        computed_at INTEGER NOT NULL,
        UNIQUE(draft_id, capability_id, idempotency_key)
      )`,

      `CREATE TABLE IF NOT EXISTS capabilities (
        id TEXT NOT NULL,
        version TEXT NOT NULL,
        manifest TEXT NOT NULL,
        tier TEXT NOT NULL,
        registered_at INTEGER NOT NULL,
        active INTEGER DEFAULT 1,
        PRIMARY KEY (id, version)
      )`,

      `CREATE TABLE IF NOT EXISTS event_log (
        id TEXT PRIMARY KEY,
        user_id TEXT,
        type TEXT NOT NULL,
        payload TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        capability_id TEXT,
        capability_version TEXT,
        trace_id TEXT,
        occurred_at INTEGER NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_event_log_user_time ON event_log(user_id, occurred_at DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_event_log_type ON event_log(type, occurred_at DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_event_log_trace ON event_log(trace_id)`,

      `CREATE TABLE IF NOT EXISTS trace_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        trace_id TEXT NOT NULL,
        user_id TEXT,
        span TEXT NOT NULL,
        level TEXT NOT NULL,
        message TEXT NOT NULL,
        data TEXT,
        occurred_at INTEGER NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_trace_log_trace ON trace_log(trace_id, occurred_at)`,

      // Related-images extension cache. Each row is one Openverse hit
      // surfaced into the editor's right rail; the extension persists
      // results so a search survives page reload without re-billing the
      // upstream provider. License columns mirror the Openverse fields
      // so the panel can render attribution + a license badge offline.
      `CREATE TABLE IF NOT EXISTS related_image_results (
        id TEXT PRIMARY KEY,
        draft_id TEXT NOT NULL,
        result_index INTEGER NOT NULL,
        image_url TEXT NOT NULL,
        thumbnail_url TEXT NOT NULL,
        source_url TEXT NOT NULL,
        source_provider TEXT,
        title TEXT,
        creator TEXT,
        creator_url TEXT,
        license_code TEXT NOT NULL,
        license_version TEXT,
        license_url TEXT,
        width INTEGER,
        height INTEGER,
        searched_at INTEGER NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_related_image_results_draft ON related_image_results(draft_id, result_index)`,

      // Per-draft run marker for the related-images extension. A run that
      // yielded zero hits still has a row here, so the panel can render
      // "searched Xm ago" instead of looking like it was never run.
      `CREATE TABLE IF NOT EXISTS related_image_runs (
        draft_id TEXT PRIMARY KEY,
        searched_at INTEGER NOT NULL
      )`,

      // App-level settings the user can edit from /settings instead of .env.
      // Single-user prototype so we keep this keyed only by `key`; values are
      // stored as TEXT (matches the v1-alpha plaintext approach used for
      // outlet credentials; envelope encryption ships in week 2).
      `CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value TEXT,
        updated_at INTEGER NOT NULL
      )`,
    ],
    "write",
  );
}

/**
 * Schema migration. v1 alpha → v1.1 introduces 1:N outlets:
 *   - outlets table is new (created via IF NOT EXISTS below)
 *   - voice_profiles primary key changed from user_id to outlet_id
 *   - users table dropped wp_* columns (we just leave them if present;
 *     they're unused)
 *   - drafts table gained outlet_id column
 *
 * Strategy: detect the old voice_profiles primary key and drop+recreate.
 * The voice profile data is rebuildable from the user's WP archive in 30s,
 * so dropping is acceptable. Add outlet_id to drafts if missing.
 */
async function migrateLegacyTables(): Promise<void> {
  // voice_profiles: check primary key.
  try {
    const pragma = await db.execute("PRAGMA table_info(voice_profiles)");
    if (pragma.rows.length > 0) {
      // Find the primary key column.
      const pkCols = pragma.rows
        .filter((r) => Number(r.pk) > 0)
        .map((r) => String(r.name));
      if (!pkCols.includes("outlet_id")) {
        // eslint-disable-next-line no-console
        console.info(
          "[migrate] voice_profiles: dropping legacy table (was keyed on user_id; rebuilding under outlet_id)",
        );
        await db.execute("DROP TABLE voice_profiles");
      } else {
        const cols = pragma.rows.map((r) => String(r.name));
        if (!cols.includes("description")) {
          // eslint-disable-next-line no-console
          console.info("[migrate] voice_profiles: adding description column");
          await db.execute(
            "ALTER TABLE voice_profiles ADD COLUMN description TEXT",
          );
        }
      }
    }
  } catch {
    // Table doesn't exist yet; CREATE IF NOT EXISTS will handle it.
  }

  // drafts: check for outlet_id column.
  try {
    const pragma = await db.execute("PRAGMA table_info(drafts)");
    if (pragma.rows.length > 0) {
      const cols = pragma.rows.map((r) => String(r.name));
      if (!cols.includes("outlet_id")) {
        // eslint-disable-next-line no-console
        console.info("[migrate] drafts: adding outlet_id column");
        await db.execute(
          "ALTER TABLE drafts ADD COLUMN outlet_id TEXT NOT NULL DEFAULT ''",
        );
      }
      if (!cols.includes("mode")) {
        // eslint-disable-next-line no-console
        console.info("[migrate] drafts: adding mode column");
        await db.execute(
          "ALTER TABLE drafts ADD COLUMN mode TEXT NOT NULL DEFAULT 'drafter'",
        );
      }
      if (!cols.includes("notes")) {
        // eslint-disable-next-line no-console
        console.info("[migrate] drafts: adding notes column");
        await db.execute("ALTER TABLE drafts ADD COLUMN notes TEXT");
      }
    }
  } catch {
    // Table will be created clean by CREATE IF NOT EXISTS.
  }

  // sources: check for folder_id and politeness columns.
  try {
    const pragma = await db.execute("PRAGMA table_info(sources)");
    if (pragma.rows.length > 0) {
      const cols = pragma.rows.map((r) => String(r.name));
      if (!cols.includes("folder_id")) {
        // eslint-disable-next-line no-console
        console.info("[migrate] sources: adding folder_id column");
        await db.execute("ALTER TABLE sources ADD COLUMN folder_id TEXT");
      }
      if (!cols.includes("last_etag")) {
        // eslint-disable-next-line no-console
        console.info("[migrate] sources: adding last_etag column");
        await db.execute("ALTER TABLE sources ADD COLUMN last_etag TEXT");
      }
      if (!cols.includes("last_modified")) {
        // eslint-disable-next-line no-console
        console.info("[migrate] sources: adding last_modified column");
        await db.execute("ALTER TABLE sources ADD COLUMN last_modified TEXT");
      }
      if (!cols.includes("backoff_until")) {
        // eslint-disable-next-line no-console
        console.info("[migrate] sources: adding backoff_until column");
        await db.execute(
          "ALTER TABLE sources ADD COLUMN backoff_until INTEGER",
        );
      }
      if (!cols.includes("paused_until")) {
        // eslint-disable-next-line no-console
        console.info("[migrate] sources: adding paused_until column");
        await db.execute(
          "ALTER TABLE sources ADD COLUMN paused_until INTEGER",
        );
      }
    }
  } catch {
    // Table will be created clean by CREATE IF NOT EXISTS.
  }
}

// ===== single-user helper for v1 alpha =====
//
// Auth is deferred (Supabase Auth wiring is Epic 1.2, owned by Matthias).
// Until that lands, the OSS app runs single-user under a fixed user id so
// sources, voice profile, drafts all attach correctly.
export const SINGLE_USER_ID = "default-user";

export async function ensureSingleUser(email = "you@flavorpress.local"): Promise<void> {
  await ensureSchema();
  await db.execute({
    sql: `INSERT OR IGNORE INTO users (id, email, created_at) VALUES (?, ?, ?)`,
    args: [SINGLE_USER_ID, email, Date.now()],
  });
}
