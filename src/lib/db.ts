/**
 * libSQL client + v1 schema.
 *
 * Single shared database. Logical tenancy: every row carries `user_id`.
 * Per-user encryption is application-layer envelope encryption on
 * sensitive columns (Application Password, archive blobs).
 *
 * Three connection modes:
 *
 * 1. LIBSQL_URL unset: local file at .data/flavorpress.db (laptop dev).
 * 2. LIBSQL_URL is libsql:// or https:// and we're not on Vercel:
 *    embedded replica. Reads hit a local .data/turso-replica.db file;
 *    writes pass through to Turso and the replica syncs every 60s.
 *    Keeps `npm run dev` against a remote Turso DB feeling local.
 * 3. LIBSQL_URL is libsql:// or https:// on Vercel: direct remote
 *    connection. Vercel functions sit in the same region as Turso's
 *    edge replica; round-trips are sub-millisecond and an embedded
 *    file is wasteful (cold-start friction, /tmp is ephemeral anyway).
 */

import { createClient, type Client } from "@libsql/client";
import path from "node:path";
import fs from "node:fs";
import { assertEncryptionKeyAtBoot } from "./secret-crypto";

const dataDir = path.join(process.cwd(), ".data");
const remoteUrl = process.env.LIBSQL_URL?.trim();
const authToken = process.env.LIBSQL_AUTH_TOKEN;
const onVercel = process.env.VERCEL === "1";
// `next build` spawns several workers that all import this module. If each
// worker opens the same embedded-replica file, libsql races on
// wal_insert_begin and emits sync errors. The build itself does not need a
// real DB connection (all routes are `dynamic = "force-dynamic"`), so during
// the build phase we use the same remote-only path Vercel uses at runtime.
const isBuildPhase = process.env.NEXT_PHASE === "phase-production-build";
const useRemoteOnly = onVercel || isBuildPhase;
const isRemote = Boolean(
  remoteUrl && (remoteUrl.startsWith("libsql://") || remoteUrl.startsWith("https://")),
);

assertEncryptionKeyAtBoot();

