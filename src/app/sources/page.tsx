/**
 * Sources view. RSS-only (the input from "the world").
 *
 * WordPress connection lives on /voice; sources are not the publish
 * destination, they're what you read.
 *
 * Folders are the primary grouping for reading scope: pick one to filter
 * the list, poll just those feeds, or browse "All". Sources can be moved
 * one at a time via a per-row picker, or in bulk via the selection bar
 * that appears when checkboxes are ticked.
 */

import Link from "next/link";
import { ensureSchema, ensureSingleUser, SINGLE_USER_ID, db } from "@/lib/db";
import { addSourceAction } from "@/lib/v1/actions";
import { PendingStages, SubmitButton } from "../_components/SubmitButton";
import {
  listOutlets,
  resolveOutletSourceIds,
} from "@/lib/v1/outlets";
import { FolderChipBar } from "./_components/FolderChipBar";
import { SourcesExplorer } from "./_components/SourcesExplorer";
import { PollAllButton } from "./_components/PollAllButton";
import { OpmlImportButton } from "./_components/OpmlImportButton";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ folder?: string; outlet?: string }>;
}

export default async function SourcesPage({ searchParams }: PageProps) {
  await ensureSchema();
  await ensureSingleUser();

  const sp = await searchParams;
  const outletFilter = sp.outlet && sp.outlet !== "all" ? sp.outlet : null;
  const folderParam = sp.folder ?? null;

  const outlets = await listOutlets(SINGLE_USER_ID);

  // If filtering by an outlet, resolve which source IDs are in scope.
  // Outlets with no explicit assignment fall back to all sources. Outlets
  // with explicit assignments still include unassigned default sources, so
  // a default source does not disappear behind an outlet filter.
  const inScopeIds: Set<string> | null = outletFilter
    ? new Set(await resolveOutletSourceIds(SINGLE_USER_ID, outletFilter))
    : null;

  const sourcesR = await db.execute({
    sql: `SELECT s.*,
            (SELECT COUNT(*) FROM items WHERE source_id = s.id) AS item_count,
            (SELECT COUNT(*) FROM items WHERE source_id = s.id AND fetched_at > ?) AS items_24h
          FROM sources s WHERE s.user_id = ? ORDER BY s.created_at DESC`,
    args: [Date.now() - 24 * 60 * 60 * 1000, SINGLE_USER_ID],
  });

  const allRows = sourcesR.rows as unknown as SourceRow[];
  const outletRows = inScopeIds
    ? allRows.filter((r) => inScopeIds.has(String(r.id)))
    : allRows;

  // Folder filter applies on top of outlet filter.
  const visibleRows = applyFolderFilter(outletRows, folderParam);

  const foldersR = await db.execute({
    sql: `SELECT id, name, sort_order, created_at FROM source_folders
          WHERE user_id = ? ORDER BY sort_order ASC, name ASC`,
    args: [SINGLE_USER_ID],
  });
  const folders = foldersR.rows as unknown as FolderRow[];

  const outletDisplayMap = new Map(
    outlets.map((o) => [
      o.id,
      o.displayName ?? hostFromUrl(o.baseUrl),
    ] as const),
  );

  const stats = await db.execute({
    sql: `SELECT
            (SELECT COUNT(*) FROM items WHERE user_id = ?) AS items_total,
            (SELECT COUNT(*) FROM items WHERE user_id = ? AND fetched_at > ?) AS items_24h,
            (SELECT COUNT(*) FROM clusters WHERE user_id = ? AND state = 'fired') AS fired_clusters,
            (SELECT COUNT(*) FROM clusters WHERE user_id = ?) AS clusters_total`,
    args: [
      SINGLE_USER_ID,
      SINGLE_USER_ID,
      Date.now() - 24 * 60 * 60 * 1000,
      SINGLE_USER_ID,
      SINGLE_USER_ID,
    ],
  });

  const isEmpty = allRows.length === 0;
  const filteredEmpty = !isEmpty && visibleRows.length === 0;
  // libSQL row objects are not "plain" enough to cross the server/client
  // boundary; project to a flat shape with just the fields the explorer
  // needs.
  const plainVisibleRows = visibleRows.map((r) => ({
    id: String(r.id),
    kind: String(r.kind),
    url: String(r.url),
    display_name: r.display_name === null ? null : String(r.display_name),
    folder_id: r.folder_id === null ? null : String(r.folder_id),
    trust_score: Number(r.trust_score ?? 0.5),
    last_polled_at:
      r.last_polled_at === null ? null : Number(r.last_polled_at),
    last_error: r.last_error === null ? null : String(r.last_error),
    paused_until:
      r.paused_until === null || r.paused_until === undefined
        ? null
        : Number(r.paused_until),
    item_count: Number(r.item_count ?? 0),
    items_24h: Number(r.items_24h ?? 0),
  }));
  const grouped = groupByFolder(plainVisibleRows, folders);

  // Folder counts are based on the outlet-scoped set so the chip numbers
  // reflect what the user will actually see when they click.
  const folderCounts: Record<string, number> = {};
  for (const f of folders) folderCounts[f.id] = 0;
  let ungroupedCount = 0;
  for (const row of outletRows) {
    if (row.folder_id && folderCounts[row.folder_id] !== undefined) {
      folderCounts[row.folder_id] += 1;
    } else if (!row.folder_id) {
      ungroupedCount += 1;
    }
  }

  const headingScope = (() => {
    if (folderParam === "ungrouped") return "Ungrouped";
    if (folderParam) {
      const f = folders.find((x) => x.id === folderParam);
      if (f) return f.name;
    }
    return null;
  })();

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <div className="text-[11px] uppercase tracking-wider text-stone-500">
            What you read
          </div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">
            Sources · {visibleRows.length}
            {headingScope ? (
              <span
                className="ml-2 text-sm font-normal"
                style={{ color: "var(--fg-muted)" }}
              >
                in {headingScope}
              </span>
            ) : null}
            {outletFilter ? (
              <span
                className="ml-2 text-sm font-normal"
                style={{ color: "var(--fg-muted)" }}
              >
                · outlet {outletDisplayMap.get(outletFilter) ?? "outlet"}
              </span>
            ) : null}
          </h1>
        </div>
        {!isEmpty ? <PollAllButton /> : null}
      </div>

      {/* Outlet filter chips */}
      {outlets.length > 0 && !isEmpty ? (
        <div className="flex items-center gap-2 overflow-x-auto pb-1">
          <span
            className="text-[11px] uppercase tracking-wider"
            style={{ color: "var(--fg-muted)" }}
          >
            Outlet
          </span>
          <Link
            href={sourcesHref(folderParam, null)}
            className={`fp-chip ${
              !outletFilter ? "fp-chip-indigo" : ""
            } transition`}
          >
            All sources
          </Link>
          {outlets.map((o) => {
            const url = sourcesHref(folderParam, o.id);
            const active = outletFilter === o.id;
            const display = o.displayName ?? hostFromUrl(o.baseUrl);
            return (
              <Link
                key={o.id}
                href={url}
                className={`fp-chip ${active ? "fp-chip-indigo" : ""} transition whitespace-nowrap`}
              >
                {display}
              </Link>
            );
          })}
        </div>
      ) : null}

      {/* Folder filter + management */}
      {!isEmpty ? (
        <FolderChipBar
          folders={folders.map((f) => ({ id: f.id, name: f.name }))}
          allCount={outletRows.length}
          ungroupedCount={ungroupedCount}
          folderCounts={folderCounts}
          currentFolder={folderParam}
          outletParam={outletFilter}
        />
      ) : null}

      {/* Add sources */}
      <section className="rounded-2xl border border-stone-200 bg-white p-6">
        <div className="mb-1 flex items-start justify-between gap-3">
          <div>
            <div className="text-sm font-semibold">Add sources</div>
            <div className="text-[11px] text-stone-500">
              RSS / Atom feed URLs, Reddit subreddits, podcast feeds, YouTube
              channel feeds. Paste many; one per line.
            </div>
          </div>
          <OpmlImportButton
            folders={folders.map((f) => ({ id: f.id, name: f.name }))}
            currentFolderId={
              folderParam && folderParam !== "ungrouped" ? folderParam : null
            }
          />
        </div>
        <form action={addSourceAction} className="mt-3 space-y-2">
          <textarea
            name="urls"
            rows={isEmpty ? 5 : 3}
            required
            placeholder={`https://daringfireball.net/feeds/main
https://reddit.com/r/specialtycoffee/.rss
https://hnrss.org/frontpage`}
            className="w-full rounded border border-stone-300 px-3 py-2 font-mono text-xs"
          />
          <div className="flex flex-wrap items-center gap-2">
            <SubmitButton
              className="rounded bg-indigo-600 px-4 py-1.5 text-sm text-white hover:bg-indigo-700"
              pendingLabel="Adding"
            >
              Add
            </SubmitButton>
            <FolderSelect
              folders={folders}
              currentFolderId={
                folderParam && folderParam !== "ungrouped"
                  ? folderParam
                  : null
              }
            />
            <span className="text-[11px] text-stone-500">
              kind auto-detected from URL pattern
            </span>
          </div>
          <PendingStages
            title="Adding sources"
            stages={[
              "Reading pasted feed URLs",
              "Detecting source type",
              "Saving active feeds",
              "Refreshing clusters",
            ]}
          />
        </form>
      </section>

      {/* Empty state with starter packs */}
      {isEmpty ? (
        <section className="space-y-4">
          <div className="text-[11px] uppercase tracking-wider text-stone-500">
            Need a starting roster? Pick a pack to copy and paste above
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <StarterPack
              name="Apple-blogger pack"
              description="MacRumors, 9to5Mac, AppleInsider, Six Colors, Daring Fireball, Apple newsroom."
              urls={[
                "https://9to5mac.com/feed/",
                "https://appleinsider.com/rss/news",
                "https://feeds.macrumors.com/MacRumors-Front",
                "https://daringfireball.net/feeds/main",
                "https://feedpress.me/sixcolors",
                "https://www.apple.com/newsroom/rss-feed.rss",
              ]}
            />
            <StarterPack
              name="Indie tech pack"
              description="Stratechery-adjacent and indie tech writers."
              urls={[
                "https://stratechery.com/feed",
                "https://www.theverge.com/rss/index.xml",
                "https://hnrss.org/frontpage",
                "https://ma.tt/rss",
              ]}
            />
            <StarterPack
              name="Specialty coffee pack"
              description="Sprudge, Daily Coffee News, r/specialtycoffee."
              urls={[
                "https://sprudge.com/feed",
                "https://dailycoffeenews.com/feed",
                "https://reddit.com/r/specialtycoffee/.rss",
              ]}
            />
            <StarterPack
              name="AI ecosystem pack"
              description="Anthropic, OpenAI, Latent Space, Pragmatic Engineer."
              urls={[
                "https://www.anthropic.com/news/rss.xml",
                "https://openai.com/blog/rss.xml",
                "https://www.latent.space/feed",
                "https://newsletter.pragmaticengineer.com/feed",
              ]}
            />
          </div>
          <p className="text-xs text-stone-500">
            Aim for 5+ feeds covering the same beat. Clusters fire when the{" "}
            combined trust of distinct sources crosses 1.0 within 72 hours
            from at least 2 distinct domains. New sources start at 0.5
            trust, so two fresh feeds covering the same story already fire.
          </p>
        </section>
      ) : filteredEmpty ? (
        <div
          className="rounded-xl border border-dashed p-8 text-center text-sm"
          style={{ borderColor: "var(--border)", color: "var(--fg-muted)" }}
        >
          {folderParam ? (
            <>
              No sources here yet.{" "}
              <Link
                href={sourcesHref(null, outletFilter)}
                className="font-medium hover:underline"
                style={{ color: "var(--indigo)" }}
              >
                Show all sources →
              </Link>
            </>
          ) : (
            <>
              No sources assigned to this outlet yet. The outlet currently
              inherits all sources by default.{" "}
              <Link
                href="/sources"
                className="font-medium hover:underline"
                style={{ color: "var(--indigo)" }}
              >
                Show all sources →
              </Link>
            </>
          )}
        </div>
      ) : (
        <SourcesExplorer
          groups={grouped}
          folders={folders.map((f) => ({ id: f.id, name: f.name }))}
        />
      )}

      {/* Diagnostics */}
      {!isEmpty ? (
        <details className="rounded-xl border border-stone-200 bg-white p-4">
          <summary className="cursor-pointer text-xs uppercase tracking-wider text-stone-500 hover:text-stone-700">
            Diagnostics · cluster engine status
          </summary>
          <div className="mt-4 grid grid-cols-4 gap-4 text-xs">
            <Stat label="items / 24h" value={String(stats.rows[0]!.items_24h)} />
            <Stat label="items total" value={String(stats.rows[0]!.items_total)} />
            <Stat
              label="clusters fired"
              value={String(stats.rows[0]!.fired_clusters)}
            />
            <Stat
              label="clusters total"
              value={String(stats.rows[0]!.clusters_total)}
            />
          </div>
        </details>
      ) : null}
    </div>
  );
}

