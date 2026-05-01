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
import { deleteDraftAction } from "@/lib/v1/actions";
import { loadAllAnnotations } from "@/extensions/server";
import { ExtensionsArticle } from "@/extensions/Article";
import { ExtensionsPanels } from "@/extensions/Panels";
import { HeadlineSelector } from "./HeadlineSelector";
import { PublishToWpForm } from "./PublishToWpForm";

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

  const initialAnnotationsByExt = await loadAllAnnotations(String(d.id));
  const totalAnnotations = Object.values(initialAnnotationsByExt).reduce(
    (n, payload) => n + payload.annotations.length,
    0,
  );

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

  const voiceOk = voiceScore >= 75;
  const sourceCount = cluster ? Number(cluster.source_count) : 0;

  return (
    <div className="space-y-6">
      {/* Page header — same eyebrow + serif h1 pattern as the rest of the app */}
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1.5">
          <div className="fp-eyebrow">
            <Link
              href="/"
              className="hover:underline"
              style={{ color: "var(--fg-subtle)" }}
            >
              ← Today
            </Link>
            <span className="mx-2" style={{ color: "var(--border-strong)" }}>
              ·
            </span>
            <span>Editor</span>
            <span className="mx-2" style={{ color: "var(--border-strong)" }}>
              ·
            </span>
            <span>{sourceCount} sources</span>
          </div>
          <h1 className="fp-h1 fp-h1-serif" style={{ maxWidth: "22ch" }}>
            {String(d.headline)}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <span
            className="hidden rounded-full px-3 py-1.5 font-mono text-[10px] sm:inline"
            style={{
              background: "var(--surface)",
              color: "var(--fg-subtle)",
              border: "1px solid var(--border)",
            }}
            title="Trace ID"
          >
            {traceId.slice(0, 8) || "—"}
          </span>
          {d.wp_edit_link ? (
            <a
              href={String(d.wp_edit_link)}
              target="_blank"
              rel="noreferrer"
              className="fp-btn fp-btn-primary"
            >
              Open in WordPress →
            </a>
          ) : (
            <PublishToWpForm
              draftId={String(d.id)}
              className="fp-btn fp-btn-primary"
              pendingLabel="Saving draft"
            >
              Push to WordPress draft →
            </PublishToWpForm>
          )}
        </div>
      </header>

      {/* Editor frame: a single Canvas card */}
      <div
        className="overflow-hidden"
        style={{
          background: "var(--surface)",
          borderRadius: "var(--radius-xl)",
          boxShadow: "var(--shadow-sm)",
        }}
      >
        {/* Topbar — light, in-card, replaces the old dark decision strip */}
        <div
          className="flex flex-wrap items-center gap-3 px-6 py-3"
          style={{ borderBottom: "1px solid var(--border)" }}
        >
          <span className="fp-eyebrow">Pre-publish</span>
          <span
            className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-[12px]"
            style={{
              background: voiceOk ? "var(--emerald-tint)" : "var(--amber-tint)",
              color: voiceOk ? "#3F7556" : "var(--amber)",
            }}
          >
            <span
              className="inline-block h-1.5 w-1.5 rounded-full"
              style={{
                background: voiceOk ? "var(--emerald)" : "var(--amber)",
              }}
            />
            <span style={{ fontWeight: 600 }}>voice-match {voiceScore}</span>
            <span style={{ opacity: 0.75 }}>
              {voiceOk ? "sounds like you" : "below threshold"}
            </span>
          </span>
          <span
            className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-[12px]"
            style={{
              background: "var(--bg-subtle)",
              color: "var(--fg-muted)",
            }}
          >
            <span style={{ color: "var(--fg-subtle)" }}>⊙</span>
            <span style={{ fontWeight: 600 }}>extensions</span>
            <span style={{ color: "var(--fg-subtle)" }}>
              {totalAnnotations > 0
                ? `${totalAnnotations} annotation${totalAnnotations === 1 ? "" : "s"}`
                : "right rail"}
            </span>
          </span>
          <span className="ml-auto flex items-center gap-2 text-[12px]">
            <span
              className="hidden font-mono tabular text-[11px] md:inline"
              style={{ color: "var(--fg-subtle)" }}
            >
              {String(d.body ?? "").replace(/<[^>]+>/g, " ").trim().split(/\s+/).filter(Boolean).length} words
            </span>
          </span>
        </div>

        {/* Three panes — soft cream rails, white centre, no hard borders */}
        <div className="grid grid-cols-12">
          {/* Left rail */}
          <aside
            className="col-span-12 p-5 lg:col-span-3"
            style={{ background: "#FAF7F1" }}
          >
            <div className="fp-eyebrow mb-3">Sources · {itemsR.rows.length}</div>
            <ul className="space-y-2 text-xs">
              {itemsR.rows.map((row) => (
                <li
                  key={String(row.id)}
                  className="rounded-2xl p-3"
                  style={{
                    background: "var(--surface)",
                    boxShadow: "var(--shadow-xs)",
                  }}
                >
                  <div className="text-[12.5px] font-medium" style={{ color: "var(--fg)" }}>
                    {String(row.display_name ?? hostFromUrl(String(row.source_url)))}
                  </div>
                  <div className="mt-0.5 font-mono text-[10px]" style={{ color: "var(--fg-subtle)" }}>
                    {relativeTime(Number(row.published_at))}
                  </div>
                  <div className="mt-1.5 line-clamp-3 leading-snug" style={{ color: "var(--fg-muted)" }}>
                    {String(row.title)}
                  </div>
                </li>
              ))}
            </ul>
          </aside>

          {/* Centre: manuscript */}
          <div className="col-span-12 px-10 pt-10 pb-16 lg:col-span-6">
            <div className="mx-auto max-w-[640px]">
              <HeadlineSelector
                draftId={String(d.id)}
                headline={String(d.headline)}
                alternates={headlineAlternates}
                locked={Boolean(d.wp_post_id)}
              />

              <ExtensionsArticle
                draftId={String(d.id)}
                bodyHtml={String(d.body ?? "")}
                initialAnnotationsByExt={initialAnnotationsByExt}
              />

              {quotes.length > 0 ? (
                <div
                  className="mt-10 pt-6"
                  style={{ borderTop: "1px solid var(--border)" }}
                >
                  <div className="fp-eyebrow">Citations · {quotes.length}</div>
                  <ol
                    className="mt-3 list-decimal space-y-1.5 pl-5 text-[12px]"
                    style={{ color: "var(--fg-muted)" }}
                  >
                    {quotes.map((q, i) => (
                      <li key={i}>{q.citation}</li>
                    ))}
                  </ol>
                </div>
              ) : null}
            </div>
          </div>

          {/* Right rail: inspector */}
          <aside
            className="col-span-12 space-y-3 p-5 lg:col-span-3"
            style={{ background: "#FAF7F1" }}
          >
            {/* Editor extensions (fact-check, originality, ...) */}
            <ExtensionsPanels
              draftId={String(d.id)}
              initialAnnotationsByExt={initialAnnotationsByExt}
            />

            {/* Voice match */}
            <div
              className="rounded-2xl p-4"
              style={{
                background: "var(--surface)",
                boxShadow: "var(--shadow-xs)",
              }}
            >
              <div className="fp-eyebrow">Voice-match</div>
              <div className="mt-2 flex items-baseline gap-3">
                <span
                  className="font-mono tabular"
                  style={{
                    fontSize: 32,
                    fontWeight: 700,
                    letterSpacing: "-0.03em",
                    color: voiceOk ? "var(--emerald)" : "var(--amber)",
                  }}
                >
                  {voiceScore}
                </span>
                <span className="flex-1">
                  <div
                    className="h-1.5 overflow-hidden rounded-full"
                    style={{ background: "var(--bg-subtle)" }}
                  >
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${Math.min(100, voiceScore)}%`,
                        background: voiceOk
                          ? "var(--emerald)"
                          : "linear-gradient(90deg, var(--rose) 0%, #F5B26A 100%)",
                      }}
                    />
                  </div>
                  <div
                    className="mt-1 text-[10px]"
                    style={{ color: "var(--fg-subtle)" }}
                  >
                    Burrows' Delta on function-word distribution
                  </div>
                </span>
              </div>
              <button
                className="mt-3 w-full rounded-full py-1.5 text-[12px]"
                style={{
                  background: "var(--bg-subtle)",
                  color: "var(--fg)",
                }}
              >
                Voice-tighten regenerate
              </button>
            </div>

            {/* Angle */}
            {d.angle_archive || d.angle_gap ? (
              <div
                className="rounded-2xl p-4"
                style={{
                  background: "var(--surface)",
                  boxShadow: "var(--shadow-xs)",
                }}
              >
                <div className="fp-eyebrow">Angle</div>
                <div className="mt-2 space-y-1.5 text-[12px]">
                  {d.angle_archive ? (
                    <button
                      className="w-full rounded-xl px-3 py-2 text-left"
                      style={{
                        background: "var(--rose-tint)",
                        color: "#9C4A22",
                      }}
                    >
                      <div className="font-semibold">Archive habit</div>
                      <div className="mt-0.5 text-[11px]">
                        {String(d.angle_archive)}
                      </div>
                    </button>
                  ) : null}
                  {d.angle_gap ? (
                    <button
                      className="w-full rounded-xl px-3 py-2 text-left"
                      style={{
                        background: "var(--bg-subtle)",
                        color: "var(--fg)",
                      }}
                    >
                      <div className="font-semibold">Cluster-gap</div>
                      <div
                        className="mt-0.5 text-[11px]"
                        style={{ color: "var(--fg-muted)" }}
                      >
                        {String(d.angle_gap)}
                      </div>
                    </button>
                  ) : null}
                </div>
              </div>
            ) : null}

            {/* Quote pool */}
            {quotes.length > 0 ? (
              <div
                className="rounded-2xl p-4"
                style={{
                  background: "var(--surface)",
                  boxShadow: "var(--shadow-xs)",
                }}
              >
                <div className="fp-eyebrow">
                  Quote pool · {quotes.length} in draft
                </div>
                <ul className="mt-3 space-y-2 text-[12px]">
                  {quotes.map((q, i) => (
                    <li
                      key={i}
                      className="rounded-lg p-2.5 leading-snug"
                      style={{
                        background: "var(--bg-subtle)",
                        color: "var(--fg)",
                        fontFamily: "var(--font-serif), Georgia, serif",
                      }}
                    >
                      {q.text.slice(0, 100)}
                      {q.text.length > 100 ? "…" : ""}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {/* Agent slot — Canvas-styled placeholder */}
            <div
              className="rounded-2xl p-4"
              style={{
                background:
                  "linear-gradient(135deg, var(--plum-tint) 0%, #E9DEF4 100%)",
              }}
            >
              <div className="flex items-center justify-between">
                <div className="fp-eyebrow" style={{ color: "#5D3A6E" }}>
                  Agent slot
                </div>
                <span className="text-[10px]" style={{ color: "#5D3A6E" }}>
                  v1.1+
                </span>
              </div>
              <p
                className="mt-2 text-[11.5px] leading-snug"
                style={{ color: "#3F2360" }}
              >
                Research, scheduling, plagiarism, analytics. Capabilities plug
                in here in v1.1.
              </p>
            </div>

            {/* Publish actions */}
            <div className="space-y-2 pt-1">
              {d.wp_edit_link ? (
                <a
                  href={String(d.wp_edit_link)}
                  target="_blank"
                  rel="noreferrer"
                  className="fp-btn fp-btn-primary w-full"
                  style={{ width: "100%" }}
                >
                  Open in WordPress →
                </a>
              ) : (
                <PublishToWpForm
                  draftId={String(d.id)}
                  className="fp-btn fp-btn-primary w-full"
                  pendingLabel="Saving draft"
                >
                  Push to WordPress draft
                </PublishToWpForm>
              )}
              <button
                className="w-full py-2 text-[12px]"
                style={{ color: "var(--fg-subtle)" }}
              >
                Schedule for later
              </button>
              {!d.wp_post_id ? (
                <form action={deleteDraftAction}>
                  <input type="hidden" name="draftId" value={String(d.id)} />
                  <input type="hidden" name="redirectTo" value="/drafts" />
                  <button
                    type="submit"
                    className="w-full py-2 text-[12px] transition hover:underline"
                    style={{ color: "var(--fg-subtle)" }}
                  >
                    Delete draft
                  </button>
                </form>
              ) : null}
            </div>
          </aside>
        </div>
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
