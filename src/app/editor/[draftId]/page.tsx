/**
 * Editor view. Pre-rendered draft body, 2-cell Decision Strip
 * (voice-match + fact-check per engineer review), right rail with angle
 * picker, voice-tighten, originality, quote pool, agent slot stub.
 *
 * v1 alpha renders the loaded draft read-only; the inline editor (debounced
 * voice-match re-score + voice-tighten regenerate) ships in week 2.
 */

import Link from "next/link";
import { notFound } from "next/navigation";
import { ensureSchema, SINGLE_USER_ID, db } from "@/lib/db";
import { publishDraftToWPAction } from "@/lib/v1/actions";
import { SubmitButton } from "@/app/_components/SubmitButton";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ draftId: string }>;
}

export default async function EditorPage({ params }: PageProps) {
  await ensureSchema();
  const { draftId } = await params;

  const r = await db.execute({
    sql: `SELECT * FROM drafts WHERE id = ? AND user_id = ?`,
    args: [draftId, SINGLE_USER_ID],
  });
  if (r.rows.length === 0) notFound();
  const d = r.rows[0]!;

  const clusterR = await db.execute({
    sql: `SELECT * FROM clusters WHERE id = ?`,
    args: [String(d.cluster_id)],
  });
  const cluster = clusterR.rows[0];

  const itemsR = await db.execute({
    sql: `SELECT i.*, s.display_name, s.url AS source_url
          FROM items i JOIN sources s ON s.id = i.source_id
          WHERE i.cluster_id = ? ORDER BY i.published_at DESC`,
    args: [String(d.cluster_id)],
  });

  const headlineAlternates = d.headline_alternates
    ? (JSON.parse(String(d.headline_alternates)) as string[])
    : [];
  const quotes = d.quotes
    ? (JSON.parse(String(d.quotes)) as Array<{
        sourceId: string;
        text: string;
        citation: string;
      }>)
    : [];
  const voiceScore = Number(d.voice_match_score ?? 0);
  const traceId = String(d.trace_id ?? "");

  return (
    <div className="-mx-6 -my-10 min-h-[calc(100vh-58px)] bg-white">
      {/* Editor header */}
      <div className="flex items-center justify-between border-b border-stone-200 bg-white px-6 py-2.5">
        <div className="flex items-center gap-3 text-xs text-stone-500">
          <Link href="/" className="rounded px-2 py-1 hover:bg-stone-100 text-stone-700">
            ← Back
          </Link>
          <span className="text-stone-300">|</span>
          <span>
            Cluster · {cluster ? Number(cluster.source_count) : 0} sources
          </span>
          <span className="text-stone-300">|</span>
          <span className="font-mono text-[10px] text-stone-400">{traceId}</span>
        </div>
        <div className="flex items-center gap-2 text-xs">
          {d.wp_edit_link ? (
            <a
              href={String(d.wp_edit_link)}
              target="_blank"
              rel="noreferrer"
              className="rounded bg-indigo-600 px-3 py-1.5 font-medium text-white hover:bg-indigo-700"
            >
              Open in WordPress →
            </a>
          ) : (
            <form action={publishDraftToWPAction}>
              <input type="hidden" name="draftId" value={String(d.id)} />
              <input type="hidden" name="status" value="draft" />
              <SubmitButton
                className="rounded bg-indigo-600 px-3 py-1.5 font-medium text-white hover:bg-indigo-700"
                pendingLabel="Saving draft"
              >
                Push to WordPress as draft →
              </SubmitButton>
            </form>
          )}
        </div>
      </div>

      {/* Decision Strip — 2 cells per engineer review */}
      <div className="bg-stone-900 px-6 py-3 text-white">
        <div className="flex items-center gap-3 text-sm">
          <span className="text-[10px] uppercase tracking-wider text-stone-500">
            Pre-publish
          </span>
          <span
            className={`flex items-center gap-2 rounded border px-3 py-1.5 text-xs ${
              voiceScore >= 75
                ? "border-emerald-700 bg-emerald-900"
                : "border-amber-700 bg-amber-900"
            }`}
          >
            <span className={voiceScore >= 75 ? "text-emerald-300" : "text-amber-300"}>●</span>
            <span className="text-stone-400">voice-match</span>
            <span className={`font-medium ${voiceScore >= 75 ? "text-emerald-300" : "text-amber-300"}`}>
              {voiceScore}
            </span>
            <span className="text-[10px] text-stone-500">
              {voiceScore >= 75 ? "sounds like you" : "below threshold"}
            </span>
          </span>
          <span className="flex items-center gap-2 rounded border border-stone-700 bg-stone-800 px-3 py-1.5 text-xs">
            <span className="text-stone-400">⊙</span>
            <span className="text-stone-400">fact-check</span>
            <span className="font-medium text-stone-200">v1.1</span>
            <span className="text-[10px] text-stone-500">
              shipping next pass
            </span>
          </span>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-0">
        {/* Left rail: cluster sources */}
        <aside className="col-span-3 border-r border-stone-200 bg-stone-50 p-5">
          <div className="mb-3 text-[11px] uppercase tracking-wider text-stone-500">
            Sources · {itemsR.rows.length}
          </div>
          <div className="space-y-2 text-xs">
            {itemsR.rows.map((row) => (
              <div
                key={String(row.id)}
                className="rounded border border-stone-200 bg-white p-2.5"
              >
                <div className="font-medium text-stone-900">
                  {String(row.display_name ?? hostFromUrl(String(row.source_url)))}
                </div>
                <div className="text-[11px] text-stone-500">
                  {relativeTime(Number(row.published_at))}
                </div>
                <div className="mt-1 text-stone-700 leading-snug line-clamp-3">
                  {String(row.title)}
                </div>
              </div>
            ))}
          </div>
        </aside>

        {/* Center: draft body */}
        <div className="col-span-6 p-8">
          <div className="mx-auto max-w-2xl">
            <div className="mb-2 text-xs text-stone-500">
              Headline · 1 of {headlineAlternates.length + 1}
            </div>
            <h1 className="mb-2 text-2xl font-semibold leading-tight">
              {String(d.headline)}
            </h1>
            {headlineAlternates.length > 0 ? (
              <div className="mb-6 flex flex-wrap gap-2 text-[11px]">
                {headlineAlternates.map((alt, i) => (
                  <button
                    key={i}
                    className="rounded border border-stone-200 px-2 py-0.5 text-stone-600 hover:bg-stone-50"
                  >
                    {alt}
                  </button>
                ))}
              </div>
            ) : null}

            <article
              className="prose prose-stone prose-sm max-w-none"
              dangerouslySetInnerHTML={{ __html: String(d.body ?? "") }}
            />

            {quotes.length > 0 ? (
              <div className="mt-8 border-t border-stone-200 pt-6">
                <div className="mb-2 text-xs uppercase tracking-wider text-stone-500">
                  Citations · {quotes.length}
                </div>
                <ol className="list-decimal list-inside space-y-1 text-xs text-stone-600">
                  {quotes.map((q, i) => (
                    <li key={i}>
                      {q.citation}
                    </li>
                  ))}
                </ol>
              </div>
            ) : null}
          </div>
        </div>

        {/* Right rail */}
        <aside className="col-span-3 border-l border-stone-200 bg-stone-50 p-5">
          <div className="mb-4 rounded-xl border border-stone-200 bg-white p-3">
            <div className="mb-2 text-xs uppercase tracking-wider text-stone-500">
              Voice-match
            </div>
            <div className="flex items-center gap-3">
              <div
                className={`text-3xl font-light tabular-nums ${
                  voiceScore >= 75 ? "text-emerald-600" : "text-amber-600"
                }`}
              >
                {voiceScore}
              </div>
              <div className="flex-1">
                <div className="h-1.5 overflow-hidden rounded bg-stone-100">
                  <div
                    className={`h-full ${voiceScore >= 75 ? "bg-emerald-500" : "bg-amber-500"}`}
                    style={{ width: `${Math.min(100, voiceScore)}%` }}
                  />
                </div>
                <div className="mt-0.5 text-[10px] text-stone-500">
                  Burrows' Delta on function-word distribution
                </div>
              </div>
            </div>
            <button className="mt-2 w-full rounded border border-stone-200 py-1 text-[11px] text-stone-700 hover:bg-stone-50">
              Voice-tighten regenerate
            </button>
          </div>

          <div className="mb-4 rounded-xl border border-stone-200 bg-white p-3">
            <div className="mb-2 text-xs uppercase tracking-wider text-stone-500">
              Angle
            </div>
            <div className="space-y-1.5 text-xs">
              {d.angle_archive ? (
                <button className="w-full rounded border border-indigo-200 bg-indigo-50 px-2 py-1.5 text-left text-indigo-800">
                  <div className="font-medium">Archive habit</div>
                  <div className="text-[10px] text-indigo-600">
                    {String(d.angle_archive)}
                  </div>
                </button>
              ) : null}
              {d.angle_gap ? (
                <button className="w-full rounded border border-stone-200 px-2 py-1.5 text-left hover:bg-stone-50">
                  <div className="font-medium">Cluster-gap</div>
                  <div className="text-[10px] text-stone-500">
                    {String(d.angle_gap)}
                  </div>
                </button>
              ) : null}
            </div>
          </div>

          <div className="mb-4 rounded-xl border border-stone-200 bg-white p-3">
            <div className="mb-2 text-xs uppercase tracking-wider text-stone-500">
              Quote pool · {quotes.length} in draft
            </div>
            <div className="space-y-1 text-[11px]">
              {quotes.map((q, i) => (
                <div
                  key={i}
                  className="border-l-2 border-emerald-400 pl-2 text-stone-700"
                >
                  {q.text.slice(0, 80)}{q.text.length > 80 ? "…" : ""}
                </div>
              ))}
            </div>
          </div>

          <div className="mb-4 rounded-xl border border-dashed border-stone-300 bg-white p-3">
            <div className="mb-2 flex items-center justify-between">
              <div className="text-xs uppercase tracking-wider text-stone-500">
                Agent slot
              </div>
              <span className="text-[10px] text-stone-400">v1.1+</span>
            </div>
            <div className="text-[11px] text-stone-600 leading-snug">
              Capabilities plug in here. Research agent (v1.1) renders primary
              sources. Scheduling, analytics, plagiarism follow in v2.
            </div>
          </div>

          <div className="space-y-2">
            {d.wp_edit_link ? (
              <a
                href={String(d.wp_edit_link)}
                target="_blank"
                rel="noreferrer"
                className="flex w-full items-center justify-center rounded bg-indigo-600 py-2.5 text-sm font-medium text-white hover:bg-indigo-700"
              >
                Open in WordPress →
              </a>
            ) : (
              <form action={publishDraftToWPAction}>
                <input type="hidden" name="draftId" value={String(d.id)} />
                <input type="hidden" name="status" value="draft" />
                <SubmitButton
                  className="w-full rounded bg-indigo-600 py-2.5 text-sm font-medium text-white hover:bg-indigo-700"
                  pendingLabel="Saving draft"
                >
                  Push to WordPress draft
                </SubmitButton>
              </form>
            )}
            <button className="w-full py-1.5 text-xs text-stone-500 hover:text-stone-800">
              Schedule for later
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
}

function hostFromUrl(s: string): string {
  try {
    return new URL(s).host;
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
