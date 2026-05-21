import "server-only";

import { createHash } from "node:crypto";
import { db, ensureSchema } from "@/lib/db";
import { publishToWordPress } from "@/lib/wordpress";
import { sanitizeDraftHtml } from "@/lib/draft-html-sanitizer";
import { recordWordPressPushed } from "@/lib/v1/analytics";
import { generateDraft } from "@/lib/v1/draft-generator";
import { getOutletCredentials, listOutlets } from "@/lib/v1/outlets";
import { getEffectiveDisabledExtensionIds } from "@/lib/v1/settings";
import { adjustClusterSourceTrust, TRUST_DELTA } from "@/lib/v1/trust";
import {
  WORKFLOW_AUTOPUBLISH_ID,
  WORKFLOW_FRESHNESS_OPTIONS,
  WORKFLOW_INTERVAL_OPTIONS,
  type WorkflowAutopublishConfig,
  type WorkflowAutopublishLogEntry,
  type WorkflowAutopublishStatus,
} from "./types";

const DEFAULT_INTERVAL_HOURS = 12;
const DEFAULT_FRESH_SOURCE_WINDOW_HOURS = 24;
const DEFAULT_MAX_BATCH = 2;

interface ConfigRow {
  id: string;
  user_id: string;
  outlet_id: string;
  enabled: number;
  interval_hours: number;
  auto_update: number;
  fresh_source_window_hours: number;
  next_run_at: number | null;
  last_run_at: number | null;
  last_draft_id: string | null;
  created_at: number;
  updated_at: number;
}

interface SelectedCluster {
  clusterId: string;
  latestPublishedAt: number;
}

interface DraftForPublish {
  id: string;
  clusterId: string;
  outletId: string;
  headline: string;
  body: string;
  quotes: unknown[];
}

export interface WorkflowAutopublishState {
  outlets: {
    id: string;
    label: string;
    connected: boolean;
    config: WorkflowAutopublishConfig;
    lastLog: WorkflowAutopublishLogEntry | null;
  }[];
  logs: WorkflowAutopublishLogEntry[];
}

export interface WorkflowAutopublishRunResult {
  due: number;
  claimed: number;
  published: number;
  skipped: number;
  failed: number;
}

export interface WorkflowAutopublishSaveInput {
  outletId: string;
  userId: string;
  enabled: boolean;
  intervalHours: number;
  autoUpdate: boolean;
  freshSourceWindowHours: number;
}

export async function loadWorkflowAutopublishState(
  userId: string,
): Promise<WorkflowAutopublishState> {
  await ensureSchema();
  const [outlets, configsR, logsR] = await Promise.all([
    listOutlets(userId),
    db.execute({
      sql: `SELECT * FROM workflow_autopublish_configs WHERE user_id = ?`,
      args: [userId],
    }),
    db.execute({
      sql: `SELECT id, outlet_id, draft_id, cluster_id, status, message, created_at
            FROM workflow_autopublish_log
            WHERE user_id = ?
            ORDER BY created_at DESC
            LIMIT 12`,
      args: [userId],
    }),
  ]);

  const configByOutlet = new Map(
    configsR.rows.map((row) => {
      const config = configFromRow(row as unknown as ConfigRow);
      return [config.outletId, config] as const;
    }),
  );
  const outletLabelById = new Map(
    outlets.map((outlet) => [outlet.id, outlet.displayName ?? outlet.baseUrl] as const),
  );
  const logs = logsR.rows.map((row) => logEntryFromRow(row, outletLabelById));
  const lastLogByOutlet = new Map<string, WorkflowAutopublishLogEntry>();
  for (const log of logs) {
    if (!lastLogByOutlet.has(log.outletId)) lastLogByOutlet.set(log.outletId, log);
  }

  return {
    outlets: outlets.map((outlet) => ({
      id: outlet.id,
      label: outlet.displayName ?? outlet.baseUrl,
      connected: outlet.connected,
      config: configByOutlet.get(outlet.id) ?? defaultConfig(userId, outlet.id),
      lastLog: lastLogByOutlet.get(outlet.id) ?? null,
    })),
    logs,
  };
}

