/**
 * Today screen.
 *
 * Empty-state is a guided 3-step hero. Populated state is editorial cluster
 * cards with a typeset headline and a trust-strip footer.
 */

import Link from "next/link";
import { ensureSchema, db } from "@/lib/db";
import { redirect } from "next/navigation";
import { AuthRequiredError, requireSession } from "@/lib/session";
import { ensureRegisteredCapabilities } from "@/lib/v1/bootstrap";
import { listOutlets } from "@/lib/v1/outlets";
import { loadSignatureTermsByOutlet, pickPreferredOutletForCluster } from "@/lib/v1/ranker";
import {
  TodayFolderStreams,
  type TodayClusterPreview,
  type TodayFolderStream,
} from "./_components/TodayFolderStreams";
import { TopicSearch } from "./_components/TopicSearch/TopicSearch";
import { PollAllButton } from "./sources/_components/PollAllButton";
import { TodayStats } from "./_components/TodayStats";
import { LookForClustersButton } from "./_components/LookForClustersButton";

export const dynamic = "force-dynamic";

// Finder-column layout shows the full content of the selected folder in
// the right pane and the user scrolls the page. Today should stay fresh;
// older clusters remain reachable through history-specific surfaces.
const TODAY_CLUSTER_WINDOW_MS = 60 * 60 * 60 * 1000;

// Per-folder cap is defense in depth so a feed surge can't render
// thousands of cards.
const PER_FOLDER_LIMIT = 50;

type TodayClusterCandidate = TodayClusterPreview["cluster"] & {
  primaryEntities: string[] | null;
};

type TodayPreviewItem = TodayClusterPreview["items"][number] & {
  entities: string[] | null;
};

type TodayDraftsByOutlet = TodayClusterPreview["draftsByOutlet"];