function StarterPack({
  name,
  description,
  urls,
}: {
  name: string;
  description: string;
  urls: string[];
}) {
  return (
    <div className="rounded-2xl border border-stone-200 bg-white p-4 transition hover:shadow-md">
      <div>
        <div className="text-sm font-semibold">{name}</div>
        <div className="mt-0.5 text-[11px] text-stone-500">{description}</div>
      </div>
      <div className="mt-3 max-h-32 overflow-auto rounded bg-stone-50 p-2 font-mono text-[10px] text-stone-600">
        {urls.map((u) => (
          <div key={u}>{u}</div>
        ))}
      </div>
      <details className="mt-2 text-[11px] text-stone-500">
        <summary className="cursor-pointer hover:text-stone-900">
          How to use
        </summary>
        <div className="mt-1 leading-relaxed">
          Copy the list above and paste into the Add sources box.
        </div>
      </details>
    </div>
  );
}

interface SourceRow {
  id: string;
  user_id: string;
  kind: string;
  url: string;
  display_name: string | null;
  folder_id: string | null;
  trust_score: number;
  poll_interval_seconds: number;
  last_polled_at: number | null;
  last_error: string | null;
  paused_until: number | null;
  active: number;
  created_at: number;
  item_count: number;
  items_24h: number;
}