export async function saveWorkflowAutopublishConfig(
  input: WorkflowAutopublishSaveInput,
): Promise<void> {
  await ensureSchema();
  const outlet = await db.execute({
    sql: `SELECT id FROM outlets WHERE id = ? AND user_id = ?`,
    args: [input.outletId, input.userId],
  });
  if (outlet.rows.length === 0) throw new Error("Outlet not found.");

  const intervalHours = normalizeOption(
    input.intervalHours,
    WORKFLOW_INTERVAL_OPTIONS,
    DEFAULT_INTERVAL_HOURS,
  );
  const freshSourceWindowHours = normalizeOption(
    input.freshSourceWindowHours,
    WORKFLOW_FRESHNESS_OPTIONS,
    DEFAULT_FRESH_SOURCE_WINDOW_HOURS,
  );
  const now = Date.now();
  const nextRunAt = input.enabled ? now : null;
  await db.execute({
    sql: `INSERT INTO workflow_autopublish_configs
            (id, user_id, outlet_id, enabled, interval_hours, auto_update,
             fresh_source_window_hours, next_run_at, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(user_id, outlet_id) DO UPDATE SET
            enabled = excluded.enabled,
            interval_hours = excluded.interval_hours,
            auto_update = excluded.auto_update,
            fresh_source_window_hours = excluded.fresh_source_window_hours,
            next_run_at = CASE
              WHEN excluded.enabled = 1 AND workflow_autopublish_configs.enabled = 0
                THEN excluded.next_run_at
              WHEN excluded.enabled = 1 AND workflow_autopublish_configs.next_run_at IS NULL
                THEN excluded.next_run_at
              WHEN excluded.enabled = 0
                THEN NULL
              ELSE workflow_autopublish_configs.next_run_at
            END,
            updated_at = excluded.updated_at`,
    args: [
      crypto.randomUUID(),
      input.userId,
      input.outletId,
      input.enabled ? 1 : 0,
      intervalHours,
      input.autoUpdate ? 1 : 0,
      freshSourceWindowHours,
      nextRunAt,
      now,
      now,
    ],
  });
}

export async function runDueAutopublishWorkflows(
  options: { maxBatch?: number } = {},
): Promise<WorkflowAutopublishRunResult> {
  await ensureSchema();
  const maxBatch = Math.max(1, options.maxBatch ?? DEFAULT_MAX_BATCH);
  const now = Date.now();
  const due = await db.execute({
    sql: `SELECT * FROM workflow_autopublish_configs
          WHERE enabled = 1
            AND (next_run_at IS NULL OR next_run_at <= ?)
          ORDER BY COALESCE(next_run_at, 0) ASC
          LIMIT ?`,
    args: [now, maxBatch],
  });

  const result: WorkflowAutopublishRunResult = {
    due: due.rows.length,
    claimed: 0,
    published: 0,
    skipped: 0,
    failed: 0,
  };

  for (const row of due.rows) {
    const config = configFromRow(row as unknown as ConfigRow);
    const claimed = await claimConfig(config, now);
    if (!claimed) continue;
    result.claimed += 1;
    const status = await runOneWorkflow(config, now);
    result[status] += 1;
  }

  return result;
}

