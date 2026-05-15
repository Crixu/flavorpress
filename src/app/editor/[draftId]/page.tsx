/**
 * Editor view. Pre-rendered draft body, 2-cell Decision Strip
 * (voice-match + fact-check per engineer review), right rail with angle
 * picker, voice-tighten, originality, quote pool, agent slot stub.
 *
 * v1 alpha renders the loaded draft read-only; the inline editor (debounced
 * voice-match re-score + voice-tighten regenerate) ships in week 2.
 */

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ensureSchema, db } from "@/lib/db";
import { AuthRequiredError, requireSession } from "@/lib/session";
import { deleteDraftAction } from "@/lib/v1/actions";
import { loadAllAnnotations, SERVER_EXTENSIONS } from "@/extensions/server";
import { ExtensionsArticle } from "@/extensions/Article";
import { ExtensionsPanels } from "@/extensions/Panels";
import { getDisabledExtensionIds } from "@/lib/v1/settings";
import type { Notes } from "@/lib/v1/notes-generator";
import { parseResearchBoardState } from "@/lib/v1/research-board";
import { AnglePicker } from "./AnglePicker";
import { HeadlineSelector } from "./HeadlineSelector";
import { LengthPicker } from "./LengthPicker";
import { ParagraphRewriter } from "./ParagraphRewriter";
import { PublishToWpForm } from "./PublishToWpForm";
import { ReceiptView } from "./ReceiptView";
import { NotebookView } from "./NotebookView";
import { SiblingArtifactLink } from "./SiblingArtifactLink";
import { EditorRail } from "./_components/EditorRail";

export const dynamic = "force-dynamic";

// Defensive cap on the cluster-items rail; clusters today hold tens of items,
// but the query has no upstream bound so a runaway cluster would otherwise
// stream the whole table back to the editor.
const EDITOR_CLUSTER_ITEMS_LIMIT = 200;

interface PageProps {
  params: Promise<{ draftId: string }>;
}