export default async function TodayPage() {
  await ensureSchema();
  let session;
  try {
    session = await requireSession();
  } catch (err) {
    if (err instanceof AuthRequiredError) redirect("/login");
    throw err;
  }
  await ensureRegisteredCapabilities();

  const outlets = await listOutlets(session.userId);
  const connectedOutlets = outlets.filter((o) => o.connected);
  const hasOutlet = connectedOutlets.length > 0;

  const sourceCountR = await db.execute({
    sql: `SELECT COUNT(*) AS n FROM sources
          WHERE user_id = ? AND active = 1
            AND (paused_until IS NULL OR paused_until <= ?)`,
    args: [session.userId, Date.now()],
  });
  const sourceCount = Number(sourceCountR.rows[0]!.n);

  const voiceR = await db.execute({
    sql: `SELECT outlet_id FROM voice_profiles WHERE user_id = ?`,
    args: [session.userId],
  });
  const profiledOutletIds = new Set(voiceR.rows.map((row) => String(row.outlet_id)));

  // Picker only offers outlets that are both connected AND have a voice
  // profile. Without a profile, the draft generator falls back to a generic
  // style sheet, breaking the "voice-matched draft" promise. Without a
  // connection, the WP publish step has nothing to push to. A profile from
  // a since-disconnected outlet is preserved on disk for reconnect, but
  // doesn't count as draftable until that outlet is connected again.
  const draftableOutlets = connectedOutlets.filter((o) => profiledOutletIds.has(o.id));
  const hasDraftableOutlet = draftableOutlets.length > 0;
  const defaultOutletId =
    draftableOutlets.find((o) => o.isDefault)?.id ?? draftableOutlets[0]?.id ?? null;
  const outletOptions = draftableOutlets.map((o) => ({
    id: o.id,
    displayName: o.displayName ?? o.baseUrl,
  }));

  const now = Date.now();
  const last24h = now - 24 * 60 * 60 * 1000;
  const monthStart = new Date(new Date(now).getFullYear(), new Date(now).getMonth(), 1).getTime();

  const [newItemsR, draftsInProgressR, sentThisMonthR] = await Promise.all([
    db.execute({
      sql: `SELECT COUNT(*) AS n FROM items WHERE user_id = ? AND fetched_at > ?`,
      args: [session.userId, last24h],
    }),
    db.execute({
      sql: `SELECT COUNT(*) AS n FROM drafts WHERE user_id = ? AND wp_synced_at IS NULL`,
      args: [session.userId],
    }),
    db.execute({
      sql: `SELECT COUNT(*) AS n FROM drafts WHERE user_id = ? AND wp_synced_at IS NOT NULL AND wp_synced_at > ?`,
      args: [session.userId, monthStart],
    }),
  ]);

  const newSinceLastVisit = Number(newItemsR.rows[0]?.n ?? 0);
  const draftsInProgress = Number(draftsInProgressR.rows[0]?.n ?? 0);
  const sentThisMonth = Number(sentThisMonthR.rows[0]?.n ?? 0);

  if (!hasOutlet || sourceCount < 5 || !hasDraftableOutlet) {
    return (
      <Onboarding hasSite={hasOutlet} sourceCount={sourceCount} hasVoice={hasDraftableOutlet} />
    );
  }

  // Today is a per-folder surface: each folder is a reading lane. A cluster
  // surfaces in every lane it touches; the per-folder cap keeps any single
  // lane bounded. Ungrouped is intentionally excluded; a lane with no shape
  // isn't a writing brief.
  const folderRows = await db.execute({
    sql: `SELECT id, name FROM source_folders
          WHERE user_id = ? ORDER BY sort_order ASC, name ASC`,
    args: [session.userId],
  });
  const folders = folderRows.rows.map((row) => ({
    id: String(row.id),
    name: String(row.name),
  }));

  // A cluster can have items from sources in multiple folders. Show it in
  // every folder it touches so a quieter folder still surfaces clusters it
  // contributed to, even when a noisier folder contributed more items. The
  // per-folder cap of PER_FOLDER_LIMIT keeps each lane bounded, so the
  // result set is still bounded at folders.length * PER_FOLDER_LIMIT.
  const clustersByFolder = await listTodayClustersByFolder(session.userId);

  const draftableOutletIds = draftableOutlets.map((o) => o.id);
  const signatureTermsByOutlet = await loadSignatureTermsByOutlet(
    draftableOutletIds,
    session.userId,
  );

  // Build each preview once per distinct cluster (a cluster may appear in
  // multiple folders); attach the folder ref per-stream when composing.
  const distinctClusters = new Map<string, TodayClusterCandidate>();
  for (const list of clustersByFolder.values()) {
    for (const c of list) if (!distinctClusters.has(c.id)) distinctClusters.set(c.id, c);
  }
  const previewsById = new Map<string, TodayClusterPreview>();
  const previewData = await loadTodayPreviewData(
    session.userId,
    Array.from(distinctClusters.keys()),
  );
  for (const c of distinctClusters.values()) {
    const preview = buildClusterPreview(c, draftableOutletIds, signatureTermsByOutlet, previewData);
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

  // Folders render in the user's declared order (sort_order ASC, name ASC),
  // already applied by the folders query. Lanes stay put on dismiss/refresh
  // so "Not now" never causes a folder to slide.
  const totalPreviews = distinctClusters.size;
  const streamsWithContent = streams.filter((s) => s.clusters.length > 0).length;
  const emptyClusterStats =
    totalPreviews === 0 ? await loadEmptyClusterStats(session.userId) : null;

  return (
    <div className="space-y-8">
      <header className="space-y-1.5">
        <div className="fp-eyebrow">{formatDate(Date.now())}</div>
        <h1 className="fp-h1 fp-h1-serif">
          {totalPreviews === 0
            ? "No clusters yet"
            : totalPreviews === 1
              ? "One cluster worth your attention"
              : `${totalPreviews} clusters across ${streamsWithContent} ${
                  streamsWithContent === 1 ? "stream" : "streams"
                }`}
        </h1>
        <p className="text-sm" style={{ color: "var(--fg-muted)" }}>
          Each folder is a reading lane. Open the strongest cluster, ask for more, or set that lane
          aside for now.
        </p>
      </header>

      <TodayStats
        newSinceLastVisit={newSinceLastVisit}
        draftsInProgress={draftsInProgress}
        sentThisMonth={sentThisMonth}
      />

      <div className="flex items-center gap-3">
        <LookForClustersButton />
      </div>

      <TopicSearch outlets={outletOptions} defaultOutletId={defaultOutletId}>
        {totalPreviews === 0 ? (
          <EmptyClusters
            polledSourceCount={emptyClusterStats!.polledSourceCount}
            itemsTotal={emptyClusterStats!.itemsTotal}
            itemsTotalCapped={emptyClusterStats!.itemsTotalCapped}
          />
        ) : (
          <TodayFolderStreams
            streams={streams}
            outlets={outletOptions}
            defaultOutletId={defaultOutletId}
          />
        )}
      </TopicSearch>
    </div>
  );
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

/**
 * Top fired clusters per folder for the Today surface. A cluster is
 * surfaced in every folder it has items in, so a quieter folder still
 * sees the cluster it contributed to even when a noisier folder
 * contributed more items. Per-folder ranking and the PER_FOLDER_LIMIT
 * cap are applied via ROW_NUMBER(), so the result set is bounded at
 * folders.length * PER_FOLDER_LIMIT regardless of how many clusters
 * live in the freshness window. Sources without a folder still don't
 * appear on Today; an ungrouped item is not a reading lane.
 */
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
            SELECT DISTINCT i.cluster_id AS cid, s.folder_id AS fid
            FROM items i
            JOIN sources s ON s.id = i.source_id
            JOIN user_clusters uc ON uc.id = i.cluster_id
            WHERE s.folder_id IS NOT NULL
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
      primaryEntities: row.primary_entities
        ? (JSON.parse(String(row.primary_entities)) as string[])
        : null,
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

function EmptyClusters({
  polledSourceCount,
  itemsTotal,
  itemsTotalCapped,
}: {
  polledSourceCount: number;
  itemsTotal: number;
  itemsTotalCapped: boolean;
}) {
  // Three distinct waiting states. Each gets one action so the user is
  // never asked to pick between "manage" and "publish" in a moment that
  // is just about getting the first cluster on screen.
  const stage =
    polledSourceCount === 0 ? "first-poll" : itemsTotal === 0 ? "no-items" : "no-cluster-yet";

  const copy = {
    "first-poll": {
      title: "Polling your feeds for the first time.",
      body: "Items appear as the first fetch completes. A cluster fires when 3 sources converge on the same story within 72 hours.",
    },
    "no-items": {
      title: "Polls done. No items came back yet.",
      body: "A few sources may be returning errors. Open the source list to see which feeds are stuck.",
    },
    "no-cluster-yet": {
      title: `${formatItemCount(itemsTotal, itemsTotalCapped)} ${
        itemsTotal === 1 && !itemsTotalCapped ? "item" : "items"
      } in. No cluster yet.`,
      body: "A cluster fires when 3 sources cover the same story within 72 hours, from at least 2 distinct domains. Add another feed in this beat to bring convergence forward.",
    },
  }[stage];

  return (
    <div className="fp-card-feature p-10 text-center" style={{ background: "var(--surface)" }}>
      <div
        className="mx-auto mb-4 inline-flex h-12 w-12 items-center justify-center rounded-2xl"
        style={{ background: "var(--indigo-tint)" }}
      >
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="var(--indigo)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.3-4.3" />
        </svg>
      </div>
      <h2 className="fp-h1-serif" style={{ fontSize: 22 }}>
        {copy.title}
      </h2>
      <p className="mx-auto mt-2 max-w-md text-sm" style={{ color: "var(--fg-muted)" }}>
        {copy.body}
      </p>
      <div className="mt-5 flex justify-center">
        {stage === "first-poll" ? (
          <PollAllButton />
        ) : (
          <Link href="/sources" className="fp-btn fp-btn-primary">
            {stage === "no-items" ? "Open sources →" : "Add a source →"}
          </Link>
        )}
      </div>
    </div>
  );
}

function formatItemCount(itemsTotal: number, capped: boolean): string {
  if (capped) return "1,000+";
  return new Intl.NumberFormat("en-US").format(itemsTotal);
}

function Onboarding({
  hasSite,
  sourceCount,
  hasVoice,
}: {
  hasSite: boolean;
  sourceCount: number;
  hasVoice: boolean;
}) {
  type GuideStep = {
    id: number;
    shortLabel: string;
    title: string;
    blurb: string;
    detail: string;
    cta: string;
    href: string;
    icon: () => React.ReactElement;
    done: boolean;
  };

  const steps: GuideStep[] = [
    {
      id: 1,
      shortLabel: "Connect",
      title: "Connect your WordPress",
      blurb:
        "One click, no copy-pasting passwords. Your site's authorize page opens; you click Approve; we get an Application Password back.",
      detail:
        "We never see your login. Drafts always land as drafts; nothing publishes without you clicking the button.",
      cta: hasSite ? "Manage outlets" : "Connect WordPress",
      href: "/voice",
      icon: ConnectIcon,
      done: hasSite,
    },
    {
      id: 2,
      shortLabel: "Voice",
      title: "Train your voice",
      blurb:
        "Your last 50 published posts get pulled and turned into a stylometric fingerprint. Sentence rhythm, signature terms, banned vocabulary, decay-weighted by recency.",
      detail:
        "Drafts are voice-matched against this profile. Edit it any time and re-train after a stylistic shift.",
      cta: hasVoice ? "Review profile" : "Build voice profile",
      href: "/voice",
      icon: VoiceIcon,
      done: hasVoice,
    },
    {
      id: 3,
      shortLabel: "Sources",
      title: "Plug in your sources",
      blurb:
        "Bring 5 or more feeds in your niche. RSS, newsletters, Reddit, podcasts, YouTube. We poll continuously and group items into clusters when 3+ feeds converge on the same story within 72 hours.",
      detail:
        sourceCount >= 5
          ? `${sourceCount} added. Polish folders, prune sources, or import an OPML file.`
          : `${sourceCount} of 5 added. Use a starter pack for a fast start, paste URLs by hand, or import an OPML from your existing reader.`,
      cta: sourceCount >= 5 ? "Manage sources" : "Add sources",
      href: "/sources",
      icon: SourceIcon,
      done: sourceCount >= 5,
    },
  ];

  const currentStep = steps.find((s) => !s.done) ?? steps[steps.length - 1]!;
  const completed = steps.filter((s) => s.done).length;
  const progress = (completed / steps.length) * 100;
  const upcoming = steps.filter((s) => !s.done && s.id !== currentStep.id);
  const FocusIcon = currentStep.icon;

  return (
    <div className="space-y-8">
      {/* Hero */}
      <header className="space-y-3">
        <div className="fp-eyebrow">Welcome to FlavorPress</div>
        <h1 className="fp-h1 fp-h1-serif" style={{ maxWidth: "18ch" }}>
          Your reading turns into your writing.
        </h1>
        <p className="max-w-xl text-base leading-relaxed" style={{ color: "var(--fg-muted)" }}>
          Three steps from a blank slate to your first draft. Connect a WordPress site, train the
          voice, plug in the feeds you already read. Clusters surface when those feeds converge; you
          choose which to draft.
        </p>
      </header>

      {/* Progress strip with step labels */}
      <div className="fp-card p-5">
        <div className="flex items-center justify-between text-sm">
          <span className="font-medium">Welcome guide</span>
          <span className="tabular" style={{ color: "var(--fg-muted)" }}>
            {completed} of {steps.length} done
          </span>
        </div>
        <div
          className="mt-3 h-1.5 overflow-hidden rounded-full"
          style={{ background: "var(--border)" }}
        >
          <div
            className="h-full rounded-full transition-all"
            style={{
              width: `${progress}%`,
              background: "linear-gradient(90deg, var(--indigo) 0%, var(--rose) 100%)",
              transitionDuration: "400ms",
            }}
          />
        </div>
        <ol className="mt-3 grid grid-cols-3 gap-2 text-xs">
          {steps.map((s) => {
            const isCurrent = s.id === currentStep.id;
            const tone = s.done
              ? "var(--emerald)"
              : isCurrent
                ? "var(--indigo)"
                : "var(--fg-subtle)";
            return (
              <li key={s.id} className="flex items-center gap-1.5" style={{ color: tone }}>
                <span
                  className="inline-flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-semibold tabular"
                  style={{
                    background: s.done
                      ? "var(--emerald-tint)"
                      : isCurrent
                        ? "var(--indigo)"
                        : "var(--bg-subtle)",
                    color: s.done ? "var(--emerald)" : isCurrent ? "#fff" : "var(--fg-subtle)",
                  }}
                >
                  {s.done ? "✓" : s.id}
                </span>
                <span className={isCurrent ? "font-medium" : ""}>{s.shortLabel}</span>
              </li>
            );
          })}
        </ol>
      </div>

      {/* Focus card — the one step the user should do next */}
      <div className="fp-card-feature p-7 md:p-9">
        <div className="grid gap-6 md:grid-cols-[auto_1fr] items-start">
          <div
            className="inline-flex h-14 w-14 items-center justify-center rounded-2xl shrink-0"
            style={{
              background: "var(--indigo)",
              color: "#fff",
            }}
          >
            <FocusIcon />
          </div>
          <div>
            <div className="fp-eyebrow">
              Step {currentStep.id} of {steps.length}
            </div>
            <h2 className="fp-h1-serif mt-2" style={{ fontSize: 26, lineHeight: 1.15 }}>
              {currentStep.title}
            </h2>
            <p className="mt-3 max-w-2xl text-base leading-relaxed">{currentStep.blurb}</p>
            <p className="mt-2 max-w-2xl text-sm" style={{ color: "rgba(0,0,0,0.62)" }}>
              {currentStep.detail}
            </p>
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <Link href={currentStep.href} className="fp-btn fp-btn-primary">
                {currentStep.cta} →
              </Link>
              <span className="text-xs" style={{ color: "rgba(0,0,0,0.55)" }}>
                Takes about a minute.
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Up next — muted previews of remaining steps */}
      {upcoming.length > 0 ? (
        <section className="space-y-3">
          <div className="fp-eyebrow">Up next</div>
          <div className="grid gap-3 md:grid-cols-2">
            {upcoming.map((s) => {
              const Icon = s.icon;
              return (
                <div
                  key={s.id}
                  className="fp-card p-5 flex items-start gap-3"
                  style={{ opacity: 0.78 }}
                >
                  <div
                    className="inline-flex h-9 w-9 items-center justify-center rounded-lg shrink-0"
                    style={{
                      background: "var(--bg-subtle)",
                      color: "var(--fg-muted)",
                    }}
                  >
                    <Icon />
                  </div>
                  <div>
                    <div className="text-xs tabular" style={{ color: "var(--fg-subtle)" }}>
                      Step {s.id}
                    </div>
                    <div className="mt-0.5 text-sm font-medium">{s.title}</div>
                    <div
                      className="mt-1 text-xs leading-relaxed"
                      style={{ color: "var(--fg-muted)" }}
                    >
                      {s.blurb}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      {/* What happens once the guide is done */}
      <div className="fp-card p-6">
        <div className="fp-eyebrow mb-3">After the guide</div>
        <div className="grid gap-4 md:grid-cols-3">
          <Step
            number="1"
            label="Sources poll continuously"
            detail="RSS / Reddit every 5 min; podcasts and YouTube every hour."
          />
          <Step
            number="2"
            label="Cluster engine fires"
            detail="3+ sources covering the same story within 72h triggers a cluster."
          />
          <Step
            number="3"
            label="You draft from a cluster"
            detail="Tap into any cluster to draft from it; voice-matched, fact-checked, your call to publish."
          />
        </div>
      </div>
    </div>
  );
}

function Step({ number, label, detail }: { number: string; label: string; detail: string }) {
  return (
    <div>
      <div
        className="inline-flex h-7 w-7 items-center justify-center rounded-md text-xs font-semibold tabular"
        style={{
          background: "var(--surface)",
          color: "var(--indigo)",
          border: "1px solid var(--border)",
        }}
      >
        {number}
      </div>
      <div className="mt-2 text-sm font-medium">{label}</div>
      <div className="mt-1 text-xs" style={{ color: "var(--fg-muted)" }}>
        {detail}
      </div>
    </div>
  );
}

function ConnectIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  );
}
function VoiceIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="22" />
    </svg>
  );
}
function SourceIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 11a9 9 0 0 1 9 9" />
      <path d="M4 4a16 16 0 0 1 16 16" />
      <circle cx="5" cy="19" r="1" />
    </svg>
  );
}
function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}