async function runOneWorkflow(
  config: WorkflowAutopublishConfig,
  now: number,
): Promise<"published" | "skipped" | "failed"> {
  try {
    const disabled = await getEffectiveDisabledExtensionIds(config.userId);
    if (disabled.has(WORKFLOW_AUTOPUBLISH_ID)) {
      await logRun(config, "skipped", "Workflow autopublish extension is disabled.");
      return "skipped";
    }

    const creds = await getOutletCredentials(config.outletId, config.userId);
    if (!creds) {
      await logRun(config, "skipped", "Outlet has no stored WordPress credentials.");
      return "skipped";
    }

    const cluster = await selectFreshCluster(config, now);
    if (!cluster) {
      await logRun(config, "skipped", "No fresh fired cluster is ready for autopublish.");
      return "skipped";
    }

    const draft = await resolveDraftForPublish(config, cluster.clusterId);
    if (draft.quotes.length === 0) {
      await logRun(
        config,
        "skipped",
        "Draft did not include source quotes, so autopublish was blocked.",
        { clusterId: cluster.clusterId, draftId: draft.id },
      );
      return "skipped";
    }

    // Atomically advance the cluster from 'fired' to 'published' before
    // calling WordPress so a partial failure after publish cannot lead to
    // a duplicate post on the next interval. We revert on WP failure.
    const claimed = await db.execute({
      sql: `UPDATE clusters SET state = 'published'
            WHERE id = ? AND user_id = ? AND state = 'fired'`,
      args: [draft.clusterId, config.userId],
    });
    if (claimed.rowsAffected === 0) {
      await logRun(
        config,
        "skipped",
        "Cluster state changed before publish; aborting to avoid duplicate.",
        { clusterId: draft.clusterId, draftId: draft.id },
      );
      return "skipped";
    }

    let published;
    try {
      published = await publishToWordPress({
        creds,
        title: draft.headline,
        contentHtml: draft.body,
        status: "publish",
      });
    } catch (err) {
      await db.execute({
        sql: `UPDATE clusters SET state = 'fired'
              WHERE id = ? AND user_id = ? AND state = 'published'`,
        args: [draft.clusterId, config.userId],
      });
      throw err;
    }
    const contentHash = createHash("sha256").update(sanitizeDraftHtml(draft.body)).digest("hex");
    await db.execute({
      sql: `UPDATE drafts
            SET wp_post_id = ?, wp_edit_link = ?,
                wp_synced_at = ?, wp_modified_at = ?, wp_content_hash = ?,
                state = 'published', edited_at = ?
            WHERE id = ? AND user_id = ? AND wp_post_id IS NULL`,
      args: [
        published.wpPostId,
        published.editLink,
        now,
        published.modifiedAt ?? now,
        contentHash,
        now,
        draft.id,
        config.userId,
      ],
    });
    await db.execute({
      sql: `UPDATE workflow_autopublish_configs
            SET last_run_at = ?, last_draft_id = ?, updated_at = ?
            WHERE id = ? AND user_id = ?`,
      args: [now, draft.id, now, config.id, config.userId],
    });
    await recordWordPressPushed(
      {
        draftId: draft.id,
        clusterId: draft.clusterId,
        outletId: draft.outletId,
        mode: "drafter",
        wpPostId: published.wpPostId,
        editLink: published.editLink,
        status: "publish",
      },
      { userId: config.userId },
    );
    await adjustClusterSourceTrust(draft.clusterId, TRUST_DELTA.draftPublished, config.userId);
    await logRun(config, "published", "Published one Workflow post.", {
      clusterId: draft.clusterId,
      draftId: draft.id,
    });
    return "published";
  } catch (err) {
    await logRun(config, "failed", err instanceof Error ? err.message : String(err));
    return "failed";
  }
}

async function resolveDraftForPublish(
  config: WorkflowAutopublishConfig,
  clusterId: string,
): Promise<DraftForPublish> {
  const reusable = await loadReusableDraft(config.userId, config.outletId, clusterId);
  if (reusable && !config.autoUpdate) return reusable;

  const generated = await generateDraft({
    clusterId,
    userId: config.userId,
    outletId: config.outletId,
  });
  const generatedDraft: DraftForPublish = {
    id: generated.draftId,
    clusterId,
    outletId: config.outletId,
    headline: generated.headline,
    body: generated.body,
    quotes: generated.quotes,
  };
  // If the regeneration came back without source quotes (e.g. stub mode or
  // a parser fallback), keep the reusable draft so we don't silently lose
  // a publishable draft; discard the empty regeneration instead.
  if (reusable && generatedDraft.quotes.length === 0) {
    await discardDraft(generated.draftId, config.userId);
    return reusable;
  }
  if (reusable) {
    await discardDraft(reusable.id, config.userId);
  }
  return generatedDraft;
}

async function discardDraft(draftId: string, userId: string): Promise<void> {
  await db.execute({
    sql: `UPDATE drafts
          SET state = 'discarded', edited_at = ?
          WHERE id = ? AND user_id = ? AND wp_post_id IS NULL`,
    args: [Date.now(), draftId, userId],
  });
}

async function loadReusableDraft(
  userId: string,
  outletId: string,
  clusterId: string,
): Promise<DraftForPublish | null> {
  const r = await db.execute({
    sql: `SELECT id, cluster_id, outlet_id, headline, body, quotes
          FROM drafts
          WHERE user_id = ?
            AND outlet_id = ?
            AND cluster_id = ?
            AND mode = 'drafter'
            AND wp_post_id IS NULL
            AND state IN ('pre-rendered', 'shown', 'edited')
          ORDER BY edited_at DESC, created_at DESC
          LIMIT 1`,
    args: [userId, outletId, clusterId],
  });
  if (r.rows.length === 0) return null;
  const row = r.rows[0]!;
  return {
    id: String(row.id),
    clusterId: String(row.cluster_id),
    outletId: String(row.outlet_id),
    headline: String(row.headline),
    body: String(row.body),
    quotes: parseQuotes(row.quotes),
  };
}