export default async function EditorPage({ params }: PageProps) {
  await ensureSchema();
  let session;
  try {
    session = await requireSession();
  } catch (err) {
    if (err instanceof AuthRequiredError) redirect("/login");
    throw err;
  }
  const { draftId } = await params;

  // One round-trip via db.batch. Queries 2-4 derive cluster_id/outlet_id/mode
  // from the drafts row via PK-indexed subqueries; if the draft does not exist
  // those subqueries return NULL and the joined results are empty, which the
  // notFound() check below handles before we read them.
  const [draftR, clusterR, itemsR, siblingR] = await db.batch(
    [
      {
        sql: `SELECT id, mode, cluster_id, outlet_id, wp_post_id, wp_edit_link,
                     quotes, wp_synced_at, edited_at, created_at, body, headline,
                     notes, research_board, headline_alternates, angle_archive, angle_gap,
                     angle_hint, custom_angle
              FROM drafts WHERE id = ? AND user_id = ?`,
        args: [draftId, session.userId],
      },
      {
        sql: `SELECT source_count FROM clusters
              WHERE id = (SELECT cluster_id FROM drafts WHERE id = ? AND user_id = ?)`,
        args: [draftId, session.userId],
      },
      {
        sql: `SELECT i.id, i.title, i.canonical_url, i.published_at,
                     s.display_name, s.url AS source_url, s.kind AS source_kind
              FROM items i JOIN sources s ON s.id = i.source_id
              WHERE i.cluster_id = (SELECT cluster_id FROM drafts WHERE id = ? AND user_id = ?)
              ORDER BY i.published_at DESC
              LIMIT ?`,
        args: [draftId, session.userId, EDITOR_CLUSTER_ITEMS_LIMIT],
      },
      {
        sql: `SELECT id FROM drafts
              WHERE cluster_id = (SELECT cluster_id FROM drafts WHERE id = ? AND user_id = ?)
                AND outlet_id = (SELECT outlet_id FROM drafts WHERE id = ? AND user_id = ?)
                AND user_id = ?
                AND mode = CASE
                  WHEN (SELECT mode FROM drafts WHERE id = ? AND user_id = ?) = 'researcher'
                  THEN 'drafter' ELSE 'researcher' END
              ORDER BY created_at DESC LIMIT 1`,
        args: [
          draftId,
          session.userId,
          draftId,
          session.userId,
          session.userId,
          draftId,
          session.userId,
        ],
      },
    ],
    "read",
  );
  if (draftR.rows.length === 0) notFound();
  const d = draftR.rows[0]!;

  const mode = String(d.mode ?? "drafter") === "researcher" ? "researcher" : "drafter";
  const sourceCount = clusterR.rows[0] ? Number(clusterR.rows[0].source_count) : 0;

  // Lookup the sibling artifact (same cluster + outlet, opposite mode).
  // Used by SiblingArtifactLink to either link to it or commission it.
  const siblingDraftId = siblingR.rows.length > 0 ? String(siblingR.rows[0]!.id) : null;
  const sibling = (
    <SiblingArtifactLink
      clusterId={String(d.cluster_id)}
      outletId={String(d.outlet_id ?? "")}
      currentMode={mode}
      siblingDraftId={siblingDraftId}
      currentDraftId={String(d.id)}
    />
  );

  // Sent drafter drafts render a receipt, not the editor. The push is one-way:
  // editing happens in WordPress now, and this view is a record of what was
  // sent. Notes drafts don't follow this branch; the notes themselves
  // remain useful raw material to mine while writing in WordPress.
  if (mode === "drafter" && d.wp_post_id) {
    const wpEditLink = d.wp_edit_link
      ? String(d.wp_edit_link)
      : await recoverWordPressEditLink(String(d.outlet_id), Number(d.wp_post_id), session.userId);
    const receiptQuotes = d.quotes
      ? (JSON.parse(String(d.quotes)) as Array<{
          sourceId: string;
          text: string;
          citation: string;
        }>)
      : [];
    const sentAt = d.wp_synced_at ? Number(d.wp_synced_at) : Number(d.edited_at ?? d.created_at);
    return (
      <ReceiptView
        draftId={String(d.id)}
        headline={String(d.headline)}
        bodyHtml={String(d.body ?? "")}
        sentAt={sentAt}
        wpEditLink={wpEditLink}
        sources={itemsR.rows.map((row) => ({
          id: String(row.id),
          title: String(row.title),
          display_name: row.display_name === null ? null : String(row.display_name),
          source_url: String(row.canonical_url ?? row.source_url),
          published_at: Number(row.published_at),
          is_manual: String(row.source_kind ?? "") === "manual",
        }))}
        quotes={receiptQuotes.map((q) => ({ text: q.text, citation: q.citation }))}
        sourceCount={sourceCount}
      />
    );
  }

  if (mode === "researcher") {
    const notesRaw = d.notes ? String(d.notes) : null;
    let notes: Notes = {
      topic: String(d.headline ?? "Notes"),
      ideas: [],
      quotes: [],
      facts: [],
    };
    if (notesRaw) {
      try {
        notes = JSON.parse(notesRaw) as Notes;
      } catch {
        // Persisted JSON malformed; fall back to empty notes so the page
        // still renders. The body HTML mirror is the user's escape hatch.
      }
    }
    return (
      <NotebookView
        draftId={String(d.id)}
        clusterId={String(d.cluster_id)}
        topic={notes.topic || String(d.headline ?? "Notes")}
        notes={notes}
        sources={itemsR.rows.map((row) => ({
          id: String(row.id),
          title: String(row.title),
          display_name: row.display_name === null ? null : String(row.display_name),
          // canonical_url is the article URL; s.url is the feed URL and would
          // send the user to /feed/ instead of the post they wanted to read.
          source_url: String(row.canonical_url ?? row.source_url),
          published_at: Number(row.published_at),
          is_manual: String(row.source_kind ?? "") === "manual",
        }))}
        initialBoard={parseResearchBoardState(String(d.research_board ?? ""))}
        sourceCount={sourceCount}
        wpEditLink={d.wp_edit_link ? String(d.wp_edit_link) : null}
        sibling={sibling}
      />
    );
  }

  const [initialAnnotationsByExt, disabledExtensionIds] = await Promise.all([
    loadAllAnnotations(String(d.id)),
    getDisabledExtensionIds(),
  ]);
  const totalAnnotations = Object.values(initialAnnotationsByExt).reduce(
    (n, payload) => n + payload.annotations.length,
    0,
  );
  const enabledExtensionIds = SERVER_EXTENSIONS.map((ext) => ext.id).filter(
    (id) => !disabledExtensionIds.has(id),
  );

  const headlineAlternates = d.headline_alternates
    ? (JSON.parse(String(d.headline_alternates)) as string[])
    : [];
  const quotesRaw = d.quotes
    ? (JSON.parse(String(d.quotes)) as Array<{
        sourceId: string;
        text: string;
        citation: string;
      }>)
    : [];
  const quotes = quotesRaw.map((q) => ({
    sourceId: String(q.sourceId ?? ""),
    text: String(q.text ?? ""),
    citation: String(q.citation ?? ""),
  }));
  const draftWordCount = String(d.body ?? "")
    .replace(/<[^>]+>/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
  return (
    <div className="space-y-6">
      {/* Page header — same eyebrow + serif h1 pattern as the rest of the app */}
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1.5">
          <div className="fp-eyebrow">
            <Link href="/" className="hover:underline" style={{ color: "var(--fg-subtle)" }}>
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
          <PublishToWpForm
            draftId={String(d.id)}
            headline={String(d.headline)}
            className="fp-btn fp-btn-primary"
            pendingLabel="Saving draft"
          >
            Push to WordPress draft →
          </PublishToWpForm>
        </div>
      </header>

      {/* Editor frame: a single Canvas card.
       *  overflow-hidden is intentionally absent: position:sticky on the
       *  rails will not work inside an overflow:hidden ancestor. The inner
       *  panes already use solid backgrounds that respect the card edges. */}
      <div
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
          <span className="ml-auto flex items-center gap-2 text-[12px]">
            <span
              className="hidden font-mono tabular text-[11px] md:inline"
              style={{ color: "var(--fg-subtle)" }}
            >
              {
                String(d.body ?? "")
                  .replace(/<[^>]+>/g, " ")
                  .trim()
                  .split(/\s+/)
                  .filter(Boolean).length
              }{" "}
              words
            </span>
          </span>
        </div>

        {/* Shell: manuscript + tabbed right rail */}
        <div className="fp-editor-shell">
          {/* Manuscript */}
          <main className="fp-editor-manuscript">
            <div className="mx-auto max-w-[640px]">
              <HeadlineSelector
                draftId={String(d.id)}
                headline={String(d.headline)}
                alternates={headlineAlternates}
              />
              <div className="mt-3">{sibling}</div>

              <ExtensionsArticle
                draftId={String(d.id)}
                bodyHtml={String(d.body ?? "")}
                initialAnnotationsByExt={initialAnnotationsByExt}
                enabledExtensionIds={enabledExtensionIds}
                quotes={quotes.map((q) => ({ text: q.text, citation: q.citation }))}
              />
              <ParagraphRewriter draftId={String(d.id)} bodyHtml={String(d.body ?? "")} />

              {quotes.length > 0 ? (
                <div className="mt-10 pt-6" style={{ borderTop: "1px solid var(--border)" }}>
                  <div className="fp-eyebrow">Quotes lifted</div>
                  <ol
                    className="mt-3 list-decimal space-y-2.5 pl-5 text-[12px]"
                    style={{ color: "var(--fg-muted)" }}
                  >
                    {quotes.map((q, i) => {
                      const citationHref = safeCitationHref(q.citation);
                      return (
                        <li key={i}>
                          {q.text ? (
                            <span
                              style={{ color: "var(--fg)", fontStyle: "italic" }}
                            >{`“${q.text}”`}</span>
                          ) : null}
                          {q.text && q.citation ? " " : null}
                          {citationHref ? (
                            <a
                              href={citationHref}
                              target="_blank"
                              rel="noreferrer"
                              className="hover:underline"
                              style={{ color: "var(--fg-subtle)", wordBreak: "break-all" }}
                            >
                              {q.citation}
                            </a>
                          ) : q.citation ? (
                            <span style={{ color: "var(--fg-subtle)", wordBreak: "break-all" }}>
                              {q.citation}
                            </span>
                          ) : null}
                        </li>
                      );
                    })}
                  </ol>
                </div>
              ) : null}
            </div>
          </main>

          {/* Tabbed right rail: Sources / Extensions / Remix */}
          <EditorRail
            sources={itemsR.rows.map((row) => ({
              id: String(row.id),
              title: String(row.title),
              source: String(row.display_name ?? hostFromUrl(String(row.source_url))),
              link: String(row.canonical_url ?? row.source_url),
            }))}
            extensionAnnotationCount={totalAnnotations}
            extensions={
              <ExtensionsPanels
                draftId={String(d.id)}
                initialAnnotationsByExt={initialAnnotationsByExt}
                enabledExtensionIds={enabledExtensionIds}
              />
            }
            remix={
              <div className="space-y-3">
                {d.angle_archive || d.angle_gap ? (
                  <AnglePicker
                    draftId={String(d.id)}
                    archive={d.angle_archive ? String(d.angle_archive) : null}
                    gap={d.angle_gap ? String(d.angle_gap) : null}
                    currentAngle={String(d.angle_hint ?? "")}
                    customAngle={d.custom_angle ? String(d.custom_angle) : null}
                    wordCount={draftWordCount}
                  />
                ) : null}
                <LengthPicker draftId={String(d.id)} currentWordCount={draftWordCount} />
                <p className="text-[11px]" style={{ color: "var(--ink-muted)" }}>
                  Paragraph rewrite buttons appear inline on hover in the manuscript.
                </p>
                <div className="space-y-2 pt-1">
                  <PublishToWpForm
                    draftId={String(d.id)}
                    headline={String(d.headline)}
                    className="fp-btn fp-btn-primary w-full"
                    pendingLabel="Saving draft"
                  >
                    Push to WordPress draft
                  </PublishToWpForm>
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
                </div>
              </div>
            }
          />
        </div>
      </div>
    </div>
  );
}

async function recoverWordPressEditLink(
  outletId: string,
  wpPostId: number,
  userId: string,
): Promise<string> {
  const outletR = await db.execute({
    sql: `SELECT base_url FROM outlets WHERE id = ? AND user_id = ?`,
    args: [outletId, userId],
  });
  const baseUrl = String(outletR.rows[0]?.base_url ?? "").replace(/\/$/, "");
  if (!baseUrl) return "#";
  return `${baseUrl}/wp-admin/post.php?post=${wpPostId}&action=edit`;
}

function hostFromUrl(s: string): string {
  try {
    return new URL(s).host;
  } catch {
    return s;
  }
}

function safeCitationHref(raw: string): string | null {
  const value = raw.trim();
  if (!value || /[\u0000-\u001f\u007f\s]/.test(value)) return null;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? value : null;
  } catch {
    return null;
  }
}
