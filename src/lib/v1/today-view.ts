import "server-only";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import type { ResultSet } from "@libsql/client";
import { db, ensureSchema } from "@/lib/db";
import { loadSignatureTermsByOutlet, pickPreferredOutletForCluster } from "./ranker";
import { defaultDraftFormatOptions } from "./draft-format";
import { listOutletFormatsForUser } from "./outlet-formats";
import type {
  OutletOption,
  TodayClusterPreview,
  TodayFolderStream,
} from "@/app/_components/TodayFolderStreams";

const TODAY_VIEW_KEY = "today";
const TODAY_VIEW_VERSION = 2;
const REFRESH_LOCK_MS = 30_000;

// Finder-column layout shows the full content of the selected folder in
// the right pane and the user scrolls the page. Today should stay fresh;
// older clusters remain reachable through history-specific surfaces.
const TODAY_CLUSTER_WINDOW_MS = 60 * 60 * 60 * 1000;

// Per-folder cap is defense in depth so a feed surge can't render
// thousands of cards.
const PER_FOLDER_LIMIT = 50;

export interface TodayFrame {
  userId: string;
  renderedAt: number;
  hasOutlet: boolean;
  sourceCount: number;
  hasDraftableOutlet: boolean;
  stats: {
    newSinceLastVisit: number;
    draftsInProgress: number;
    sentThisMonth: number;
  };
  outletOptions: OutletOption[];
  defaultOutletId: string | null;
  draftableOutletIds: string[];
}

export interface TodayReadyPayload {
  streams: TodayFolderStream[];
  totalPreviews: number;
  streamsWithContent: number;
  emptyClusterStats: {
    polledSourceCount: number;
    itemsTotal: number;
    itemsTotalCapped: boolean;
  } | null;
}

export interface TodayPagePayload {
  frame: TodayFrame;
  ready: TodayReadyPayload;
}

export interface TodayCacheState {
  payload: TodayPagePayload | null;
  status: "fresh" | "stale" | "missing";
  inputHash: string;
  computedAt: number | null;
  refreshStartedAt: number | null;
  error: string | null;
}

type TodayClusterCandidate = TodayClusterPreview["cluster"] & {
  primaryEntities: string[] | null;
};

type TodayPreviewItem = TodayClusterPreview["items"][number] & {
  entities: string[] | null;
};

type TodayDraftsByOutlet = TodayClusterPreview["draftsByOutlet"];

interface TodayFrameResults {
  outletsR: ResultSet;
  sourceCountR: ResultSet;
  voiceR: ResultSet;
  newItemsR: ResultSet;
  draftsInProgressR: ResultSet;
  sentThisMonthR: ResultSet;
}

export async function loadTodayFrame(userId: string): Promise<TodayFrame> {
  await ensureSchema();
  const now = Date.now();
  const [outletsR, sourceCountR, voiceR, newItemsR, draftsInProgressR, sentThisMonthR] =
    await loadTodayFrameRows(userId, now);
  const frame = buildTodayFrame(userId, now, {
    outletsR,
    sourceCountR,
    voiceR,
    newItemsR,
    draftsInProgressR,
    sentThisMonthR,
  });
  return attachOutletFormats(frame, userId);
}

export async function loadTodayPageState(
  userId: string,
): Promise<{ frame: TodayFrame; cache: TodayCacheState }> {
  await ensureSchema();
  const now = Date.now();
  const [outletsR, sourceCountR, voiceR, newItemsR, draftsInProgressR, sentThisMonthR, cacheR] =
    await db.batch([...todayFrameStatements(userId, now), todayCacheStatement(userId)], "read");
  const frame = buildTodayFrame(userId, now, {
    outletsR,
    sourceCountR,
    voiceR,
    newItemsR,
    draftsInProgressR,
    sentThisMonthR,
  });
  return {
    frame: await attachOutletFormats(frame, userId),
    cache: cacheStateFromRows(cacheR.rows, "", false),
  };
}