async function selectFreshCluster(
  config: WorkflowAutopublishConfig,
  now: number,
): Promise<SelectedCluster | null> {
  const oldestAllowed = now - config.freshSourceWindowHours * 60 * 60 * 1000;
  const r = await db.execute({
    sql: `SELECT c.id, MAX(i.published_at) AS latest_published_at
          FROM clusters c
          JOIN items i ON i.cluster_id = c.id AND i.user_id = c.user_id
          WHERE c.user_id = ?
            AND c.state = 'fired'
            AND i.published_at >= ?
            AND (
              NOT EXISTS (
                SELECT 1 FROM outlet_sources os_any WHERE os_any.outlet_id = ?
              )
              OR EXISTS (
                SELECT 1 FROM outlet_sources os
                WHERE os.outlet_id = ? AND os.source_id = i.source_id
              )
            )
            AND NOT EXISTS (
              SELECT 1 FROM drafts d
              WHERE d.user_id = c.user_id
                AND d.cluster_id = c.id
                AND d.wp_post_id IS NOT NULL
            )
          GROUP BY c.id
          ORDER BY COALESCE(c.ranker_score, 0) DESC, latest_published_at DESC
          LIMIT 1`,
    args: [config.userId, oldestAllowed, config.outletId, config.outletId],
  });
  if (r.rows.length === 0) return null;
  return {
    clusterId: String(r.rows[0]!.id),
    latestPublishedAt: Number(r.rows[0]!.latest_published_at ?? 0),
  };
}

async function claimConfig(config: WorkflowAutopublishConfig, now: number): Promise<boolean> {
  const nextRunAt = now + config.intervalHours * 60 * 60 * 1000;
  const r = await db.execute({
    sql: `UPDATE workflow_autopublish_configs
          SET next_run_at = ?, updated_at = ?
          WHERE id = ?
            AND user_id = ?
            AND enabled = 1
            AND (
              (next_run_at IS NULL AND ? IS NULL)
              OR next_run_at = ?
            )`,
    args: [nextRunAt, now, config.id, config.userId, config.nextRunAt, config.nextRunAt],
  });
  return r.rowsAffected > 0;
}

async function logRun(
  config: WorkflowAutopublishConfig,
  status: WorkflowAutopublishStatus,
  message: string,
  ids: { draftId?: string; clusterId?: string } = {},
): Promise<void> {
  await db.execute({
    sql: `INSERT INTO workflow_autopublish_log
            (id, user_id, outlet_id, draft_id, cluster_id, status, message, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      crypto.randomUUID(),
      config.userId,
      config.outletId,
      ids.draftId ?? null,
      ids.clusterId ?? null,
      status,
      message.slice(0, 500),
      Date.now(),
    ],
  });
}

function configFromRow(row: ConfigRow): WorkflowAutopublishConfig {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    outletId: String(row.outlet_id),
    enabled: Number(row.enabled) === 1,
    intervalHours: Number(row.interval_hours),
    autoUpdate: Number(row.auto_update) === 1,
    freshSourceWindowHours: Number(row.fresh_source_window_hours),
    nextRunAt: row.next_run_at === null ? null : Number(row.next_run_at),
    lastRunAt: row.last_run_at === null ? null : Number(row.last_run_at),
    lastDraftId: row.last_draft_id === null ? null : String(row.last_draft_id),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

function logEntryFromRow(
  row: Record<string, unknown>,
  outletLabelById: Map<string, string>,
): WorkflowAutopublishLogEntry {
  const outletId = String(row.outlet_id);
  return {
    id: String(row.id),
    outletId,
    outletLabel: outletLabelById.get(outletId) ?? "Unknown outlet",
    draftId: row.draft_id === null ? null : String(row.draft_id),
    clusterId: row.cluster_id === null ? null : String(row.cluster_id),
    status: String(row.status) as WorkflowAutopublishStatus,
    message: String(row.message),
    createdAt: Number(row.created_at),
  };
}

function defaultConfig(userId: string, outletId: string): WorkflowAutopublishConfig {
  const now = Date.now();
  return {
    id: "",
    userId,
    outletId,
    enabled: false,
    intervalHours: DEFAULT_INTERVAL_HOURS,
    autoUpdate: true,
    freshSourceWindowHours: DEFAULT_FRESH_SOURCE_WINDOW_HOURS,
    nextRunAt: null,
    lastRunAt: null,
    lastDraftId: null,
    createdAt: now,
    updatedAt: now,
  };
}

function normalizeOption<T extends readonly number[]>(
  value: number,
  options: T,
  fallback: T[number],
): T[number] {
  return options.includes(value) ? (value as T[number]) : fallback;
}

function parseQuotes(raw: unknown): unknown[] {
  if (raw === null || raw === undefined) return [];
  try {
    const parsed = JSON.parse(String(raw)) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
