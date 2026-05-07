/**
 * Drafts list. Three bucket tabs: In progress, Notes, Sent.
 *
 * In progress: active drafts (no wp_post_id, mode != researcher). Stale rows
 * (>24h since edit/creation) pinned to top with amber border via wpds-card-stale.
 *
 * Notes: researcher-mode drafts. Shown as emphasis Cards with an idea/quote/fact
 * stat summary in the eyebrow.
 *
 * Sent: compact two-line rows, no card frame. Title in serif, meta below.
 *
 * Tag chips are pulled from item_tags via a cluster -> items join and rendered
 * inline on each row (top 3 by confidence).
 */

import Link from "next/link";
import { ensureSchema, ensureSingleUser, SINGLE_USER_ID, db } from "@/lib/db";
import { deleteDraftAction } from "@/lib/v1/actions";
import { Card } from "@/components/wpds";
import { BucketTabs, type Bucket } from "./_components/BucketTabs";

export const dynamic = "force-dynamic";

// A draft is "stale" once it stops being a same-day artifact.
const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

interface DraftRow {
  id: string;
  headline: string;
  cluster_id: string;
  outlet_id: string;
  voice_match_score: number;
  created_at: number;
  edited_at: number | null;
  source_count: number | null;
  outlet_display_name: string | null;
  outlet_base_url: string | null;
  tags: string[];
}

interface SentRow {
  id: string;
  headline: string;
  outlet_display_name: string | null;
  outlet_base_url: string | null;
  source_count: number | null;
  wp_edit_link: string | null;
  sent_at: number;
  tags: string[];
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
  tags: string[];
}

interface PageProps {
  searchParams: Promise<{ bucket?: string }>;
}