async function attachOutletFormats(frame: TodayFrame, userId: string): Promise<TodayFrame> {
  const formatsByOutlet = await listOutletFormatsForUser(userId);
  return {
    ...frame,
    outletOptions: frame.outletOptions.map((outlet) => ({
      ...outlet,
      formats: formatsByOutlet.get(outlet.id) ?? defaultDraftFormatOptions(),
    })),
  };
}

async function loadTodayFrameRows(userId: string, now: number) {
  const [outletsR, sourceCountR, voiceR, newItemsR, draftsInProgressR, sentThisMonthR] =
    await db.batch(todayFrameStatements(userId, now), "read");
  return [outletsR, sourceCountR, voiceR, newItemsR, draftsInProgressR, sentThisMonthR] as const;
}

function todayFrameStatements(userId: string, now: number) {
  const last24h = now - 24 * 60 * 60 * 1000;
  const monthStart = new Date(new Date(now).getFullYear(), new Date(now).getMonth(), 1).getTime();

  return [
    {
      sql: `SELECT id, base_url, display_name, is_default,
                     CASE WHEN app_password_encrypted IS NULL THEN 0 ELSE 1 END AS connected
              FROM outlets
              WHERE user_id = ?
              ORDER BY is_default DESC, created_at ASC`,
      args: [userId],
    },
    {
      sql: `SELECT COUNT(*) AS n FROM sources
              WHERE user_id = ? AND active = 1
                AND (paused_until IS NULL OR paused_until <= ?)`,
      args: [userId, now],
    },
    {
      sql: `SELECT outlet_id FROM voice_profiles WHERE user_id = ?`,
      args: [userId],
    },
    {
      sql: `SELECT COUNT(*) AS n FROM items WHERE user_id = ? AND fetched_at > ?`,
      args: [userId, last24h],
    },
    {
      sql: `SELECT COUNT(*) AS n FROM drafts WHERE user_id = ? AND wp_synced_at IS NULL`,
      args: [userId],
    },
    {
      sql: `SELECT COUNT(*) AS n FROM drafts
            WHERE user_id = ? AND wp_synced_at IS NOT NULL AND wp_synced_at > ?`,
      args: [userId, monthStart],
    },
  ];
}

function todayCacheStatement(userId: string) {
  return {
    sql: `SELECT payload, payload_version, input_hash, computed_at, refresh_started_at, error
          FROM view_cache WHERE user_id = ? AND view_key = ?`,
    args: [userId, TODAY_VIEW_KEY],
  };
}

function buildTodayFrame(userId: string, now: number, rows: TodayFrameResults): TodayFrame {
  const { outletsR, sourceCountR, voiceR, newItemsR, draftsInProgressR, sentThisMonthR } = rows;
  const connectedOutlets = outletsR.rows
    .filter((row) => Number(row.connected ?? 0) === 1)
    .map((row) => ({
      id: String(row.id),
      baseUrl: String(row.base_url),
      displayName: row.display_name ? String(row.display_name) : null,
      isDefault: Number(row.is_default ?? 0) === 1,
    }));
  const profiledOutletIds = new Set(voiceR.rows.map((row) => String(row.outlet_id)));
  const draftableOutlets = connectedOutlets.filter((o) => profiledOutletIds.has(o.id));
  const defaultOutletId =
    draftableOutlets.find((o) => o.isDefault)?.id ?? draftableOutlets[0]?.id ?? null;
  const outletOptions = draftableOutlets.map((o) => ({
    id: o.id,
    displayName: o.displayName ?? o.baseUrl,
  }));

  return {
    userId,
    renderedAt: now,
    hasOutlet: connectedOutlets.length > 0,
    sourceCount: Number(sourceCountR.rows[0]!.n),
    hasDraftableOutlet: draftableOutlets.length > 0,
    stats: {
      newSinceLastVisit: Number(newItemsR.rows[0]?.n ?? 0),
      draftsInProgress: Number(draftsInProgressR.rows[0]?.n ?? 0),
      sentThisMonth: Number(sentThisMonthR.rows[0]?.n ?? 0),
    },
    outletOptions,
    defaultOutletId,
    draftableOutletIds: draftableOutlets.map((o) => o.id),
  };
}

