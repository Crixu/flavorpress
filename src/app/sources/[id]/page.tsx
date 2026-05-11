/**
 * Per-source detail view.
 *
 * Shows recent items from this source plus, for each item that joined a
 * cluster, the "Also covered by" list of other sources in the same cluster.
 * Power users get the cluster math; everyone gets the value: are my sources
 * covering the same stories, or are they all pulling in different directions?
 */

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ensureSchema, db } from "@/lib/db";
import { AuthRequiredError, requireSession } from "@/lib/session";
import { HelpTrigger } from "@/components/Help";
import { PendingMessage, SubmitButton } from "@/app/_components/SubmitButton";
import {
  deleteSourceAction,
  assignSourceOutletsAction,
  pauseSourceAction,
  resumeSourceAction,
} from "@/lib/v1/actions";
import { listOutlets, getOutletIdsForSource } from "@/lib/v1/outlets";
import { PollSourceButton } from "../_components/PollSourceButton";
import { TrustBoostControl } from "../_components/TrustBoostControl";
import { SourceTitleEditor } from "./_components/SourceTitleEditor";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function SourceDetailPage({ params }: PageProps) {
  await ensureSchema();
  let session;
  try {
    session = await requireSession();
  } catch (err) {
    if (err instanceof AuthRequiredError) redirect("/login");
    throw err;
  }
  const { id } = await params;
  const nowTs = Date.now();

  const sourceR = await db.execute({
    sql: `WITH item_stats AS (
            SELECT source_id,
                   COUNT(*) AS item_count,
                   SUM(CASE WHEN fetched_at > ? THEN 1 ELSE 0 END) AS items_24h,
                   COUNT(DISTINCT CASE WHEN cluster_id IS NOT NULL THEN cluster_id END) AS clusters_joined
            FROM items
            WHERE source_id = ?
            GROUP BY source_id
          )
          SELECT s.*,
                 COALESCE(item_stats.item_count, 0) AS item_count,
                 COALESCE(item_stats.items_24h, 0) AS items_24h,
                 COALESCE(item_stats.clusters_joined, 0) AS clusters_joined
          FROM sources s
          LEFT JOIN item_stats ON item_stats.source_id = s.id
          WHERE s.id = ? AND s.user_id = ?`,
    args: [nowTs - 24 * 60 * 60 * 1000, id, id, session.userId],
  });
  if (sourceR.rows.length === 0) notFound();
  const source = sourceR.rows[0]!;

  const [itemsR, outlets, sourceOutletIds] = await Promise.all([
    db.execute({
      sql: `SELECT id, canonical_url, title, lede, published_at, fetched_at, cluster_id
            FROM items WHERE source_id = ?
            ORDER BY published_at DESC LIMIT 30`,
      args: [id],
    }),
    listOutlets(session.userId),
    getOutletIdsForSource(id),
  ]);
  const assignedOutletIds = new Set(sourceOutletIds);

  // For each item that has a cluster_id, list the OTHER sources in that
  // cluster — the "Also covered by" widget.
  const clusterIds = Array.from(
    new Set(
      itemsR.rows
        .map((r) => (r.cluster_id ? String(r.cluster_id) : null))
        .filter((v): v is string => v !== null),
    ),
  );

  const alsoCoveredMap = new Map<string, { display: string; url: string; sourceId: string }[]>();
  if (clusterIds.length > 0) {
    const placeholders = clusterIds.map(() => "?").join(",");
    const others = await db.execute({
      sql: `SELECT i.cluster_id, s.id AS source_id, s.url AS source_url,
                   s.display_name, s.kind
            FROM items i
            JOIN sources s ON s.id = i.source_id
            WHERE i.cluster_id IN (${placeholders}) AND i.source_id != ?`,
      args: [...clusterIds, id],
    });
    for (const row of others.rows) {
      const cid = String(row.cluster_id);
      const entry = {
        display: String(row.display_name ?? hostFromUrl(String(row.source_url))),
        url: String(row.source_url),
        sourceId: String(row.source_id),
      };
      if (!alsoCoveredMap.has(cid)) alsoCoveredMap.set(cid, []);
      const list = alsoCoveredMap.get(cid)!;
      // Dedupe by source id (one source contributes once even with multiple items).
      if (!list.some((e) => e.sourceId === entry.sourceId)) list.push(entry);
    }
  }

  const trust = Number(source.trust_score ?? 0.5);
  const trustPct = Math.round(trust * 100);
  const lastErr = source.last_error ? String(source.last_error) : null;
  const isPending = String(source.kind) === "podcast" || String(source.kind) === "youtube";
  const pausedUntil =
    source.paused_until !== null && source.paused_until !== undefined
      ? Number(source.paused_until)
      : null;
  const isPaused = pausedUntil !== null && pausedUntil > nowTs;

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/sources"
          className="text-xs font-medium transition hover:underline"
          style={{ color: "var(--fg-muted)" }}
        >
          ← All sources
        </Link>
      </div>

      <header className="space-y-1.5">
        <div className="fp-eyebrow">{kindLabel(String(source.kind))} source</div>
        <SourceTitleEditor
          sourceId={id}
          initialTitle={String(source.display_name ?? hostFromUrl(String(source.url)))}
        />
        <a
          href={String(source.url)}
          target="_blank"
          rel="noreferrer"
          className="text-sm font-mono break-all hover:underline"
          style={{ color: "var(--fg-muted)" }}
        >
          {String(source.url)}
        </a>
      </header>

      {isPending ? (
        <div
          className="rounded-lg p-4 text-sm"
          style={{
            background: "var(--amber-tint)",
            color: "var(--amber)",
            border: "1px solid color-mix(in srgb, var(--amber) 25%, var(--border))",
          }}
        >
          Pending v1.1. Podcasts and YouTube need Whisper transcription before the cluster engine
          can do anything with them. Source is saved; it activates when v1.1 ships.
        </div>
      ) : null}

      {lastErr && !isPending ? (
        <div
          className="rounded-lg p-4 text-sm"
          style={{
            background: "var(--rose-tint)",
            color: "var(--rose)",
            border: "1px solid color-mix(in srgb, var(--rose) 25%, var(--border))",
          }}
        >
          ⚠ {lastErr}
        </div>
      ) : null}

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat
          label={
            <>
              <HelpTrigger id="trust">Trust</HelpTrigger>
            </>
          }
          value={`${trustPct}%`}
        />
        <Stat label="Items total" value={String(Number(source.item_count))} />
        <Stat label="Items / 24h" value={String(Number(source.items_24h))} />
        <Stat
          label={
            <>
              <HelpTrigger id="cluster">Clusters joined</HelpTrigger>
            </>
          }
          value={String(Number(source.clusters_joined))}
        />
      </section>

      <section className="flex flex-wrap items-center gap-3 rounded-lg border border-stone-200 bg-white px-4 py-3">
        <div>
          <div className="text-[11px] uppercase tracking-wider text-stone-500">Boost trust</div>
          <div className="text-[12px] text-stone-600">
            Nudge ±0.1 per click. Higher = this source counts for more when clusters fire; lower =
            noisier sources stop dragging the inbox.
          </div>
        </div>
        <div className="ml-auto">
          <TrustBoostControl sourceId={id} trust={trust} size="md" />
        </div>
      </section>

      {isPaused ? (
        <div
          className="rounded-lg p-4 text-sm"
          style={{
            background: "var(--amber-tint)",
            color: "var(--amber)",
            border: "1px solid color-mix(in srgb, var(--amber) 25%, var(--border))",
          }}
        >
          Snoozed. Bulk polls will skip this source until {new Date(pausedUntil!).toLocaleString()}.
          Resume anytime, or hit Poll now to override the snooze just this once.
        </div>
      ) : null}

      {/* Action bar */}
      <div className="flex flex-wrap gap-2">
        <PollSourceButton
          sourceId={id}
          className="fp-btn fp-btn-ghost"
          label="↻ Poll now"
          busyLabel="Polling source…"
        />
        {isPaused ? (
          <form action={resumeSourceAction}>
            <input type="hidden" name="sourceId" value={id} />
            <SubmitButton className="fp-btn fp-btn-ghost" pendingLabel="Resuming">
              ▶ Resume
            </SubmitButton>
          </form>
        ) : (
          <form action={pauseSourceAction} className="flex items-center gap-2">
            <input type="hidden" name="sourceId" value={id} />
            <select
              name="durationHours"
              defaultValue="24"
              className="rounded border border-stone-300 bg-white px-2 py-1 text-xs"
              aria-label="Snooze duration"
            >
              <option value="1">1 hour</option>
              <option value="24">1 day</option>
              <option value="168">1 week</option>
            </select>
            <SubmitButton className="fp-btn fp-btn-ghost" pendingLabel="Snoozing">
              Snooze
            </SubmitButton>
          </form>
        )}
        <form action={deleteSourceAction}>
          <input type="hidden" name="sourceId" value={id} />
          <input type="hidden" name="redirectTo" value="/sources" />
          <SubmitButton className="fp-btn fp-btn-danger" pendingLabel="Removing source">
            Remove source
          </SubmitButton>
        </form>
      </div>

      {/* Outlet assignment */}
      {outlets.length > 0 ? (
        <section className="fp-card p-5">
          <div className="mb-2">
            <div className="fp-eyebrow">Reads into</div>
            <p className="text-[13px] leading-relaxed" style={{ color: "var(--fg-muted)" }}>
              Pick which outlets see this source. Leave all unchecked to fall back to the default:
              every outlet reads from this source.
            </p>
          </div>
          <form action={assignSourceOutletsAction} className="space-y-3">
            <input type="hidden" name="sourceId" value={id} />
            <div className="grid gap-2 sm:grid-cols-2">
              {outlets.map((o) => {
                const checked = assignedOutletIds.has(o.id);
                const display = o.displayName ?? hostFromUrl(String(o.baseUrl));
                return (
                  <label
                    key={o.id}
                    className="flex cursor-pointer items-start gap-2 rounded-lg p-2 transition hover:bg-[color:var(--bg-subtle)]"
                  >
                    <input
                      type="checkbox"
                      name="outletIds"
                      value={o.id}
                      defaultChecked={checked}
                      className="mt-0.5"
                    />
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">{display}</div>
                      <div className="truncate text-[11px]" style={{ color: "var(--fg-muted)" }}>
                        {o.baseUrl}
                      </div>
                    </div>
                  </label>
                );
              })}
            </div>
            <div className="flex items-center gap-3">
              <SubmitButton className="fp-btn fp-btn-primary" pendingLabel="Saving assignment">
                Save assignment
              </SubmitButton>
              <span className="text-[11px]" style={{ color: "var(--fg-subtle)" }}>
                {assignedOutletIds.size === 0
                  ? "Currently: All outlets (default)"
                  : `Currently assigned to ${assignedOutletIds.size} outlet${
                      assignedOutletIds.size === 1 ? "" : "s"
                    }`}
              </span>
            </div>
            <PendingMessage>Saving which outlet reads this source.</PendingMessage>
          </form>
        </section>
      ) : null}

      {/* Items */}
      <section>
        <div className="mb-3 flex items-center gap-2">
          <h2 className="text-base font-semibold tracking-tight">Recent items</h2>
          <span className="fp-chip">{itemsR.rows.length}</span>
        </div>

        {itemsR.rows.length === 0 ? (
          <div
            className="rounded-xl border border-dashed border-[color:var(--border)] bg-white p-6 text-center text-sm"
            style={{ color: "var(--fg-muted)" }}
          >
            No items yet. Hit "Poll now" to fetch.
          </div>
        ) : (
          <div className="space-y-3">
            {itemsR.rows.map((row) => {
              const itemId = String(row.id);
              const cid = row.cluster_id ? String(row.cluster_id) : null;
              const others = cid ? (alsoCoveredMap.get(cid) ?? []) : [];
              return (
                <article key={itemId} className="fp-card fp-card-hover p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <a
                        href={String(row.canonical_url)}
                        target="_blank"
                        rel="noreferrer"
                        className="text-base font-semibold leading-snug hover:underline"
                      >
                        {String(row.title)}
                      </a>
                      <p
                        className="mt-1 text-[13px] leading-relaxed line-clamp-2"
                        style={{ color: "var(--fg-muted)" }}
                      >
                        {String(row.lede)}
                      </p>
                    </div>
                    <span
                      className="fp-chip"
                      title={new Date(Number(row.published_at)).toLocaleString()}
                    >
                      {relativeTime(Number(row.published_at))}
                    </span>
                  </div>

                  {others.length > 0 ? (
                    <div className="mt-3 border-t border-[color:var(--border)] pt-3">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="fp-eyebrow">Also covered by</span>
                        <span className="fp-chip fp-chip-emerald">
                          cluster · {others.length + 1} sources
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {others.map((o) => (
                          <Link
                            key={o.sourceId}
                            href={`/sources/${o.sourceId}`}
                            className="fp-chip fp-chip-indigo transition hover:scale-[1.02]"
                          >
                            {o.display}
                          </Link>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="mt-3 border-t border-[color:var(--border)] pt-3">
                      <span className="text-[11px]" style={{ color: "var(--fg-subtle)" }}>
                        Not yet in a cluster — needs 2+ other sources covering the same story within
                        72 hours.
                      </span>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: React.ReactNode; value: string }) {
  return (
    <div className="fp-stat">
      <div className="text-2xl font-light tabular">{value}</div>
      <div className="text-[11px]" style={{ color: "var(--fg-muted)" }}>
        {label}
      </div>
    </div>
  );
}

function kindLabel(k: string): string {
  switch (k) {
    case "rss":
      return "RSS / Atom";
    case "reddit":
      return "Reddit";
    case "podcast":
      return "Podcast";
    case "youtube":
      return "YouTube";
    case "x":
      return "X";
    default:
      return k;
  }
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
