/**
 * Receipt view for a draft that has been sent to WordPress. The editor
 * is intentionally gone: the act of pushing is one-way, and editing now
 * lives in WordPress. The user lands here when they navigate back to a
 * sent draft to remember what they shipped, link to it, or prune the
 * local record.
 */

import Link from "next/link";
import { ConfirmDeleteButton } from "./ConfirmDeleteButton";

interface ReceiptSource {
  id: string;
  title: string;
  display_name: string | null;
  source_url: string;
  published_at: number;
}

interface ReceiptQuote {
  text: string;
  citation: string;
}

interface Props {
  draftId: string;
  headline: string;
  bodyHtml: string;
  sentAt: number;
  wpEditLink: string;
  sources: ReceiptSource[];
  quotes: ReceiptQuote[];
  sourceCount: number;
}

const BODY_PREVIEW_WORDS = 150;

export function ReceiptView({
  draftId,
  headline,
  bodyHtml,
  sentAt,
  wpEditLink,
  sources,
  quotes,
  sourceCount,
}: Props) {
  const plainBody = stripHtml(bodyHtml);
  const wordCount = plainBody.split(/\s+/).filter(Boolean).length;
  const preview = takeFirstWords(plainBody, BODY_PREVIEW_WORDS);
  const truncated = wordCount > BODY_PREVIEW_WORDS;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1.5">
          <div className="fp-eyebrow">
            <Link href="/" className="hover:underline" style={{ color: "var(--fg-subtle)" }}>
              ← Today
            </Link>
            <span className="mx-2" style={{ color: "var(--border-strong)" }}>
              ·
            </span>
            <span>Receipt</span>
            <span className="mx-2" style={{ color: "var(--border-strong)" }}>
              ·
            </span>
            <span>
              {sourceCount} {sourceCount === 1 ? "source" : "sources"}
            </span>
          </div>
          <h1 className="fp-h1 fp-h1-serif" style={{ maxWidth: "22ch" }}>
            {headline}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <a href={wpEditLink} target="_blank" rel="noreferrer" className="fp-btn fp-btn-primary">
            Open in WordPress ↗
          </a>
        </div>
      </header>

      <article
        className="space-y-4 px-8 py-7"
        style={{
          background: "var(--surface)",
          borderRadius: "var(--radius-xl)",
          boxShadow: "var(--shadow-sm)",
        }}
      >
        <div className="flex flex-wrap items-center gap-3">
          <span className="fp-eyebrow" style={{ color: "var(--emerald, #2F8F66)" }}>
            ✓ Sent to WordPress · {relativeTime(sentAt)}
          </span>
          <span
            className="rounded-full px-2 py-0.5 font-mono text-[10.5px]"
            style={{ background: "var(--bg-subtle)", color: "var(--fg-muted)" }}
          >
            {wordCount} {wordCount === 1 ? "word" : "words"}
          </span>
          <span
            className="rounded-full px-2 py-0.5 font-mono text-[10.5px]"
            style={{ background: "var(--bg-subtle)", color: "var(--fg-muted)" }}
          >
            {quotes.length} {quotes.length === 1 ? "quote" : "quotes"}
          </span>
        </div>
        <h2
          className="fp-h1-serif"
          style={{
            fontSize: "clamp(20px, 2vw, 26px)",
            lineHeight: 1.15,
            letterSpacing: "-0.01em",
            color: "var(--fg)",
            maxWidth: "30ch",
          }}
        >
          {headline}
        </h2>
        <p
          className="text-[14px] leading-relaxed"
          style={{ color: "var(--fg-muted)", maxWidth: "60ch" }}
        >
          {preview}
          {truncated ? "…" : ""}
        </p>
        <p className="text-[12px]" style={{ color: "var(--fg-subtle)" }}>
          Editing happens in WordPress now. This is a record of what you sent.
        </p>
      </article>

      {sources.length > 0 ? (
        <section className="space-y-3">
          <header>
            <div className="fp-eyebrow">Sources used · {sources.length}</div>
          </header>
          <ul className="grid gap-2 sm:grid-cols-2">
            {sources.map((row) => (
              <li
                key={row.id}
                className="rounded-2xl p-3"
                style={{
                  background: "var(--surface)",
                  boxShadow: "var(--shadow-xs)",
                }}
              >
                <a
                  href={row.source_url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[12.5px] font-medium hover:underline"
                  style={{ color: "var(--fg)" }}
                >
                  {row.display_name ?? hostFromUrl(row.source_url)}
                </a>
                <div className="mt-0.5 font-mono text-[10px]" style={{ color: "var(--fg-subtle)" }}>
                  {relativeTime(row.published_at)}
                </div>
                <div
                  className="mt-1.5 line-clamp-3 text-[12px] leading-snug"
                  style={{ color: "var(--fg-muted)" }}
                >
                  {row.title}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {quotes.length > 0 ? (
        <section className="space-y-3">
          <header>
            <div className="fp-eyebrow">Quotes · {quotes.length}</div>
          </header>
          <ol
            className="list-decimal space-y-1.5 pl-5 text-[12px]"
            style={{ color: "var(--fg-muted)" }}
          >
            {quotes.map((q, i) => (
              <li key={i}>{q.citation}</li>
            ))}
          </ol>
        </section>
      ) : null}

      <footer
        className="flex flex-wrap items-center justify-between gap-3 pt-2"
        style={{ borderTop: "1px solid var(--border)" }}
      >
        <p className="pt-3 text-[12px]" style={{ color: "var(--fg-subtle)" }}>
          Done with this record? Removing it here does not affect the post on WordPress.
        </p>
        <ConfirmDeleteButton
          draftId={draftId}
          confirmMessage="Remove this draft record from FlavorPress? The WordPress post is not affected."
          label="Delete from FlavorPress"
        />
      </footer>
    </div>
  );
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function takeFirstWords(s: string, n: number): string {
  const words = s.split(/\s+/);
  if (words.length <= n) return s;
  return words.slice(0, n).join(" ");
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