if (!isRemote && !fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

function buildClient(): Client {
  // Mode 3: remote-only (Vercel runtime, or local `next build`).
  if (isRemote && useRemoteOnly) {
    return createClient({ url: remoteUrl!, authToken });
  }
  // Mode 2: embedded replica for local dev pointed at a remote URL.
  if (isRemote) {
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    return createClient({
      url: `file:${path.join(dataDir, "turso-replica.db")}`,
      syncUrl: remoteUrl,
      authToken,
      syncInterval: 60,
    });
  }
  // Mode 1: bare local sqlite file (or whatever non-remote URL was passed,
  // e.g., file: URLs used by the test runner).
  const fallback = `file:${path.join(dataDir, "flavorpress.db")}`;
  return createClient({ url: remoteUrl ?? fallback, authToken });
}

export const db: Client = buildClient();

// Bumped whenever the schema or migration sequence changes. The sentinel
// short-circuit in ensureSchema() compares the value stored in
// deployment_settings.schema_version against this constant; a mismatch (or
// missing row) drives the slow path that runs migrateLegacyTables and the full
// CREATE-IF-NOT-EXISTS batch. A match skips ~14 PRAGMA round trips on every
// Vercel cold start.
const SCHEMA_VERSION = "2026-05-28.source-folder-memberships";

let initialized = false;
export async function ensureSchema(): Promise<void> {
  if (initialized) return;

  // Fast path: a previous cold start (potentially in another lambda instance)
  // wrote a matching SCHEMA_VERSION sentinel, so the schema is already
  // current and we can skip migrateLegacyTables, the CREATE-IF-NOT-EXISTS
  // batch. Costs one SELECT instead of dozens of round trips.
  if (await schemaSentinelMatches()) {
    initialized = true;
    return;
  }

  // === migration: bring older schemas up to v1.1 (1:N outlets) ===
  // Use IF NOT EXISTS for greenfield, then a targeted migration pass.
  await migrateLegacyTables();

  await db.batch(
    [
      `CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        niche_label TEXT,
        password_hash TEXT,
        wpcom_id TEXT,
        wpcom_username TEXT,
        email_verified_at INTEGER,
        status TEXT NOT NULL DEFAULT 'active',
        is_admin INTEGER NOT NULL DEFAULT 0,
        session_version INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        last_active_at INTEGER
      )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS users_wpcom_id_unique ON users(wpcom_id) WHERE wpcom_id IS NOT NULL`,

      // Outlets - a writer can publish to many WordPress sites; each has its
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
        wpcom_expected_blog_id TEXT,
        wpcom_token_expires_at INTEGER,
        wpcom_refresh_token_encrypted BLOB,
        wpcom_token_kid TEXT,
        UNIQUE(user_id, base_url)
      )`,
      `CREATE INDEX IF NOT EXISTS idx_outlets_user ON outlets(user_id)`,

      `CREATE TABLE IF NOT EXISTS wp_authorize_states (
        state TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        outlet_id TEXT NOT NULL,
        expected_site_url TEXT NOT NULL,
        expected_site_origin TEXT NOT NULL,
        bound_value TEXT,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_wp_authorize_states_expires ON wp_authorize_states(expires_at)`,
      `CREATE INDEX IF NOT EXISTS idx_wp_authorize_states_outlet ON wp_authorize_states(outlet_id)`,

      `CREATE TABLE IF NOT EXISTS oauth_state_nonces (
        nonce TEXT NOT NULL,
        kind TEXT NOT NULL,
        bound_value TEXT,
        consumed_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        PRIMARY KEY (nonce, kind)
      )`,
      `CREATE INDEX IF NOT EXISTS idx_oauth_state_nonces_expires ON oauth_state_nonces(expires_at)`,

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

      `CREATE TABLE IF NOT EXISTS source_folder_assignments (
        source_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        folder_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (source_id, folder_id)
      )`,
      `CREATE INDEX IF NOT EXISTS idx_source_folder_assignments_user_folder
        ON source_folder_assignments(user_id, folder_id)`,
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_sources_user_kind_url_unique
        ON sources(user_id, kind, url)`,

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

      `CREATE TABLE IF NOT EXISTS outlet_formats (
        outlet_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        format_key TEXT NOT NULL,
        name TEXT NOT NULL,
        instructions TEXT NOT NULL,
        preset_id TEXT,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (outlet_id, format_key)
      )`,
      `CREATE INDEX IF NOT EXISTS idx_outlet_formats_user ON outlet_formats(user_id, outlet_id)`,

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
        primary_subject TEXT,
        beat_tag TEXT,
        cluster_id TEXT,
        marked_at INTEGER,
        dismissed_at INTEGER,
        score INTEGER,
        comment_count INTEGER,
        UNIQUE(canonical_url, user_id)
      )`,
      `CREATE INDEX IF NOT EXISTS idx_items_user_published ON items(user_id, published_at DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_items_user_fetched ON items(user_id, fetched_at DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_items_source_fetched ON items(source_id, fetched_at DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_items_source_published ON items(source_id, published_at DESC)`,
      // idx_items_cluster(cluster_id) was redundant with the (cluster_id,
      // published_at DESC) index below, which serves any cluster_id-only
      // lookup as a prefix. Dropping it removes a redundant write target on
      // every items insert/update.
      `DROP INDEX IF EXISTS idx_items_cluster`,
      `CREATE INDEX IF NOT EXISTS idx_items_cluster_published ON items(cluster_id, published_at DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_items_marked ON items(user_id, marked_at) WHERE marked_at IS NOT NULL`,
      `CREATE INDEX IF NOT EXISTS idx_items_reader_queue ON items(user_id, published_at DESC)
        WHERE cluster_id IS NULL AND marked_at IS NULL AND dismissed_at IS NULL`,

      `CREATE TABLE IF NOT EXISTS embedding_cache (
        canonical_url TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        embedding_model TEXT NOT NULL,
        embedding_version TEXT NOT NULL,
        embedding BLOB NOT NULL,
        computed_at INTEGER NOT NULL,
        PRIMARY KEY (canonical_url, content_hash, embedding_model, embedding_version)
      )`,

      // Cache for the LLM-at-ingest entity extractor. Keyed on
      // content_hash so identical bodies (republished posts, RSS dupes)
      // reuse the result instead of re-paying for a Sonnet call. Entries
      // store the full structured output (entities + primary_subject +
      // beat_tag) plus the model name so we can invalidate selectively
      // when the prompt or model changes.
      `CREATE TABLE IF NOT EXISTS entity_cache (
        content_hash TEXT NOT NULL,
        model TEXT NOT NULL,
        prompt_version TEXT NOT NULL,
        entities TEXT NOT NULL,
        primary_subject TEXT,
        beat_tag TEXT,
        computed_at INTEGER NOT NULL,
        PRIMARY KEY (content_hash, model, prompt_version)
      )`,

      // Cache for the Layer 3 LLM merge oracle. Stores yes/no answers to
      // "are these two items the same story" decisions, keyed on the
      // ordered pair of content_hashes. hash_a is always lex-smaller
      // than hash_b at insert time so the lookup is order-insensitive.
      `CREATE TABLE IF NOT EXISTS merge_oracle_cache (
        hash_a TEXT NOT NULL,
        hash_b TEXT NOT NULL,
        model TEXT NOT NULL,
        prompt_version TEXT NOT NULL,
        same_story INTEGER NOT NULL,
        reason TEXT,
        computed_at INTEGER NOT NULL,
        PRIMARY KEY (hash_a, hash_b, model, prompt_version)
      )`,

      // Long-running maintenance jobs (re-extract entities, rebuild
      // clusters). The action that starts the job inserts a row with the
      // total count; the background runner increments `completed` after
      // each unit of work; the toast in the UI polls this row to drive
      // its progress bar. `kind` is the job type so we can prevent two
      // jobs of the same kind running concurrently.
      `CREATE TABLE IF NOT EXISTS job_progress (
        id TEXT PRIMARY KEY,
        user_id TEXT,
        kind TEXT NOT NULL,
        total INTEGER NOT NULL,
        completed INTEGER NOT NULL DEFAULT 0,
        started_at INTEGER NOT NULL,
        completed_at INTEGER,
        error TEXT
      )`,
      `CREATE INDEX IF NOT EXISTS idx_job_progress_kind ON job_progress(kind, started_at DESC)`,

      `CREATE TABLE IF NOT EXISTS view_cache (
        user_id TEXT NOT NULL,
        view_key TEXT NOT NULL,
        payload TEXT,
        payload_version INTEGER NOT NULL DEFAULT 1,
        input_hash TEXT,
        computed_at INTEGER,
        refresh_started_at INTEGER,
        error TEXT,
        PRIMARY KEY (user_id, view_key)
      )`,
      `CREATE INDEX IF NOT EXISTS idx_view_cache_refresh ON view_cache(view_key, refresh_started_at)`,

      `CREATE TABLE IF NOT EXISTS user_cache_versions (
        user_id TEXT PRIMARY KEY,
        today_version INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL
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
      `CREATE INDEX IF NOT EXISTS idx_clusters_user_state_formed ON clusters(user_id, state, formed_at DESC)`,

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
        research_board TEXT,
        voice_match_score REAL NOT NULL,
        angle_archive TEXT,
        angle_gap TEXT,
        angle_hint TEXT,
        custom_angle TEXT,
        format TEXT,
        fact_check_result_id TEXT,
        originality_result_id TEXT,
        trace_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        edited_at INTEGER,
        edit_distance_from_original REAL,
        wp_post_id INTEGER,
        wp_edit_link TEXT,
        wp_synced_at INTEGER,
        wp_modified_at INTEGER,
        wp_content_hash TEXT,
        state TEXT NOT NULL DEFAULT 'pre-rendered'
      )`,
      `CREATE INDEX IF NOT EXISTS idx_drafts_user_cluster ON drafts(user_id, cluster_id)`,
      `CREATE INDEX IF NOT EXISTS idx_drafts_outlet ON drafts(outlet_id)`,
      `CREATE INDEX IF NOT EXISTS idx_drafts_user_created ON drafts(user_id, created_at DESC)`,

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
        seed_method TEXT,
        seed_transcript TEXT,
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

      `CREATE TABLE IF NOT EXISTS notification_webhook_deliveries (
        event_key TEXT PRIMARY KEY,
        user_id TEXT,
        event_type TEXT NOT NULL,
        payload TEXT NOT NULL,
        status INTEGER,
        error TEXT,
        delivered_at INTEGER,
        created_at INTEGER NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_notification_webhook_deliveries_user
        ON notification_webhook_deliveries(user_id, created_at DESC)`,

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
      // license_filter is the comma-separated, alphabetically sorted set
      // of license codes the search ran under; the loader uses it to
      // invalidate `ranAt` when the user later narrows or widens the
      // filter. Otherwise a filter-prune leaves the panel claiming a
      // search ran with the new filter when none did.
      `CREATE TABLE IF NOT EXISTS related_image_runs (
        draft_id TEXT PRIMARY KEY,
        searched_at INTEGER NOT NULL,
        license_filter TEXT
      )`,

      // Comment-courtroom extension - simulated reader thread.
      // The user runs a fixed jury of personas against a draft and gets
      // a nested comment thread back, so they can anticipate how the post
      // might land before publishing. Comments are stored flat with a
      // parent_id pointer; sort_order controls sibling ordering inside
      // each parent. depth is denormalized so the panel can render
      // indentation without recomputing it from the parent chain.
      `CREATE TABLE IF NOT EXISTS comment_courtroom_comments (
        id TEXT PRIMARY KEY,
        draft_id TEXT NOT NULL,
        parent_id TEXT,
        persona_key TEXT NOT NULL,
        depth INTEGER NOT NULL,
        sort_order INTEGER NOT NULL,
        body TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_comment_courtroom_draft ON comment_courtroom_comments(draft_id, sort_order)`,
      `CREATE INDEX IF NOT EXISTS idx_comment_courtroom_parent ON comment_courtroom_comments(parent_id)`,

      // Per-draft run marker for the comment-courtroom extension. A run
      // that produced zero comments still has a row here so the panel can
      // show "ran Xm ago" and distinguish a successful empty thread from
      // "never run".
      `CREATE TABLE IF NOT EXISTS comment_courtroom_runs (
        draft_id TEXT PRIMARY KEY,
        ran_at INTEGER NOT NULL
      )`,

      `CREATE TABLE IF NOT EXISTS angle_builder_suggestions (
        id TEXT PRIMARY KEY,
        draft_id TEXT NOT NULL,
        angle_index INTEGER NOT NULL,
        kind TEXT NOT NULL,
        label TEXT NOT NULL,
        title TEXT NOT NULL,
        thesis TEXT NOT NULL,
        why TEXT NOT NULL,
        source_cue TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_angle_builder_suggestions_draft
        ON angle_builder_suggestions(draft_id, angle_index)`,
      `CREATE TABLE IF NOT EXISTS angle_builder_runs (
        draft_id TEXT PRIMARY KEY,
        ran_at INTEGER NOT NULL
      )`,

      `CREATE TABLE IF NOT EXISTS evidence_panel_items (
        id TEXT PRIMARY KEY,
        draft_id TEXT NOT NULL,
        item_index INTEGER NOT NULL,
        claim_text TEXT NOT NULL,
        status TEXT NOT NULL,
        note TEXT NOT NULL,
        source_title TEXT,
        source_url TEXT,
        quote_text TEXT,
        created_at INTEGER NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_evidence_panel_items_draft
        ON evidence_panel_items(draft_id, item_index)`,
      `CREATE TABLE IF NOT EXISTS evidence_panel_runs (
        draft_id TEXT PRIMARY KEY,
        ran_at INTEGER NOT NULL
      )`,

      `CREATE TABLE IF NOT EXISTS voice_guard_notes (
        id TEXT PRIMARY KEY,
        draft_id TEXT NOT NULL,
        note_index INTEGER NOT NULL,
        kind TEXT NOT NULL,
        severity TEXT NOT NULL,
        span_text TEXT NOT NULL,
        note TEXT NOT NULL,
        suggestion TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_voice_guard_notes_draft
        ON voice_guard_notes(draft_id, note_index)`,
      `CREATE TABLE IF NOT EXISTS voice_guard_runs (
        draft_id TEXT PRIMARY KEY,
        ran_at INTEGER NOT NULL
      )`,

      // Workflow autopublish extension. This is opt-in per outlet and
      // folder scope, and deliberately lives outside the core source and
      // draft loop.
      `CREATE TABLE IF NOT EXISTS workflow_autopublish_configs (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        outlet_id TEXT NOT NULL,
        folder_scope TEXT NOT NULL DEFAULT 'all',
        enabled INTEGER NOT NULL DEFAULT 0,
        interval_hours INTEGER NOT NULL DEFAULT 12,
        auto_update INTEGER NOT NULL DEFAULT 1,
        fresh_source_window_hours INTEGER NOT NULL DEFAULT 24,
        next_run_at INTEGER,
        last_run_at INTEGER,
        last_draft_id TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(user_id, outlet_id, folder_scope)
      )`,
      `CREATE INDEX IF NOT EXISTS idx_workflow_autopublish_due
        ON workflow_autopublish_configs(enabled, next_run_at)`,
      `CREATE INDEX IF NOT EXISTS idx_workflow_autopublish_user
        ON workflow_autopublish_configs(user_id, outlet_id, folder_scope)`,

      `CREATE TABLE IF NOT EXISTS workflow_autopublish_log (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        outlet_id TEXT NOT NULL,
        folder_scope TEXT NOT NULL DEFAULT 'all',
        draft_id TEXT,
        cluster_id TEXT,
        status TEXT NOT NULL,
        message TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_workflow_autopublish_log_user
        ON workflow_autopublish_log(user_id, created_at DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_workflow_autopublish_log_outlet
        ON workflow_autopublish_log(outlet_id, created_at DESC)`,

      // LLM-extracted topic tags per inbound item. Each row is one tag
      // attached to an item, with a confidence score (defaults to 1.0 when the
      // extractor does not provide one). The composite primary key prevents duplicate tags per
      // item; ON DELETE CASCADE keeps the table tidy when items are pruned.
      `CREATE TABLE IF NOT EXISTS item_tags (
        item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
        tag TEXT NOT NULL,
        confidence REAL NOT NULL DEFAULT 1.0,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (item_id, tag)
      )`,
      `CREATE INDEX IF NOT EXISTS idx_item_tags_item ON item_tags(item_id)`,
      `CREATE INDEX IF NOT EXISTS idx_item_tags_item_confidence ON item_tags(item_id, confidence DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_item_tags_tag ON item_tags(tag)`,

      `CREATE TABLE IF NOT EXISTS user_ai_budget (
        user_id TEXT NOT NULL,
        day_utc TEXT NOT NULL,
        tokens_remaining INTEGER NOT NULL,
        tokens_limit INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (user_id, day_utc)
      )`,
      `CREATE INDEX IF NOT EXISTS idx_user_ai_budget_day ON user_ai_budget(day_utc)`,

      // Legacy global settings table. Kept so old installs can copy rows into
      // user_settings; runtime settings reads and writes must not use it.
      `CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value TEXT,
        updated_at INTEGER NOT NULL
      )`,

      `CREATE TABLE IF NOT EXISTS rate_buckets (
        scope TEXT NOT NULL,
        key TEXT NOT NULL,
        tokens INTEGER NOT NULL,
        refilled_at INTEGER NOT NULL,
        PRIMARY KEY (scope, key)
      )`,

      `CREATE TABLE IF NOT EXISTS user_settings (
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        key TEXT NOT NULL,
        value TEXT,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (user_id, key)
      )`,

      `CREATE TABLE IF NOT EXISTS user_extension_access (
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        extension_id TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (user_id, extension_id)
      )`,
      `CREATE INDEX IF NOT EXISTS idx_user_extension_access_extension
        ON user_extension_access(extension_id, enabled)`,

      `CREATE TABLE IF NOT EXISTS deployment_settings (
        key TEXT PRIMARY KEY,
        value TEXT,
        updated_at INTEGER NOT NULL
      )`,

      `CREATE TABLE IF NOT EXISTS user_mcp_tokens (
        token_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        label TEXT,
        created_at INTEGER NOT NULL,
        last_used_at INTEGER,
        revoked_at INTEGER
      )`,
      `CREATE INDEX IF NOT EXISTS idx_user_mcp_tokens_user ON user_mcp_tokens(user_id, created_at DESC)`,

      `CREATE TABLE IF NOT EXISTS invites (
        token TEXT PRIMARY KEY,
        created_by_user_id TEXT,
        used_by_user_id TEXT,
        plan TEXT NOT NULL DEFAULT 'trial',
        created_at INTEGER NOT NULL,
        expires_at INTEGER,
        used_at INTEGER,
        revoked_at INTEGER
      )`,
      `CREATE INDEX IF NOT EXISTS idx_invites_unused ON invites(used_at) WHERE used_at IS NULL`,

      `CREATE TABLE IF NOT EXISTS user_plans (
        user_id TEXT PRIMARY KEY,
        plan TEXT NOT NULL DEFAULT 'trial',
        custom_outlet_limit INTEGER,
        custom_source_limit INTEGER,
        custom_folder_limit INTEGER,
        poll_all_enabled INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL
      )`,

      `CREATE TABLE IF NOT EXISTS deployment_state (
        key TEXT PRIMARY KEY,
        value TEXT
      )`,

      `CREATE TABLE IF NOT EXISTS email_verification_tokens (
        token TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        used_at INTEGER
      )`,
      `CREATE INDEX IF NOT EXISTS idx_email_verif_user ON email_verification_tokens(user_id)`,

      `CREATE TABLE IF NOT EXISTS password_reset_tokens (
        token TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        used_at INTEGER
      )`,
      `CREATE INDEX IF NOT EXISTS idx_password_reset_user ON password_reset_tokens(user_id)`,
    ],
    "write",
  );

  await backfillFirstAdminState();
  await backfillLegacyAppSettings();
  await backfillLegacyPasswordVerification();
  await writeSchemaSentinel();
  initialized = true;
}

async function backfillFirstAdminState(): Promise<void> {
  await db.execute({
    sql: `INSERT OR IGNORE INTO deployment_state (key, value)
          VALUES (
            'first_admin_user_id',
            (SELECT id FROM users WHERE is_admin = 1 ORDER BY created_at ASC LIMIT 1)
          )`,
  });
}

export async function backfillLegacyPasswordVerification(): Promise<void> {
  const backfillKey = "legacy_password_email_verification_backfilled_at";
  const existing = await db.execute({
    sql: "SELECT 1 FROM deployment_state WHERE key = ?",
    args: [backfillKey],
  });
  if (existing.rows.length > 0) return;

  const cutoff = Date.now();
  await db.batch([
    {
      sql: `UPDATE users
            SET email_verified_at = created_at
            WHERE password_hash IS NOT NULL
              AND email_verified_at IS NULL
              AND created_at < ?`,
      args: [cutoff],
    },
    {
      sql: "INSERT OR IGNORE INTO deployment_state (key, value) VALUES (?, ?)",
      args: [backfillKey, String(cutoff)],
    },
  ]);
}

async function schemaSentinelMatches(): Promise<boolean> {
  try {
    const r = await db.execute({
      sql: `SELECT value FROM deployment_settings WHERE key = 'schema_version'`,
    });
    return r.rows.length > 0 && String(r.rows[0]!.value) === SCHEMA_VERSION;
  } catch {
    // deployment_settings table does not exist yet (first deploy on a fresh DB).
    return false;
  }
}

async function writeSchemaSentinel(): Promise<void> {
  await db.execute({
    sql: `INSERT INTO deployment_settings (key, value, updated_at)
          VALUES ('schema_version', ?, ?)
          ON CONFLICT(key) DO UPDATE SET
            value = excluded.value,
            updated_at = excluded.updated_at`,
    args: [SCHEMA_VERSION, Date.now()],
  });
}

async function backfillLegacyAppSettings(): Promise<void> {
  const backfillKey = "legacy_app_settings_backfilled_at";
  const existing = await db.execute({
    sql: "SELECT 1 FROM deployment_state WHERE key = ?",
    args: [backfillKey],
  });
  if (existing.rows.length > 0) return;

  const legacy = await db.execute({
    sql: `SELECT key, value, updated_at FROM app_settings WHERE key != 'schema_version'`,
  });
  if (legacy.rows.length === 0) {
    await markLegacyAppSettingsBackfilled(backfillKey, "empty");
    return;
  }

  const ownerId = await findLegacySettingsOwnerId();
  if (!ownerId) {
    console.warn("[migrate] app_settings: found legacy settings but no user exists to own them");
    await markLegacyAppSettingsBackfilled(backfillKey, "no-user-owner");
    return;
  }

  for (const row of legacy.rows) {
    const resolved = await resolveLegacySettingTarget(String(row.key), ownerId);
    if (!resolved) continue;
    await db.execute({
      sql: `INSERT INTO user_settings (user_id, key, value, updated_at)
            SELECT ?, ?, ?, ?
            WHERE EXISTS (SELECT 1 FROM users WHERE id = ?)
            ON CONFLICT(user_id, key) DO NOTHING`,
      args: [
        resolved.userId,
        resolved.key,
        row.value ?? null,
        row.updated_at ? Number(row.updated_at) : Date.now(),
        resolved.userId,
      ],
    });
  }

  await markLegacyAppSettingsBackfilled(backfillKey, "copied");
}

async function markLegacyAppSettingsBackfilled(key: string, reason: string): Promise<void> {
  await db.execute({
    sql: "INSERT OR IGNORE INTO deployment_state (key, value) VALUES (?, ?)",
    args: [key, JSON.stringify({ at: Date.now(), reason })],
  });
}

async function findLegacySettingsOwnerId(): Promise<string | null> {
  const firstAdmin = await db.execute({
    sql: `SELECT id FROM users WHERE is_admin = 1 ORDER BY created_at ASC LIMIT 1`,
  });
  if (firstAdmin.rows.length > 0) return String(firstAdmin.rows[0]!.id);

  const firstUser = await db.execute({
    sql: `SELECT id FROM users ORDER BY created_at ASC LIMIT 1`,
  });
  return firstUser.rows.length > 0 ? String(firstUser.rows[0]!.id) : null;
}

async function resolveLegacySettingTarget(
  key: string,
  ownerId: string,
): Promise<{ userId: string; key: string } | null> {
  const relatedImagesPrefix = "related_images_license_filter:";
  if (key.startsWith(relatedImagesPrefix)) {
    const userId = key.slice(relatedImagesPrefix.length);
    if (!userId) return null;
    const user = await db.execute({
      sql: "SELECT 1 FROM users WHERE id = ?",
      args: [userId],
    });
    if (user.rows.length === 0) return null;
    return { userId, key: "related_images_license_filter" };
  }
  return { userId: ownerId, key };
}

async function migrateSourceFolderMemberships(): Promise<void> {
  await db.execute(`CREATE TABLE IF NOT EXISTS source_folder_assignments (
    source_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    folder_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (source_id, folder_id)
  )`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_source_folder_assignments_user_folder
    ON source_folder_assignments(user_id, folder_id)`);
  await db.execute({
    sql: `INSERT OR IGNORE INTO source_folder_assignments
            (source_id, user_id, folder_id, created_at)
          SELECT id, user_id, folder_id, created_at
          FROM sources
          WHERE folder_id IS NOT NULL`,
  });
  const existingTables = await db.execute({
    sql: `SELECT name FROM sqlite_master WHERE type = 'table'`,
  });
  const tableNames = new Set(existingTables.rows.map((row) => String(row.name)));
  const hasOutletSources = tableNames.has("outlet_sources");
  const hasItems = tableNames.has("items");

  const duplicateGroups = await db.execute({
    sql: `SELECT user_id, kind, url
          FROM sources
          GROUP BY user_id, kind, url
          HAVING COUNT(*) > 1`,
  });
  for (const group of duplicateGroups.rows) {
    const rows = await db.execute({
      sql: `SELECT id FROM sources
            WHERE user_id = ? AND kind = ? AND url = ?
            ORDER BY created_at ASC, id ASC`,
      args: [group.user_id, group.kind, group.url],
    });
    const sourceIds = rows.rows.map((row) => String(row.id));
    const keeperId = sourceIds[0];
    if (!keeperId) continue;
    for (const duplicateId of sourceIds.slice(1)) {
      const statements = [
        {
          sql: `INSERT OR IGNORE INTO source_folder_assignments
                  (source_id, user_id, folder_id, created_at)
                SELECT ?, user_id, folder_id, created_at
                FROM source_folder_assignments
                WHERE source_id = ?`,
          args: [keeperId, duplicateId],
        },
      ];
      if (hasOutletSources) {
        statements.push(
          {
            sql: `INSERT OR IGNORE INTO outlet_sources (outlet_id, source_id, created_at)
                  SELECT outlet_id, ?, created_at
                  FROM outlet_sources
                  WHERE source_id = ?`,
            args: [keeperId, duplicateId],
          },
          {
            sql: `DELETE FROM outlet_sources WHERE source_id = ?`,
            args: [duplicateId],
          },
        );
      }
      if (hasItems) {
        statements.push({
          sql: `UPDATE items SET source_id = ? WHERE source_id = ?`,
          args: [keeperId, duplicateId],
        });
      }
      statements.push(
        {
          sql: `DELETE FROM source_folder_assignments WHERE source_id = ?`,
          args: [duplicateId],
        },
        {
          sql: `DELETE FROM sources WHERE id = ?`,
          args: [duplicateId],
        },
      );
      await db.batch(statements, "write");
    }
    await db.execute({
      sql: `UPDATE sources
            SET folder_id = (
              SELECT folder_id
              FROM source_folder_assignments
              WHERE source_id = ?
              ORDER BY created_at ASC
              LIMIT 1
            )
            WHERE id = ?`,
      args: [keeperId, keeperId],
    });
  }
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
      const pkCols = pragma.rows.filter((r) => Number(r.pk) > 0).map((r) => String(r.name));
      if (!pkCols.includes("outlet_id")) {
        console.info(
          "[migrate] voice_profiles: dropping legacy table (was keyed on user_id; rebuilding under outlet_id)",
        );
        await db.execute("DROP TABLE voice_profiles");
      } else {
        const cols = pragma.rows.map((r) => String(r.name));
        if (!cols.includes("description")) {
          console.info("[migrate] voice_profiles: adding description column");
          await db.execute("ALTER TABLE voice_profiles ADD COLUMN description TEXT");
        }
        if (!cols.includes("seed_method")) {
          console.info("[migrate] voice_profiles: adding seed_method column");
          await db.execute("ALTER TABLE voice_profiles ADD COLUMN seed_method TEXT");
        }
        if (!cols.includes("seed_transcript")) {
          console.info("[migrate] voice_profiles: adding seed_transcript column");
          await db.execute("ALTER TABLE voice_profiles ADD COLUMN seed_transcript TEXT");
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
        console.info("[migrate] drafts: adding outlet_id column");
        await db.execute("ALTER TABLE drafts ADD COLUMN outlet_id TEXT NOT NULL DEFAULT ''");
      }
      if (!cols.includes("mode")) {
        // eslint-disable-next-line no-console
        console.info("[migrate] drafts: adding mode column");
        await db.execute("ALTER TABLE drafts ADD COLUMN mode TEXT NOT NULL DEFAULT 'drafter'");
      }
      if (!cols.includes("notes")) {
        // eslint-disable-next-line no-console
        console.info("[migrate] drafts: adding notes column");
        await db.execute("ALTER TABLE drafts ADD COLUMN notes TEXT");
      }
      if (!cols.includes("research_board")) {
        console.info("[migrate] drafts: adding research_board column");
        await db.execute("ALTER TABLE drafts ADD COLUMN research_board TEXT");
      }
      // WP round-trip sync columns. wp_synced_at is the local clock at the
      // last successful pull or push; wp_modified_at mirrors WP's post.modified
      // so we can detect WP-side changes between syncs; wp_content_hash is the
      // sha256 of the body as it was at the last sync, used to tell whether
      // the local body has drifted since.
      if (!cols.includes("wp_synced_at")) {
        console.info("[migrate] drafts: adding wp_synced_at column");
        await db.execute("ALTER TABLE drafts ADD COLUMN wp_synced_at INTEGER");
      }
      if (!cols.includes("wp_modified_at")) {
        console.info("[migrate] drafts: adding wp_modified_at column");
        await db.execute("ALTER TABLE drafts ADD COLUMN wp_modified_at INTEGER");
      }
      if (!cols.includes("wp_content_hash")) {
        console.info("[migrate] drafts: adding wp_content_hash column");
        await db.execute("ALTER TABLE drafts ADD COLUMN wp_content_hash TEXT");
      }
      if (!cols.includes("angle_hint")) {
        console.info("[migrate] drafts: adding angle_hint column");
        await db.execute("ALTER TABLE drafts ADD COLUMN angle_hint TEXT");
      }
      if (!cols.includes("custom_angle")) {
        console.info("[migrate] drafts: adding custom_angle column");
        await db.execute("ALTER TABLE drafts ADD COLUMN custom_angle TEXT");
      }
      if (!cols.includes("format")) {
        console.info("[migrate] drafts: adding format column");
        await db.execute("ALTER TABLE drafts ADD COLUMN format TEXT");
      }
    }
  } catch {
    // Table will be created clean by CREATE IF NOT EXISTS.
  }

  // wp_authorize_states: bind new WordPress Application Password authorize
  // flows to the browser that started them while letting old in-flight rows
  // expire naturally.
  try {
    const pragma = await db.execute("PRAGMA table_info(wp_authorize_states)");
    if (pragma.rows.length > 0) {
      const cols = pragma.rows.map((r) => String(r.name));
      if (!cols.includes("bound_value")) {
        console.info("[migrate] wp_authorize_states: adding bound_value column");
        await db.execute("ALTER TABLE wp_authorize_states ADD COLUMN bound_value TEXT");
      }
    }
  } catch {
    // Table will be created clean by CREATE IF NOT EXISTS.
  }

  // items: reader-mode mark/dismiss columns. Reader is a triage surface
  // where the user swipes through unclustered items; marked items are
  // the seeds for LLM-formed clusters, dismissed items drop out of the
  // queue. Both nullable so they can re-enter the queue if the user
  // un-marks (clearing on cluster-formation) or we add an "undo" later.
  try {
    const pragma = await db.execute("PRAGMA table_info(items)");
    if (pragma.rows.length > 0) {
      const cols = pragma.rows.map((r) => String(r.name));
      if (!cols.includes("marked_at")) {
        console.info("[migrate] items: adding marked_at column");
        await db.execute("ALTER TABLE items ADD COLUMN marked_at INTEGER");
      }
      if (!cols.includes("dismissed_at")) {
        console.info("[migrate] items: adding dismissed_at column");
        await db.execute("ALTER TABLE items ADD COLUMN dismissed_at INTEGER");
      }
      if (!cols.includes("score")) {
        console.info("[migrate] items: adding score column");
        await db.execute("ALTER TABLE items ADD COLUMN score INTEGER");
      }
      if (!cols.includes("comment_count")) {
        console.info("[migrate] items: adding comment_count column");
        await db.execute("ALTER TABLE items ADD COLUMN comment_count INTEGER");
      }
      // LLM-at-ingest extractor outputs. primary_subject is the single
      // thing the article is mainly about; beat_tag is the topical lane
      // (e.g., "AI hardware", "iPhone news"). Both nullable so older
      // items that haven't been re-extracted don't break joins.
      if (!cols.includes("primary_subject")) {
        console.info("[migrate] items: adding primary_subject column");
        await db.execute("ALTER TABLE items ADD COLUMN primary_subject TEXT");
      }
      if (!cols.includes("beat_tag")) {
        console.info("[migrate] items: adding beat_tag column");
        await db.execute("ALTER TABLE items ADD COLUMN beat_tag TEXT");
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
        console.info("[migrate] sources: adding folder_id column");
        await db.execute("ALTER TABLE sources ADD COLUMN folder_id TEXT");
      }
      if (!cols.includes("last_etag")) {
        console.info("[migrate] sources: adding last_etag column");
        await db.execute("ALTER TABLE sources ADD COLUMN last_etag TEXT");
      }
      if (!cols.includes("last_modified")) {
        console.info("[migrate] sources: adding last_modified column");
        await db.execute("ALTER TABLE sources ADD COLUMN last_modified TEXT");
      }
      if (!cols.includes("backoff_until")) {
        console.info("[migrate] sources: adding backoff_until column");
        await db.execute("ALTER TABLE sources ADD COLUMN backoff_until INTEGER");
      }
      if (!cols.includes("paused_until")) {
        console.info("[migrate] sources: adding paused_until column");
        await db.execute("ALTER TABLE sources ADD COLUMN paused_until INTEGER");
      }
      await migrateSourceFolderMemberships();
    }
  } catch {
    // Table will be created clean by CREATE IF NOT EXISTS.
  }

  // workflow_autopublish_configs: move from one config per outlet to one
  // config per outlet and folder scope. SQLite cannot drop the old
  // UNIQUE(user_id, outlet_id), so rebuild when the scope column is absent.
  try {
    const pragma = await db.execute("PRAGMA table_info(workflow_autopublish_configs)");
    if (pragma.rows.length > 0) {
      const cols = pragma.rows.map((r) => String(r.name));
      if (!cols.includes("folder_scope")) {
        console.info("[migrate] workflow_autopublish_configs: adding folder_scope key");
        await db.execute("DROP TABLE IF EXISTS workflow_autopublish_configs_next");
        await db.execute(`
          CREATE TABLE workflow_autopublish_configs_next (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            outlet_id TEXT NOT NULL,
            folder_scope TEXT NOT NULL DEFAULT 'all',
            enabled INTEGER NOT NULL DEFAULT 0,
            interval_hours INTEGER NOT NULL DEFAULT 12,
            auto_update INTEGER NOT NULL DEFAULT 1,
            fresh_source_window_hours INTEGER NOT NULL DEFAULT 24,
            next_run_at INTEGER,
            last_run_at INTEGER,
            last_draft_id TEXT,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            UNIQUE(user_id, outlet_id, folder_scope)
          )
        `);
        await db.execute(`
          INSERT INTO workflow_autopublish_configs_next
            (id, user_id, outlet_id, folder_scope, enabled, interval_hours,
             auto_update, fresh_source_window_hours, next_run_at, last_run_at,
             last_draft_id, created_at, updated_at)
          SELECT id, user_id, outlet_id, 'all', enabled, interval_hours,
                 auto_update, fresh_source_window_hours, next_run_at, last_run_at,
                 last_draft_id, created_at, updated_at
          FROM workflow_autopublish_configs
        `);
        await db.execute("DROP TABLE workflow_autopublish_configs");
        await db.execute(
          "ALTER TABLE workflow_autopublish_configs_next RENAME TO workflow_autopublish_configs",
        );
      }
    }
  } catch {
    // Table will be created clean by CREATE IF NOT EXISTS.
  }

  // workflow_autopublish_log: keep enough context to tell which folder lane
  // a run used. Legacy entries are all-folder runs.
  try {
    const pragma = await db.execute("PRAGMA table_info(workflow_autopublish_log)");
    if (pragma.rows.length > 0) {
      const cols = pragma.rows.map((r) => String(r.name));
      if (!cols.includes("folder_scope")) {
        console.info("[migrate] workflow_autopublish_log: adding folder_scope column");
        await db.execute(
          "ALTER TABLE workflow_autopublish_log ADD COLUMN folder_scope TEXT NOT NULL DEFAULT 'all'",
        );
      }
    }
  } catch {
    // Table will be created clean by CREATE IF NOT EXISTS.
  }

  // outlets: WP.com OAuth metadata pins the blog_id resolved at authorize
  // stage and stores token rotation state alongside the encrypted bearer.
  try {
    const pragma = await db.execute("PRAGMA table_info(outlets)");
    if (pragma.rows.length > 0) {
      const cols = pragma.rows.map((r) => String(r.name));
      if (!cols.includes("wpcom_expected_blog_id")) {
        console.info("[migrate] outlets: adding wpcom_expected_blog_id column");
        await db.execute("ALTER TABLE outlets ADD COLUMN wpcom_expected_blog_id TEXT");
      }
      if (!cols.includes("wpcom_token_expires_at")) {
        console.info("[migrate] outlets: adding wpcom_token_expires_at column");
        await db.execute("ALTER TABLE outlets ADD COLUMN wpcom_token_expires_at INTEGER");
      }
      if (!cols.includes("wpcom_refresh_token_encrypted")) {
        console.info("[migrate] outlets: adding wpcom_refresh_token_encrypted column");
        await db.execute("ALTER TABLE outlets ADD COLUMN wpcom_refresh_token_encrypted BLOB");
      }
      if (!cols.includes("wpcom_token_kid")) {
        console.info("[migrate] outlets: adding wpcom_token_kid column");
        await db.execute("ALTER TABLE outlets ADD COLUMN wpcom_token_kid TEXT");
      }
    }
  } catch {
    // Table will be created clean by CREATE IF NOT EXISTS.
  }

  // related_image_runs: license_filter column added so the loader can
  // tell when the cached run is for a different filter than the user's
  // current selection.
  try {
    const pragma = await db.execute("PRAGMA table_info(related_image_runs)");
    if (pragma.rows.length > 0) {
      const cols = pragma.rows.map((r) => String(r.name));
      if (!cols.includes("license_filter")) {
        // eslint-disable-next-line no-console
        console.info("[migrate] related_image_runs: adding license_filter column");
        await db.execute("ALTER TABLE related_image_runs ADD COLUMN license_filter TEXT");
      }
    }
  } catch {
    // Table will be created clean by CREATE IF NOT EXISTS.
  }

  // user_plans: explicit Poll all entitlement, separate from the custom
  // plan label. Existing custom rows keep their old behavior.
  try {
    const pragma = await db.execute("PRAGMA table_info(user_plans)");
    if (pragma.rows.length > 0) {
      const cols = pragma.rows.map((r) => String(r.name));
      if (!cols.includes("poll_all_enabled")) {
        console.info("[migrate] user_plans: adding poll_all_enabled column");
        await db.execute(
          "ALTER TABLE user_plans ADD COLUMN poll_all_enabled INTEGER NOT NULL DEFAULT 0",
        );
        await db.execute(
          "UPDATE user_plans SET poll_all_enabled = 1 WHERE lower(trim(plan)) = 'custom'",
        );
      }
    }
  } catch {
    // Table will be created clean by CREATE IF NOT EXISTS.
  }

  // users: auth-foundation columns. Additive ALTERs; safe on fresh DBs
  // because CREATE TABLE IF NOT EXISTS runs after this and seeds users
  // without the new columns the first time the migration runs.
  try {
    const pragma = await db.execute("PRAGMA table_info(users)");
    if (pragma.rows.length > 0) {
      const cols = pragma.rows.map((r) => String(r.name));
      if (!cols.includes("password_hash")) {
        console.info("[migrate] users: adding password_hash column");
        await db.execute("ALTER TABLE users ADD COLUMN password_hash TEXT");
      }
      if (!cols.includes("wpcom_id")) {
        console.info("[migrate] users: adding wpcom_id column");
        await db.execute("ALTER TABLE users ADD COLUMN wpcom_id TEXT");
      }
      if (!cols.includes("wpcom_username")) {
        console.info("[migrate] users: adding wpcom_username column");
        await db.execute("ALTER TABLE users ADD COLUMN wpcom_username TEXT");
      }
      if (!cols.includes("email_verified_at")) {
        console.info("[migrate] users: adding email_verified_at column");
        await db.execute("ALTER TABLE users ADD COLUMN email_verified_at INTEGER");
      }
      if (!cols.includes("status")) {
        console.info("[migrate] users: adding status column");
        await db.execute("ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'active'");
      }
      if (!cols.includes("is_admin")) {
        console.info("[migrate] users: adding is_admin column");
        await db.execute("ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0");
      }
      if (!cols.includes("session_version")) {
        console.info("[migrate] users: adding session_version column");
        await db.execute("ALTER TABLE users ADD COLUMN session_version INTEGER NOT NULL DEFAULT 0");
      }
    }
  } catch {
    // Table will be created clean by CREATE IF NOT EXISTS.
  }

  // invites: revocation marker for admin-issued links. Revoked invites
  // remain auditable in storage but are no longer valid for signup.
  try {
    const pragma = await db.execute("PRAGMA table_info(invites)");
    if (pragma.rows.length > 0) {
      const cols = pragma.rows.map((r) => String(r.name));
      if (!cols.includes("revoked_at")) {
        console.info("[migrate] invites: adding revoked_at column");
        await db.execute("ALTER TABLE invites ADD COLUMN revoked_at INTEGER");
      }
      if (!cols.includes("plan")) {
        console.info("[migrate] invites: adding plan column");
        await db.execute("ALTER TABLE invites ADD COLUMN plan TEXT NOT NULL DEFAULT 'trial'");
      }
    }
  } catch {
    // Table will be created clean by CREATE IF NOT EXISTS.
  }

  // job_progress: add user_id so maintenance jobs scope per-user. Nullable
  // for legacy rows; new inserts always set it.
  try {
    const pragma = await db.execute("PRAGMA table_info(job_progress)");
    if (pragma.rows.length > 0) {
      const cols = pragma.rows.map((r) => String(r.name));
      if (!cols.includes("user_id")) {
        console.info("[migrate] job_progress: adding user_id column");
        await db.execute("ALTER TABLE job_progress ADD COLUMN user_id TEXT");
      }
    }
  } catch {
    // Table will be created clean by CREATE IF NOT EXISTS.
  }
}