interface FolderRow {
  id: string;
  name: string;
  sort_order: number;
  created_at: number;
}

interface PlainSourceRow {
  id: string;
  kind: string;
  url: string;
  display_name: string | null;
  folder_id: string | null;
  trust_score: number;
  last_polled_at: number | null;
  last_error: string | null;
  paused_until: number | null;
  item_count: number;
  items_24h: number;
}

interface FolderGroup {
  id: string | null;
  name: string;
  rows: PlainSourceRow[];
}

function applyFolderFilter(
  rows: SourceRow[],
  folder: string | null,
): SourceRow[] {
  if (!folder) return rows;
  if (folder === "ungrouped") return rows.filter((r) => !r.folder_id);
  return rows.filter((r) => r.folder_id === folder);
}

function groupByFolder(
  rows: PlainSourceRow[],
  folders: FolderRow[],
): FolderGroup[] {
  const byId = new Map<string, FolderGroup>();
  for (const f of folders) {
    byId.set(f.id, { id: f.id, name: f.name, rows: [] });
  }
  const ungrouped: FolderGroup = { id: null, name: "Ungrouped", rows: [] };
  for (const row of rows) {
    const fid = row.folder_id;
    const g = fid ? byId.get(fid) : null;
    (g ?? ungrouped).rows.push(row);
  }
  const ordered: FolderGroup[] = folders
    .map((f) => byId.get(f.id))
    .filter((g): g is FolderGroup => Boolean(g) && g!.rows.length > 0);
  if (ungrouped.rows.length > 0) ordered.push(ungrouped);
  return ordered;
}

function FolderSelect({
  folders,
  currentFolderId,
}: {
  folders: FolderRow[];
  currentFolderId?: string | null;
}) {
  return (
    <select
      name="folderId"
      defaultValue={currentFolderId ?? ""}
      className="rounded border border-stone-300 px-2 py-1 text-xs"
      aria-label="Add to folder"
    >
      <option value="">Ungrouped</option>
      {folders.map((f) => (
        <option key={f.id} value={f.id}>
          {f.name}
        </option>
      ))}
    </select>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-2xl font-light tabular-nums">{value}</div>
      <div className="text-[11px] text-stone-500">{label}</div>
    </div>
  );
}

function hostFromUrl(s: string): string {
  try {
    return new URL(s).host.replace(/^www\./, "");
  } catch {
    return s;
  }
}

function sourcesHref(
  folder: string | null,
  outletId?: string | null,
): string {
  const params = new URLSearchParams();
  if (folder) params.set("folder", folder);
  if (outletId) params.set("outlet", outletId);
  const query = params.toString();
  return query ? `/sources?${query}` : "/sources";
}
