/**
 * Drafts list. Unsent drafts only — those without a WordPress post yet.
 * The act of finding a draft you started this morning is part of "reading
 * to writing"; without this surface, drafts that age out of Today are
 * effectively invisible.
 */

import Link from "next/link";
import { ensureSchema, ensureSingleUser, SINGLE_USER_ID, db } from "@/lib/db";
import { deleteDraftAction } from "@/lib/v1/actions";

export const dynamic = "force-dynamic";

// A draft is "stale" once it stops being a same-day artifact. The product
// thesis is reading-to-writing within the day; flag drafts that missed it
// so the user notices abandoned work instead of letting it pile up silently.
const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

interface DraftRow {
  id: string;
  headline: string;
  cluster_id: string;
  outlet_id: string;
  voice_match_score: number;
  created_at: number;
  source_count: number | null;
  outlet_display_name: string | null;
  outlet_base_url: string | null;
}

export default async function DraftsPage() {
  await ensureSchema();
  await ensureSingleUser();

  const r = await db.execute({
    sql: `SELECT d.id, d.headline, d.cluster_id, d.outlet_id,
                 d.voice_match_score, d.created_at,
                 c.source_count AS source_count,
                 o.display_name AS outlet_display_name,
                 o.base_url AS outlet_base_url
          FROM drafts d
          LEFT JOIN clusters c ON c.id = d.cluster_id
          LEFT JOIN outlets o ON o.id = d.outlet_id
          WHERE d.user_id = ? AND d.wp_post_id IS NULL
          ORDER BY d.created_at DESC`,
    args: [SINGLE_USER_ID],
  });

  const drafts = r.rows.map(
    (row) =>
      ({
        id: String(row.id),
        headline: String(row.headline),
        cluster_id: String(row.cluster_id),
        outlet_id: String(row.outlet_id),
        voice_match_score: Number(row.voice_match_score ?? 0),
        created_at: Number(row.created_at),
        source_count: row.source_count === null ? null : Number(row.source_count),
        outlet_display_name:
          row.outlet_display_name === null ? null : String(row.outlet_display_name),
        outlet_base_url: row.outlet_base_url === null ? null : String(row.outlet_base_url),
      }) satisfies DraftRow,
  );

  return (
    <div className="space-y-6">
      <header>
        <div className="text-[11px] uppercase tracking-wider text-stone-500">Unsent drafts</div>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Drafts · {drafts.length}</h1>
        <p className="mt-1 text-sm" style={{ color: "var(--fg-muted)" }}>
          Drafts created from clusters that haven't been pushed to WordPress yet. Open one to keep
          editing or push it.
        </p>
      </header>

      {drafts.length === 0 ? (
        <div
          className="rounded-xl border border-dashed p-8 text-center text-sm"
          style={{ borderColor: "var(--border)", color: "var(--fg-muted)" }}
        >
          No unsent drafts.{" "}
          <Link href="/" className="font-medium hover:underline" style={{ color: "var(--indigo)" }}>
            Open Today →
          </Link>{" "}
          to draft from a cluster.
        </div>
      ) : (
        <ul className="divide-y divide-stone-200 overflow-hidden rounded-xl border border-stone-200 bg-white">
          {drafts.map((d) => {
            const isStale = Date.now() - d.created_at > STALE_AFTER_MS;
            return (
              <li
                key={d.id}
                className="flex items-start gap-3 px-5 py-4 transition hover:bg-stone-50"
              >
                <Link href={`/editor/${d.id}`} className="flex flex-1 items-start gap-4 min-w-0">
                  <div className="flex-1 min-w-0">
                    <div className="line-clamp-2 text-sm font-medium text-stone-900">
                      {d.headline}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-stone-500">
                      <span>{relativeTime(d.created_at)}</span>
                      <span className="text-stone-300">·</span>
                      <span>
                        {d.outlet_display_name ??
                          (d.outlet_base_url ? hostFromUrl(d.outlet_base_url) : "no outlet")}
                      </span>
                      {d.source_count !== null ? (
                        <>
                          <span className="text-stone-300">·</span>
                          <span>
                            {d.source_count} {d.source_count === 1 ? "source" : "sources"}
                          </span>
                        </>
                      ) : null}
                    </div>
                  </div>
                  {isStale ? <StaleChip /> : null}
                  <VoiceChip score={d.voice_match_score} />
                </Link>
                <form action={deleteDraftAction}>
                  <input type="hidden" name="draftId" value={d.id} />
                  <button
                    type="submit"
                    className="rounded border border-stone-200 px-2 py-1 text-[11px] text-stone-500 transition hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700"
                    title="Delete this draft"
                    aria-label={`Delete draft: ${d.headline}`}
                  >
                    Delete
                  </button>
                </form>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function StaleChip() {
  return (
    <span
      className="shrink-0 rounded border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] text-amber-700"
      title="Created more than 24 hours ago. Same-day drafting is the goal; consider finishing or deleting."
    >
      Stale
    </span>
  );
}

function VoiceChip({ score }: { score: number }) {
  const ok = score >= 75;
  return (
    <span
      className={`shrink-0 rounded border px-2 py-0.5 text-[11px] tabular-nums ${
        ok
          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
          : "border-amber-200 bg-amber-50 text-amber-700"
      }`}
      title="Voice-match score"
    >
      voice {score}
    </span>
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
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hr ago`;
  const day = Math.floor(hr / 24);
  return `${day} day${day === 1 ? "" : "s"} ago`;
}