export function needsTodayOnboarding(frame: TodayFrame): boolean {
  return !frame.hasOutlet || frame.sourceCount < 5 || !frame.hasDraftableOutlet;
}

export async function getTodayCacheState(userId: string): Promise<TodayCacheState> {
  await ensureSchema();
  const [cacheR, versionR] = await db.batch(
    [todayCacheStatement(userId), todayVersionStatement(userId)],
    "read",
  );
  const version = versionFromRows(versionR.rows);
  return cacheStateFromRows(cacheR.rows, String(version), true);
}

export async function getTodayCachedViewState(userId: string): Promise<TodayCacheState> {
  await ensureSchema();
  const r = await db.execute(todayCacheStatement(userId));
  return cacheStateFromRows(r.rows, "", false);
}

function cacheStateFromRows(
  rows: ResultSet["rows"],
  expectedInputHash: string,
  compareInputHash: boolean,
): TodayCacheState {
  if (rows.length === 0) {
    return {
      payload: null,
      status: "missing",
      inputHash: expectedInputHash,
      computedAt: null,
      refreshStartedAt: null,
      error: null,
    };
  }

  const row = rows[0]!;
  const payload =
    Number(row.payload_version ?? 0) === TODAY_VIEW_VERSION && row.payload
      ? parsePayload(String(row.payload))
      : null;
  const cachedHash = row.input_hash ? String(row.input_hash) : "";
  const status = payload
    ? compareInputHash
      ? cachedHash === expectedInputHash
        ? "fresh"
        : "stale"
      : cachedHash
        ? "fresh"
        : "stale"
    : "missing";
  return {
    payload,
    status,
    inputHash: expectedInputHash || cachedHash,
    computedAt:
      row.computed_at !== null && row.computed_at !== undefined ? Number(row.computed_at) : null,
    refreshStartedAt:
      row.refresh_started_at !== null && row.refresh_started_at !== undefined
        ? Number(row.refresh_started_at)
        : null,
    error: row.error ? String(row.error) : null,
  };
}

export async function scheduleTodayCacheRefresh(userId: string, state?: TodayCacheState) {
  const current = state ?? (await getTodayCacheState(userId));
  const now = Date.now();
  if (current.refreshStartedAt && now - current.refreshStartedAt < REFRESH_LOCK_MS) return;

  // refreshTodayCacheForUser owns the refresh_started_at marker and the
  // error reset. Writing those here would be re-read by that function's
  // own lock check and cause the scheduled work to bail immediately.
  after(async () => {
    await refreshTodayCacheForUser(userId);
  });
}

