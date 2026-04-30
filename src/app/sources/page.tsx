/**
 * Sources view. RSS-only (the input from "the world").
 *
 * WordPress connection lives on /voice; sources are not the publish
 * destination, they're what you read.
 *
 * Card-first with optional table toggle. Bulk paste is the primary add path.
 */

import Link from "next/link";
import { ensureSchema, ensureSingleUser, SINGLE_USER_ID, db } from "@/lib/db";
import {
  addSourceAction,
  pollSourceAction,
  pollAllSourcesAction,
  deleteSourceAction,
} from "@/lib/v1/actions";
import { HelpTrigger } from "@/components/Help";
import {
  listOutlets,
  resolveOutletSourceIds,
  getOutletAssignmentsForSources,
} from "@/lib/v1/outlets";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ view?: string; outlet?: string }>;
}

export default async function SourcesPage({ searchParams }: PageProps) {
  await ensureSchema();
  await ensureSingleUser();

  const sp = await searchParams;
  const view = sp.view === "table" ? "table" : "cards";
  const outletFilter = sp.outlet && sp.outlet !== "all" ? sp.outlet : null;

  const outlets = await listOutlets(SINGLE_USER_ID);

  // If filtering by an outlet, resolve which source IDs are in scope.
  // Outlets with no explicit assignment fall back to all sources, so the
  // filtered view is identical to "All" — that's intentional (zero-config
  // default; assigning narrows the slice).
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
  const visibleRows = inScopeIds
    ? allRows.filter((r) => inScopeIds.has(String(r.id)))
    : allRows;

  const assignments = await getOutletAssignmentsForSources(
    visibleRows.map((r) => String(r.id)),
  );
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

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <div className="text-[11px] uppercase tracking-wider text-stone-500">
            What you read
          </div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">
            Sources · {visibleRows.length}
            {outletFilter ? (
              <span
                className="ml-2 text-sm font-normal"
                style={{ color: "var(--fg-muted)" }}
              >
                in scope for {outletDisplayMap.get(outletFilter) ?? "outlet"}
              </span>
            ) : null}
          </h1>
        </div>
        {!isEmpty ? (
          <div className="flex items-center gap-2">
            <form action={pollAllSourcesAction}>
              <button
                type="submit"
                className="rounded border border-stone-200 bg-white px-3 py-1.5 text-xs hover:bg-stone-50"
              >
                ↻ Poll all
              </button>
            </form>
            <div className="inline-flex rounded-lg border border-stone-200 bg-white p-0.5 text-xs">
              <Link
                href="/sources?view=cards"
                className={`rounded px-2 py-1 ${view === "cards" ? "bg-stone-900 text-white" : "text-stone-600 hover:bg-stone-50"}`}
              >
                Cards
              </Link>
              <Link
                href="/sources?view=table"
                className={`rounded px-2 py-1 ${view === "table" ? "bg-stone-900 text-white" : "text-stone-600 hover:bg-stone-50"}`}
              >
                Table
              </Link>
            </div>
          </div>
        ) : null}
      </div>

      {/* Outlet filter tabs */}
      {outlets.length > 0 && !isEmpty ? (
        <div className="flex items-center gap-2 overflow-x-auto pb-1">
          <span
            className="text-[11px] uppercase tracking-wider"
            style={{ color: "var(--fg-muted)" }}
          >
            Filter by outlet
          </span>
          <Link
            href={view === "table" ? "/sources?view=table" : "/sources"}
            className={`fp-chip ${
              !outletFilter ? "fp-chip-indigo" : ""
            } transition`}
          >
            All sources · {allRows.length}
          </Link>
          {outlets.map((o) => {
            const url = view === "table"
              ? `/sources?view=table&outlet=${o.id}`
              : `/sources?outlet=${o.id}`;
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

      {/* Add sources */}
      <section className="rounded-2xl border border-stone-200 bg-white p-6">
        <div className="mb-1 flex items-center gap-2">
          <span className="text-2xl">📥</span>
          <div>
            <div className="text-sm font-semibold">Add sources</div>
            <div className="text-[11px] text-stone-500">
              RSS / Atom feed URLs, Reddit subreddits, podcast feeds, YouTube
              channel feeds. Paste many; one per line.
            </div>
          </div>
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
          <div className="flex items-center gap-2">
            <button
              type="submit"
              className="rounded bg-indigo-600 px-4 py-1.5 text-sm text-white hover:bg-indigo-700"
            >
              Add
            </button>
            <span className="text-[11px] text-stone-500">
              kind auto-detected from URL pattern
            </span>
          </div>
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
              icon="🍎"
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
              icon="🛠️"
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
              icon="☕"
              name="Specialty coffee pack"
              description="Sprudge, Daily Coffee News, r/specialtycoffee."
              urls={[
                "https://sprudge.com/feed",
                "https://dailycoffeenews.com/feed",
                "https://reddit.com/r/specialtycoffee/.rss",
              ]}
            />
            <StarterPack
              icon="🤖"
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
          No sources assigned to this outlet yet. The outlet currently
          inherits all sources by default.{" "}
          <Link
            href="/sources"
            className="font-medium hover:underline"
            style={{ color: "var(--indigo)" }}
          >
            Show all sources →
          </Link>
        </div>
      ) : view === "cards" ? (
        <SourceCards
          rows={visibleRows}
          assignments={assignments}
          outletDisplayMap={outletDisplayMap}
        />
      ) : (
        <SourceTable rows={visibleRows} />
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
  icon,
  name,
  description,
  urls,
}: {
  icon: string;
  name: string;
  description: string;
  urls: string[];
}) {
  return (
    <div className="rounded-2xl border border-stone-200 bg-white p-4 transition hover:shadow-md">
      <div className="flex items-start gap-3">
        <div className="text-2xl">{icon}</div>
        <div className="flex-1">
          <div className="text-sm font-semibold">{name}</div>
          <div className="mt-0.5 text-[11px] text-stone-500">{description}</div>
        </div>
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
  trust_score: number;
  poll_interval_seconds: number;
  last_polled_at: number | null;
  last_error: string | null;
  active: number;
  created_at: number;
  item_count: number;
  items_24h: number;
}

const KIND_META: Record<
  string,
  { icon: string; color: string; label: string }
> = {
  rss: { icon: "📰", color: "bg-stone-100 text-stone-700", label: "RSS" },
  reddit: { icon: "🔥", color: "bg-orange-100 text-orange-800", label: "Reddit" },
  podcast: { icon: "🎙️", color: "bg-purple-100 text-purple-800", label: "Podcast" },
  youtube: { icon: "▶", color: "bg-rose-100 text-rose-800", label: "YouTube" },
};

function SourceCards({
  rows,
  assignments,
  outletDisplayMap,
}: {
  rows: SourceRow[];
  assignments: Map<string, string[]>;
  outletDisplayMap: Map<string, string>;
}) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {rows.map((row) => {
        const meta = KIND_META[row.kind] ?? KIND_META.rss!;
        const trust = Number(row.trust_score ?? 0.5);
        const trustPct = Math.round(trust * 100);
        const isPending =
          row.kind === "podcast" || row.kind === "youtube";
        const assignedOutletIds = assignments.get(String(row.id)) ?? [];
        return (
          <div
            key={row.id}
            className={`fp-card fp-card-hover p-4 ${isPending ? "opacity-75" : ""}`}
          >
            <Link
              href={`/sources/${row.id}`}
              className="block"
              prefetch={false}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-lg flex-shrink-0">{meta.icon}</span>
                  <div className="font-semibold truncate">
                    {row.display_name || hostFromUrl(row.url)}
                  </div>
                </div>
                <span
                  className={`rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wider flex-shrink-0 ${meta.color}`}
                >
                  {meta.label}
                </span>
              </div>
              <div className="mt-1 truncate text-[11px]" style={{ color: "var(--fg-muted)" }}>
                {row.url}
              </div>
            </Link>

            {row.last_error ? (
              <div className="mt-2 rounded px-2 py-1 text-[11px]" style={{ background: "var(--amber-tint)", color: "var(--amber)" }}>
                {isPending ? "Pending v1.1" : `⚠ ${row.last_error}`}
              </div>
            ) : null}

            <div className="mt-3 grid grid-cols-3 gap-2 text-center">
              <CardStat label="items" value={String(Number(row.item_count))} />
              <CardStat label="24h" value={String(Number(row.items_24h))} />
              <CardStatTrust value={`${trustPct}%`} />
            </div>

            {/* Outlet chips: explicit assignment, or "All outlets" default */}
            <div className="mt-3 flex flex-wrap items-center gap-1">
              <span
                className="text-[10px] uppercase tracking-wider"
                style={{ color: "var(--fg-subtle)" }}
              >
                Outlets:
              </span>
              {assignedOutletIds.length === 0 ? (
                <span className="fp-chip" title="Read by every outlet whose own assignment list is empty">
                  All outlets · default
                </span>
              ) : (
                assignedOutletIds.map((oid) => (
                  <Link
                    key={oid}
                    href={`/sources?outlet=${oid}`}
                    className="fp-chip fp-chip-indigo transition hover:scale-[1.02]"
                  >
                    {outletDisplayMap.get(oid) ?? oid.slice(0, 6)}
                  </Link>
                ))
              )}
            </div>

            <div className="mt-3 flex items-center justify-between">
              <span className="text-[10px]" style={{ color: "var(--fg-muted)" }}>
                {row.last_polled_at
                  ? `last fetch ${relativeTime(Number(row.last_polled_at))}`
                  : "never polled"}
              </span>
              <div className="flex gap-1">
                <Link
                  href={`/sources/${row.id}`}
                  prefetch={false}
                  className="fp-btn fp-btn-ghost"
                  style={{ padding: "4px 8px", fontSize: 11 }}
                >
                  Open
                </Link>
                <form action={pollSourceAction}>
                  <input type="hidden" name="sourceId" value={row.id} />
                  <button
                    type="submit"
                    className="fp-btn fp-btn-ghost"
                    style={{ padding: "4px 8px", fontSize: 11 }}
                    title="Poll now"
                  >
                    ↻
                  </button>
                </form>
                <form action={deleteSourceAction}>
                  <input type="hidden" name="sourceId" value={row.id} />
                  <button
                    type="submit"
                    className="fp-btn fp-btn-danger"
                    style={{ padding: "4px 8px", fontSize: 11 }}
                    title="Remove"
                  >
                    ×
                  </button>
                </form>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function CardStatTrust({ value }: { value: string }) {
  return (
    <div className="rounded bg-[color:var(--bg-subtle)] px-1 py-1.5">
      <div className="text-sm font-light tabular">{value}</div>
      <div className="text-[10px]" style={{ color: "var(--fg-muted)" }}>
        <HelpTrigger id="trust">trust</HelpTrigger>
      </div>
    </div>
  );
}

function SourceTable({ rows }: { rows: SourceRow[] }) {
  return (
    <div className="overflow-hidden rounded-xl border border-stone-200 bg-white">
      <div className="grid grid-cols-12 gap-3 border-b border-stone-200 bg-stone-50 px-4 py-2 text-[10px] uppercase tracking-wider text-stone-500">
        <div className="col-span-5">Source</div>
        <div className="col-span-2">Type</div>
        <div className="col-span-1 text-right">Items</div>
        <div className="col-span-2 text-right">Last fetch</div>
        <div className="col-span-2 text-right">Actions</div>
      </div>
      <div className="divide-y divide-stone-100">
        {rows.map((row) => {
          const meta = KIND_META[row.kind] ?? KIND_META.rss!;
          return (
            <div
              key={row.id}
              className="grid grid-cols-12 items-center gap-3 px-4 py-3 text-xs hover:bg-stone-50"
            >
              <div className="col-span-5">
                <div className="font-medium text-stone-900">
                  {row.display_name || hostFromUrl(row.url)}
                </div>
                <div className="truncate text-[11px] text-stone-500">{row.url}</div>
                {row.last_error ? (
                  <div className="mt-0.5 text-[11px] text-rose-600">⚠ {row.last_error}</div>
                ) : null}
              </div>
              <div className="col-span-2">
                <span className={`rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wider ${meta.color}`}>
                  {meta.label}
                </span>
              </div>
              <div className="col-span-1 text-right tabular-nums text-stone-700">
                {Number(row.item_count)}
              </div>
              <div className="col-span-2 text-right text-stone-500">
                {row.last_polled_at ? relativeTime(Number(row.last_polled_at)) : "—"}
              </div>
              <div className="col-span-2 flex justify-end gap-1.5">
                <form action={pollSourceAction}>
                  <input type="hidden" name="sourceId" value={row.id} />
                  <button
                    type="submit"
                    className="rounded border border-stone-200 px-2 py-1 text-[11px] hover:bg-stone-50"
                  >
                    Poll
                  </button>
                </form>
                <form action={deleteSourceAction}>
                  <input type="hidden" name="sourceId" value={row.id} />
                  <button
                    type="submit"
                    className="rounded border border-rose-200 px-2 py-1 text-[11px] text-rose-700 hover:bg-rose-50"
                  >
                    Remove
                  </button>
                </form>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CardStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded bg-stone-50 px-1 py-1.5">
      <div className="text-sm font-light tabular-nums">{value}</div>
      <div className="text-[10px] text-stone-500">{label}</div>
    </div>
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

function relativeTime(ms: number): string {
  const diff = Date.now() - ms;
  const min = Math.floor(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}
