/**
 * Drafts list. Two buckets: still-drafting (no WP post yet) and sent to
 * WordPress (push has happened, FlavorPress now holds a receipt). The
 * sent bucket exists so the act of finding what you shipped today is part
 * of the same loop as finding what you started this morning.
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

interface SentRow {
  id: string;
  headline: string;
  outlet_display_name: string | null;
  outlet_base_url: string | null;
  source_count: number | null;
  wp_edit_link: string | null;
  sent_at: number;
}

interface NoteRow {
  id: string;
  topic: string;
  cluster_id: string;
  created_at: number;
  source_count: number | null;
  ideas: number;
  quotes: number;
  facts: number;
}

export default async function DraftsPage() {
  await ensureSchema();
  await ensureSingleUser();

  const r = await db.execute({
    sql: `SELECT d.id, d.mode, d.headline, d.cluster_id, d.outlet_id,
                 d.voice_match_score, d.notes, d.created_at, d.edited_at,
                 d.wp_post_id, d.wp_edit_link, d.wp_synced_at,
                 c.source_count AS source_count,
                 o.display_name AS outlet_display_name,
                 o.base_url AS outlet_base_url
          FROM drafts d
          LEFT JOIN clusters c ON c.id = d.cluster_id
          LEFT JOIN outlets o ON o.id = d.outlet_id
          WHERE d.user_id = ?
          ORDER BY d.created_at DESC`,
    args: [SINGLE_USER_ID],
  });

  const drafts: DraftRow[] = [];
  const sent: SentRow[] = [];
  const notes: NoteRow[] = [];
  for (const row of r.rows) {
    const mode = String(row.mode ?? "drafter");
    const isSent = Boolean(row.wp_post_id);

    if (isSent && mode !== "researcher") {
      sent.push({
        id: String(row.id),
        headline: String(row.headline),
        outlet_display_name:
          row.outlet_display_name === null ? null : String(row.outlet_display_name),
        outlet_base_url: row.outlet_base_url === null ? null : String(row.outlet_base_url),
        source_count: row.source_count === null ? null : Number(row.source_count),
        wp_edit_link: row.wp_edit_link ? String(row.wp_edit_link) : null,
        sent_at: row.wp_synced_at
          ? Number(row.wp_synced_at)
          : Number(row.edited_at ?? row.created_at),
      });
      continue;
    }

    if (mode === "researcher") {
      const counts = parseNoteCounts(row.notes ? String(row.notes) : null);
      notes.push({
        id: String(row.id),
        topic: String(row.headline),
        cluster_id: String(row.cluster_id),
        created_at: Number(row.created_at),
        source_count: row.source_count === null ? null : Number(row.source_count),
        ...counts,
      });
      continue;
    }

    drafts.push({
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
    });
  }

  sent.sort((a, b) => b.sent_at - a.sent_at);

  return (
    <div className="space-y-8">
      <header>
        <div className="text-[11px] uppercase tracking-wider text-stone-500">Drafts</div>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">
          {drafts.length} drafting · {sent.length} sent
        </h1>
        <p className="mt-1 text-sm" style={{ color: "var(--fg-muted)" }}>
          Still-in-flight drafts and a record of what you've sent to WordPress today.
        </p>
      </header>

      <DraftingSection drafts={drafts} />
      {sent.length > 0 ? <SentSection sent={sent} /> : null}
      {notes.length > 0 ? <NotesSection notes={notes} /> : null}

      {drafts.length === 0 && sent.length === 0 && notes.length === 0 ? (
        <div
          className="rounded-xl border border-dashed p-8 text-center text-sm"
          style={{ borderColor: "var(--border)", color: "var(--fg-muted)" }}
        >
          Nothing here yet.{" "}
          <Link href="/" className="font-medium hover:underline" style={{ color: "var(--indigo)" }}>
            Open Today →
          </Link>{" "}
          to draft from a cluster.
        </div>
      ) : null}
    </div>
  );
}

function DraftingSection({ drafts }: { drafts: DraftRow[] }) {
  return (
    <section className="space-y-3">
      <header className="flex items-baseline gap-3">
        <div className="text-[11px] uppercase tracking-wider text-stone-500">
          Drafting · {drafts.length}
        </div>
      </header>
      {drafts.length === 0 ? (
        <p className="text-[12px]" style={{ color: "var(--fg-subtle)" }}>
          Nothing in flight.
        </p>
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
    </section>
  );
}

function SentSection({ sent }: { sent: SentRow[] }) {
  return (
    <section className="space-y-3">
      <header className="flex items-baseline gap-3">
        <div className="text-[11px] uppercase tracking-wider text-stone-500">
          Sent to WordPress · {sent.length}
        </div>
      </header>
      <ul className="divide-y divide-stone-200 overflow-hidden rounded-xl border border-stone-200 bg-white">
        {sent.map((s) => (
          <li key={s.id} className="flex items-start gap-3 px-5 py-4 transition hover:bg-stone-50">
            <div className="flex flex-1 items-start gap-4 min-w-0">
              <div className="flex-1 min-w-0">
                <div
                  className="line-clamp-2 text-sm font-medium"
                  style={{ color: "var(--fg-muted)" }}
                >
                  {s.headline}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-stone-500">
                  <span>sent {relativeTime(s.sent_at)}</span>
                  <span className="text-stone-300">·</span>
                  <span>
                    {s.outlet_display_name ??
                      (s.outlet_base_url ? hostFromUrl(s.outlet_base_url) : "no outlet")}
                  </span>
                  {s.source_count !== null ? (
                    <>
                      <span className="text-stone-300">·</span>
                      <span>
                        {s.source_count} {s.source_count === 1 ? "source" : "sources"}
                      </span>
                    </>
                  ) : null}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-3 text-[11px]">
              {s.wp_edit_link ? (
                <a
                  href={s.wp_edit_link}
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium hover:underline"
                  style={{ color: "var(--indigo)" }}
                >
                  Open in WP ↗
                </a>
              ) : null}
              <Link
                href={`/editor/${s.id}`}
                className="hover:underline"
                style={{ color: "var(--fg-subtle)" }}
              >
                View receipt
              </Link>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function NotesSection({ notes }: { notes: NoteRow[] }) {
  return (
    <section className="space-y-3">
      <header>
        <div className="text-[11px] uppercase tracking-wider text-stone-500">
          Research notes · {notes.length}
        </div>
        <p className="mt-1 text-sm" style={{ color: "var(--fg-muted)" }}>
          Ideas, verbatim quotes, and leads to verify. Notes don't push to WordPress; the post is
          yours to write.
        </p>
      </header>
      <ul className="divide-y divide-stone-200 overflow-hidden rounded-xl border border-stone-200 bg-white">
        {notes.map((n) => {
          const isStale = Date.now() - n.created_at > STALE_AFTER_MS;
          return (
            <li
              key={n.id}
              className="flex items-start gap-3 px-5 py-4 transition hover:bg-stone-50"
            >
              <Link href={`/editor/${n.id}`} className="flex flex-1 items-start gap-4 min-w-0">
                <div className="flex-1 min-w-0">
                  <div className="line-clamp-2 text-sm font-medium text-stone-900">{n.topic}</div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-stone-500">
                    <span>{relativeTime(n.created_at)}</span>
                    <span className="text-stone-300">·</span>
                    <span>
                      {n.ideas} ideas · {n.quotes} quotes · {n.facts} leads
                    </span>
                    {n.source_count !== null ? (
                      <>
                        <span className="text-stone-300">·</span>
                        <span>
                          {n.source_count} {n.source_count === 1 ? "source" : "sources"}
                        </span>
                      </>
                    ) : null}
                  </div>
                </div>
                {isStale ? <StaleChip /> : null}
              </Link>
              <form action={deleteDraftAction}>
                <input type="hidden" name="draftId" value={n.id} />
                <button
                  type="submit"
                  className="rounded border border-stone-200 px-2 py-1 text-[11px] text-stone-500 transition hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700"
                  title="Delete these notes"
                  aria-label={`Delete notes: ${n.topic}`}
                >
                  Delete
                </button>
              </form>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function parseNoteCounts(raw: string | null): {
  ideas: number;
  quotes: number;
  facts: number;
} {
  if (!raw) return { ideas: 0, quotes: 0, facts: 0 };
  try {
    const parsed = JSON.parse(raw) as {
      ideas?: unknown[];
      quotes?: unknown[];
      facts?: unknown[];
    };
    return {
      ideas: Array.isArray(parsed.ideas) ? parsed.ideas.length : 0,
      quotes: Array.isArray(parsed.quotes) ? parsed.quotes.length : 0,
      facts: Array.isArray(parsed.facts) ? parsed.facts.length : 0,
    };
  } catch {
    return { ideas: 0, quotes: 0, facts: 0 };
  }
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