export async function refreshTodayCacheForUser(userId: string): Promise<TodayPagePayload | null> {
  await ensureSchema();
  const startedAt = Date.now();
  // Callers can invoke this directly (e.g. startClusterPassAction.after()),
  // so the lock check that scheduleTodayCacheRefresh runs has to also live
  // here. Without it, two background refreshes can race and both pay the
  // full Turso cost for the same payload.
  const existingR = await db.execute({
    sql: `SELECT refresh_started_at FROM view_cache WHERE user_id = ? AND view_key = ?`,
    args: [userId, TODAY_VIEW_KEY],
  });
  const existingStartedAt =
    existingR.rows.length > 0 && existingR.rows[0]!.refresh_started_at !== null
      ? Number(existingR.rows[0]!.refresh_started_at)
      : null;
  if (existingStartedAt !== null && startedAt - existingStartedAt < REFRESH_LOCK_MS) {
    return null;
  }
  try {
    await db.execute({
      sql: `INSERT INTO view_cache
              (user_id, view_key, payload_version, refresh_started_at, error)
            VALUES (?, ?, ?, ?, NULL)
            ON CONFLICT(user_id, view_key) DO UPDATE SET
              payload_version = excluded.payload_version,
              refresh_started_at = excluded.refresh_started_at,
              error = NULL`,
      args: [userId, TODAY_VIEW_KEY, TODAY_VIEW_VERSION, startedAt],
    });

    // Capture the version before any data fetch so a concurrent bump
    // (invalidateTodayCache / markTodayCacheStale) during the build is
    // not silently overwritten as "fresh". The bump will leave
    // user_cache_versions.today_version higher than this captured value,
    // so the next reader sees status="stale" and triggers a re-refresh.
    const version = await getTodayCacheVersion(userId);
    const frame = await loadTodayFrame(userId);
    if (needsTodayOnboarding(frame)) {
      await db.execute({
        sql: `UPDATE view_cache
              SET payload = NULL, input_hash = ?, computed_at = ?, refresh_started_at = NULL, error = NULL
              WHERE user_id = ? AND view_key = ?`,
        args: [String(version), Date.now(), userId, TODAY_VIEW_KEY],
      });
      safeRevalidateToday();
      return null;
    }

    const ready = await buildTodayReadyPayload(frame);
    const payload: TodayPagePayload = { frame, ready };
    await db.execute({
      sql: `UPDATE view_cache
            SET payload = ?, payload_version = ?, input_hash = ?, computed_at = ?,
                refresh_started_at = NULL, error = NULL
            WHERE user_id = ? AND view_key = ?`,
      args: [
        JSON.stringify(payload),
        TODAY_VIEW_VERSION,
        String(version),
        Date.now(),
        userId,
        TODAY_VIEW_KEY,
      ],
    });
    safeRevalidateToday();
    return payload;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.execute({
      sql: `UPDATE view_cache SET refresh_started_at = NULL, error = ?
            WHERE user_id = ? AND view_key = ?`,
      args: [message, userId, TODAY_VIEW_KEY],
    });
    console.warn(`today cache refresh failed: ${message}`);
    return null;
  }
}

export async function invalidateTodayCache(userId: string): Promise<void> {
  await ensureSchema();
  await bumpTodayCacheVersion(userId);
}

export async function markTodayCacheStale(userId: string): Promise<void> {
  await bumpTodayCacheVersion(userId);
}

async function getTodayCacheVersion(userId: string): Promise<number> {
  const r = await db.execute(todayVersionStatement(userId));
  return versionFromRows(r.rows);
}

function todayVersionStatement(userId: string) {
  return {
    sql: `SELECT today_version FROM user_cache_versions WHERE user_id = ?`,
    args: [userId],
  };
}

function versionFromRows(rows: ResultSet["rows"]): number {
  return Number(rows[0]?.today_version ?? 0);
}

async function bumpTodayCacheVersion(userId: string): Promise<void> {
  const now = Date.now();
  await db.batch(
    [
      {
        sql: `INSERT INTO user_cache_versions (user_id, today_version, updated_at)
              VALUES (?, 1, ?)
              ON CONFLICT(user_id) DO UPDATE SET
                today_version = today_version + 1,
                updated_at = excluded.updated_at`,
        args: [userId, now],
      },
      {
        sql: `UPDATE view_cache
              SET input_hash = NULL
              WHERE user_id = ? AND view_key = ?`,
        args: [userId, TODAY_VIEW_KEY],
      },
    ],
    "write",
  );
}

export async function deleteTodayCache(userId: string): Promise<void> {
  await ensureSchema();
  await db.execute({
    sql: `DELETE FROM view_cache WHERE user_id = ? AND view_key = ?`,
    args: [userId, TODAY_VIEW_KEY],
  });
}