export default async function DraftsPage({ searchParams }: PageProps) {
  await ensureSchema();
  await ensureSingleUser();

  const sp = await searchParams;
  const rawBucket = sp.bucket;
  const bucket: Bucket = rawBucket === "notes" || rawBucket === "sent" ? rawBucket : "in-progress";

  const r = await db.execute({
    sql: `SELECT d.id, d.mode, d.headline, d.cluster_id, d.outlet_id,
                 d.voice_match_score, d.notes, d.created_at, d.edited_at,
                 d.wp_post_id, d.wp_edit_link, d.wp_synced_at,
                 c.source_count AS source_count,
                 o.display_name AS outlet_display_name,
                 o.base_url AS outlet_base_url,
                 (SELECT GROUP_CONCAT(it.tag, ',')
                  FROM (
                    SELECT DISTINCT it2.tag
                    FROM items i2
                    JOIN item_tags it2 ON it2.item_id = i2.id
                    WHERE i2.cluster_id = d.cluster_id
                    ORDER BY it2.confidence DESC
                    LIMIT 3
                  ) AS it
                 ) AS top_tags
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
    const tags = parseTags(row.top_tags ? String(row.top_tags) : null);

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
        tags,
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
        tags,
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
      edited_at: row.edited_at !== null ? Number(row.edited_at) : null,
      source_count: row.source_count === null ? null : Number(row.source_count),
      outlet_display_name:
        row.outlet_display_name === null ? null : String(row.outlet_display_name),
      outlet_base_url: row.outlet_base_url === null ? null : String(row.outlet_base_url),
      tags,
    });
  }

  sent.sort((a, b) => b.sent_at - a.sent_at);

  const counts = {
    "in-progress": drafts.length,
    notes: notes.length,
    sent: sent.length,
  };

  const isEmpty = drafts.length === 0 && sent.length === 0 && notes.length === 0;

  return (
    <div className="space-y-6">
      <header>
        <div className="text-[11px] uppercase tracking-wider text-stone-500">Drafts</div>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">
          {drafts.length} drafting · {sent.length} sent
        </h1>
        <p className="mt-1 text-sm" style={{ color: "var(--fg-muted)" }}>
          Still-in-flight drafts and a record of what you've sent to WordPress today.
        </p>
      </header>

      {isEmpty ? (
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
      ) : (
        <>
          <BucketTabs active={bucket} counts={counts} />

          {bucket === "in-progress" && <InProgressSection drafts={drafts} />}
          {bucket === "notes" && <NotesSection notes={notes} />}
          {bucket === "sent" && <SentSection sent={sent} />}
        </>
      )}
    </div>
  );
}

function InProgressSection({ drafts }: { drafts: DraftRow[] }) {
  if (drafts.length === 0) {
    return (
      <p className="text-[12px]" style={{ color: "var(--fg-subtle)" }}>
        Nothing in flight.
      </p>
    );
  }

  const now = Date.now();
  const stale = drafts.filter((d) => now - (d.edited_at ?? d.created_at) > STALE_AFTER_MS);
  const fresh = drafts.filter((d) => now - (d.edited_at ?? d.created_at) <= STALE_AFTER_MS);
  const ordered = [...stale, ...fresh];

  return (
    <section className="space-y-3">
      {ordered.map((d) => {
        const isStale = now - (d.edited_at ?? d.created_at) > STALE_AFTER_MS;
        return (
          <Card key={d.id} className={isStale ? "wpds-card-stale" : ""}>
            <div className="flex items-start gap-4">
              <Link href={`/editor/${d.id}`} className="block flex-1 min-w-0">
                <div className="line-clamp-2 text-sm font-medium text-stone-900">{d.headline}</div>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-stone-500">
                  <span>{relativeTime(d.edited_at ?? d.created_at)}</span>
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
                  {d.tags.length > 0 ? (
                    <>
                      <span className="text-stone-300">·</span>
                      {d.tags.map((tag) => (
                        <TagChip key={tag} tag={tag} />
                      ))}
                    </>
                  ) : null}
                </div>
              </Link>
              <div className="flex flex-col items-end gap-2 shrink-0">
                <VoiceChip score={d.voice_match_score} />
                {isStale ? <StaleChip /> : null}
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
              </div>
            </div>
          </Card>
        );
      })}
    </section>
  );
}

function NotesSection({ notes }: { notes: NoteRow[] }) {
  if (notes.length === 0) {
    return (
      <p className="text-[12px]" style={{ color: "var(--fg-subtle)" }}>
        No research notes yet.
      </p>
    );
  }

  const now = Date.now();

  return (
    <section className="space-y-3">
      <p className="text-sm" style={{ color: "var(--fg-muted)" }}>
        Ideas, verbatim quotes, and leads to verify. Notes don't push to WordPress; the post is
        yours to write.
      </p>
      {notes.map((n) => {
        const isStale = now - n.created_at > STALE_AFTER_MS;
        return (
          <Card key={n.id} emphasis>
            <div className="flex items-start gap-4">
              <Link href={`/editor/${n.id}`} className="block flex-1 min-w-0">
                <div className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] uppercase tracking-widest text-stone-400">
                  <span>
                    {n.ideas} ideas · {n.quotes} quotes · {n.facts} leads
                  </span>
                  {n.source_count !== null ? (
                    <>
                      <span>·</span>
                      <span>
                        {n.source_count} {n.source_count === 1 ? "source" : "sources"}
                      </span>
                    </>
                  ) : null}
                  {n.tags.length > 0 ? (
                    <>
                      <span>·</span>
                      {n.tags.map((tag) => (
                        <TagChip key={tag} tag={tag} />
                      ))}
                    </>
                  ) : null}
                </div>
                <div className="line-clamp-2 text-sm font-medium text-stone-900">{n.topic}</div>
                <div className="mt-1 text-[11px] text-stone-500">{relativeTime(n.created_at)}</div>
              </Link>
              <div className="flex flex-col items-end gap-2 shrink-0">
                {isStale ? <StaleChip /> : null}
                <Link
                  href={`/editor/${n.id}`}
                  className="rounded border border-stone-200 px-2 py-1 text-[11px] text-stone-600 transition hover:bg-stone-50"
                >
                  Open notebook
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
              </div>
            </div>
          </Card>
        );
      })}
    </section>
  );
}

function SentSection({ sent }: { sent: SentRow[] }) {
  if (sent.length === 0) {
    return (
      <p className="text-[12px]" style={{ color: "var(--fg-subtle)" }}>
        Nothing sent yet.
      </p>
    );
  }

  return (
    <section>
      {sent.map((s) => (
        <div key={s.id} className="fp-sent-row">
          <div className="ttl line-clamp-1">
            <Link href={`/editor/${s.id}`} className="hover:underline" style={{ color: "inherit" }}>
              {s.headline}
            </Link>
          </div>
          <div className="meta shrink-0">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span>sent {relativeTime(s.sent_at)}</span>
              <span>·</span>
              <span>
                {s.outlet_display_name ??
                  (s.outlet_base_url ? hostFromUrl(s.outlet_base_url) : "no outlet")}
              </span>
              {s.source_count !== null ? (
                <>
                  <span>·</span>
                  <span>
                    {s.source_count} {s.source_count === 1 ? "source" : "sources"}
                  </span>
                </>
              ) : null}
              {s.tags.length > 0 ? (
                <>
                  <span>·</span>
                  {s.tags.map((tag) => (
                    <TagChip key={tag} tag={tag} />
                  ))}
                </>
              ) : null}
            </div>
          </div>
          <div className="shrink-0 flex items-center gap-3 text-[11px]">
            {s.wp_edit_link ? (
              <a
                href={s.wp_edit_link}
                target="_blank"
                rel="noreferrer"
                className="font-medium hover:underline"
                style={{ color: "var(--indigo)" }}
              >
                Open in WP
              </a>
            ) : null}
          </div>
        </div>
      ))}
    </section>
  );
}

function TagChip({ tag }: { tag: string }) {
  return (
    <span className="inline-flex items-center rounded-sm border border-stone-200 bg-stone-50 px-1.5 py-0.5 text-[10px] text-stone-500">
      {tag}
    </span>
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

function parseTags(raw: string | null): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 3);
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