async function buildTodayReadyPayload(frame: TodayFrame): Promise<TodayReadyPayload> {
  const folderRows = await db.execute({
    sql: `SELECT id, name FROM source_folders
          WHERE user_id = ? ORDER BY sort_order ASC, name ASC`,
    args: [frame.userId],
  });
  const folders = folderRows.rows.map((row) => ({
    id: String(row.id),
    name: String(row.name),
  }));

  const clustersByFolder = await listTodayClustersByFolder(frame.userId);
  const signatureTermsByOutlet = await loadSignatureTermsByOutlet(
    frame.draftableOutletIds,
    frame.userId,
  );

  const distinctClusters = new Map<string, TodayClusterCandidate>();
  for (const list of clustersByFolder.values()) {
    for (const c of list) if (!distinctClusters.has(c.id)) distinctClusters.set(c.id, c);
  }

  const previewsById = new Map<string, TodayClusterPreview>();
  const previewData = await loadTodayPreviewData(frame.userId, Array.from(distinctClusters.keys()));
  for (const c of distinctClusters.values()) {
    const preview = buildClusterPreview(
      c,
      frame.draftableOutletIds,
      signatureTermsByOutlet,
      previewData,
    );
    previewsById.set(c.id, preview);
  }

  const streams: TodayFolderStream[] = folders.map((folder) => {
    const clusters = clustersByFolder.get(folder.id) ?? [];
    const previews = clusters.map((c) => ({
      ...previewsById.get(c.id)!,
      folder: { id: folder.id, name: folder.name },
    }));
    return { id: folder.id, folderId: folder.id, name: folder.name, clusters: previews };
  });

  const totalPreviews = distinctClusters.size;
  return {
    streams,
    totalPreviews,
    streamsWithContent: streams.filter((s) => s.clusters.length > 0).length,
    emptyClusterStats: totalPreviews === 0 ? await loadEmptyClusterStats(frame.userId) : null,
  };
}

function buildClusterPreview(
  c: TodayClusterCandidate,
  draftableOutletIds: string[],
  signatureTermsByOutlet: Map<string, Set<string>>,
  previewData: Awaited<ReturnType<typeof loadTodayPreviewData>>,
): TodayClusterPreview {
  const entitySet = new Set<string>();
  for (const e of c.primaryEntities ?? []) entitySet.add(e.toLowerCase());
  const previewItems = previewData.itemsByCluster.get(c.id) ?? [];
  for (const row of previewItems) {
    if (!row.entities) continue;
    for (const e of row.entities) entitySet.add(e.toLowerCase());
  }
  const preferredOutletId = pickPreferredOutletForCluster(
    Array.from(entitySet),
    draftableOutletIds,
    signatureTermsByOutlet,
  );
  const items = previewItems.map(({ title, sourceId, sourceUrl, displayName }) => ({
    title,
    sourceId,
    sourceUrl,
    displayName,
  }));
  return {
    cluster: {
      id: c.id,
      formedAt: c.formedAt,
      firedAt: c.firedAt,
      latestPublishedAt: c.latestPublishedAt,
      sourceCount: c.sourceCount,
      signals: c.signals
        ? {
            archiveOverlap: c.signals.archiveOverlap,
            beatMatch: c.signals.beatMatch,
            sourceTrust: c.signals.sourceTrust,
            composite: c.signals.composite,
          }
        : null,
    },
    folder: { id: "", name: "" },
    items,
    draftsByOutlet: previewData.draftsByCluster.get(c.id) ?? {},
    preferredOutletId,
  };
}

async function loadTodayPreviewData(
  userId: string,
  clusterIds: string[],
): Promise<{
  itemsByCluster: Map<string, TodayPreviewItem[]>;
  draftsByCluster: Map<string, TodayDraftsByOutlet>;
}> {
  const itemsByCluster = new Map<string, TodayPreviewItem[]>();
  const draftsByCluster = new Map<string, TodayDraftsByOutlet>();
  if (clusterIds.length === 0) return { itemsByCluster, draftsByCluster };

  const placeholders = clusterIds.map(() => "?").join(",");
  const [itemsR, draftsR] = await Promise.all([
    db.execute({
      sql: `WITH ranked_items AS (
              SELECT i.cluster_id, i.title, i.entities,
                     s.id AS source_id, s.url AS source_url, s.display_name,
                     ROW_NUMBER() OVER (
                       PARTITION BY i.cluster_id
                       ORDER BY i.published_at DESC
                     ) AS rn
              FROM items i
              JOIN sources s ON s.id = i.source_id
              WHERE i.user_id = ? AND i.cluster_id IN (${placeholders})
            )
            SELECT cluster_id, title, entities, source_id, source_url, display_name
            FROM ranked_items
            WHERE rn <= 8
            ORDER BY cluster_id, rn`,
      args: [userId, ...clusterIds],
    }),
    db.execute({
      sql: `SELECT cluster_id, id, outlet_id, mode, voice_match_score, wp_edit_link
            FROM drafts
            WHERE user_id = ? AND cluster_id IN (${placeholders})
            ORDER BY cluster_id, created_at DESC`,
      args: [userId, ...clusterIds],
    }),
  ]);

  for (const row of itemsR.rows) {
    const clusterId = String(row.cluster_id);
    const list = itemsByCluster.get(clusterId) ?? [];
    let entities: string[] | null = null;
    if (row.entities) {
      try {
        const parsed = JSON.parse(String(row.entities)) as unknown;
        if (Array.isArray(parsed)) {
          entities = parsed.filter((entity): entity is string => typeof entity === "string");
        }
      } catch {
        entities = null;
      }
    }
    list.push({
      title: String(row.title),
      sourceId: String(row.source_id),
      sourceUrl: String(row.source_url),
      displayName: String(row.display_name ?? ""),
      entities,
    });
    itemsByCluster.set(clusterId, list);
  }

  for (const row of draftsR.rows) {
    const clusterId = String(row.cluster_id);
    const outletId = row.outlet_id ? String(row.outlet_id) : "";
    if (!outletId) continue;
    const mode = String(row.mode ?? "drafter") === "researcher" ? "researcher" : "drafter";
    const draftsByOutlet = draftsByCluster.get(clusterId) ?? {};
    const bucket = draftsByOutlet[outletId] ?? { drafter: null, researcher: null };
    if (!bucket[mode]) {
      bucket[mode] = {
        id: String(row.id),
        voiceMatch: Number(row.voice_match_score ?? 0),
        wpEditLink: row.wp_edit_link ? String(row.wp_edit_link) : null,
      };
    }
    draftsByOutlet[outletId] = bucket;
    draftsByCluster.set(clusterId, draftsByOutlet);
  }

  return { itemsByCluster, draftsByCluster };
}

async function listTodayClustersByFolder(
  userId: string,
): Promise<Map<string, TodayClusterCandidate[]>> {
  const freshnessCutoff = Date.now() - TODAY_CLUSTER_WINDOW_MS;
  const r = await db.execute({
    sql: `WITH recent_item_clusters AS (
            SELECT DISTINCT cluster_id AS id
            FROM items
            WHERE user_id = ?
              AND cluster_id IS NOT NULL
              AND published_at >= ?
          ),
          recent_formed_clusters AS (
            SELECT id
            FROM clusters
            WHERE user_id = ? AND state = 'fired' AND formed_at >= ?
          ),
          candidate_ids AS (
            SELECT id FROM recent_item_clusters
            UNION
            SELECT id FROM recent_formed_clusters
          ),
          user_clusters AS (
            SELECT c.id, c.formed_at, c.fired_at, c.source_count, c.primary_entities
            FROM clusters c
            JOIN candidate_ids candidate ON candidate.id = c.id
            WHERE c.user_id = ? AND c.state = 'fired'
          ),
          latest_per_cluster AS (
            SELECT i.cluster_id, MAX(i.published_at) AS latest_published_at
            FROM items i
            JOIN user_clusters uc ON uc.id = i.cluster_id
            GROUP BY i.cluster_id
          ),
          cluster_folders AS (
            SELECT DISTINCT i.cluster_id AS cid, sfa.folder_id AS fid
            FROM items i
            JOIN sources s ON s.id = i.source_id
            JOIN source_folder_assignments sfa ON sfa.source_id = s.id AND sfa.user_id = s.user_id
            JOIN user_clusters uc ON uc.id = i.cluster_id
            UNION
            SELECT DISTINCT i.cluster_id AS cid, s.folder_id AS fid
            FROM items i
            JOIN sources s ON s.id = i.source_id
            JOIN user_clusters uc ON uc.id = i.cluster_id
            WHERE s.folder_id IS NOT NULL
              AND NOT EXISTS (
                SELECT 1 FROM source_folder_assignments sfa
                WHERE sfa.source_id = s.id AND sfa.user_id = s.user_id
              )
          ),
          ranked AS (
            SELECT uc.id, uc.formed_at, uc.fired_at, uc.source_count, uc.primary_entities,
                   rs.archive_overlap, rs.beat_match, rs.source_trust, rs.composite,
                   latest.latest_published_at,
                   cf.fid AS folder_id,
                   ROW_NUMBER() OVER (
                     PARTITION BY cf.fid
                     ORDER BY COALESCE(rs.composite, 0) DESC,
                              COALESCE(latest.latest_published_at, uc.formed_at) DESC,
                              uc.fired_at DESC
                   ) AS rn
            FROM user_clusters uc
            JOIN cluster_folders cf ON cf.cid = uc.id
            LEFT JOIN ranker_signals rs ON rs.cluster_id = uc.id AND rs.user_id = ?
            LEFT JOIN latest_per_cluster latest ON latest.cluster_id = uc.id
            WHERE COALESCE(latest.latest_published_at, uc.formed_at) >= ?
          )
          SELECT id, formed_at, fired_at, source_count, primary_entities,
                 archive_overlap, beat_match, source_trust, composite,
                 latest_published_at, folder_id
          FROM ranked
          WHERE rn <= ?
          ORDER BY folder_id, rn`,
    args: [
      userId,
      freshnessCutoff,
      userId,
      freshnessCutoff,
      userId,
      userId,
      freshnessCutoff,
      PER_FOLDER_LIMIT,
    ],
  });
  const byFolder = new Map<string, TodayClusterCandidate[]>();
  for (const row of r.rows) {
    const folderId = String(row.folder_id);
    const candidate: TodayClusterCandidate = {
      id: String(row.id),
      formedAt: Number(row.formed_at),
      firedAt: row.fired_at ? Number(row.fired_at) : null,
      primaryEntities: parseStringArray(row.primary_entities),
      sourceCount: Number(row.source_count),
      latestPublishedAt:
        row.latest_published_at !== null && row.latest_published_at !== undefined
          ? Number(row.latest_published_at)
          : Number(row.formed_at),
      signals:
        row.composite !== null && row.composite !== undefined
          ? {
              archiveOverlap: Number(row.archive_overlap),
              beatMatch: Number(row.beat_match),
              sourceTrust: Number(row.source_trust),
              composite: Number(row.composite),
            }
          : null,
    };
    const list = byFolder.get(folderId);
    if (list) list.push(candidate);
    else byFolder.set(folderId, [candidate]);
  }
  return byFolder;
}

async function loadEmptyClusterStats(
  userId: string,
): Promise<{ polledSourceCount: number; itemsTotal: number; itemsTotalCapped: boolean }> {
  const r = await db.execute({
    sql: `SELECT
            (SELECT COUNT(*) FROM sources
              WHERE user_id = ? AND active = 1 AND last_polled_at IS NOT NULL) AS polled,
            (SELECT COUNT(*) FROM (
              SELECT 1 FROM items WHERE user_id = ? LIMIT 1001
            )) AS items_total`,
    args: [userId, userId],
  });
  const cappedTotal = Number(r.rows[0]?.items_total ?? 0);
  return {
    polledSourceCount: Number(r.rows[0]?.polled ?? 0),
    itemsTotal: Math.min(cappedTotal, 1000),
    itemsTotalCapped: cappedTotal > 1000,
  };
}

function parsePayload(raw: string): TodayPagePayload | null {
  try {
    const parsed = JSON.parse(raw) as Partial<TodayPagePayload>;
    if (!parsed || !parsed.frame || !parsed.ready) return null;
    if (!Array.isArray(parsed.ready.streams)) return null;
    return parsed as TodayPagePayload;
  } catch {
    return null;
  }
}

function safeRevalidateToday(): void {
  try {
    revalidatePath("/");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!message.includes("static generation store missing")) throw err;
  }
}

function parseStringArray(value: unknown): string[] | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(String(value)) as unknown;
    if (!Array.isArray(parsed)) return null;
    return parsed.filter((item): item is string => typeof item === "string");
  } catch {
    return null;
  }
}
