/**
 * Researcher mode editor view. The user writes their own post in their
 * own surface (WordPress, an editor, paper); we show notes — angles,
 * verbatim quotes, concrete facts — that they can mine. No headline
 * picker, no voice match, no push-to-WordPress; this artefact is meant
 * to be read alongside the writer's own draft, not turned into one.
 */

import Link from "next/link";
import { deleteDraftAction } from "@/lib/v1/actions";
import type {
  ResearchFact,
  ResearchIdea,
  ResearchNotes,
  ResearchQuote,
} from "@/lib/v1/researcher-generator";
import { SendResearchToWpForm } from "./SendResearchToWpForm";

interface SourceRow {
  id: string;
  title: string;
  display_name: string | null;
  source_url: string;
  published_at: number;
}

interface Props {
  draftId: string;
  topic: string;
  notes: ResearchNotes;
  sources: SourceRow[];
  traceId: string;
  sourceCount: number;
  wpEditLink: string | null;
}

export function ResearcherView({
  draftId,
  topic,
  notes,
  sources,
  traceId,
  sourceCount,
  wpEditLink,
}: Props) {
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
            <span>Research notes</span>
            <span className="mx-2" style={{ color: "var(--border-strong)" }}>
              ·
            </span>
            <span>{sourceCount} sources</span>
          </div>
          <h1 className="fp-h1 fp-h1-serif" style={{ maxWidth: "26ch" }}>
            {topic}
          </h1>
          <p className="text-sm" style={{ color: "var(--fg-muted)", maxWidth: "60ch" }}>
            Raw material to write from. Pick an angle, lift a verbatim quote, chase a lead. Quotes
            are checked against the source text; leads are claims to verify before you use them.
          </p>
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
          {wpEditLink ? (
            <a href={wpEditLink} target="_blank" rel="noreferrer" className="fp-btn fp-btn-primary">
              Open in WordPress →
            </a>
          ) : (
            <SendResearchToWpForm
              draftId={draftId}
              topic={topic}
              className="fp-btn fp-btn-primary"
              pendingLabel="Saving draft"
            >
              Draft in WordPress →
            </SendResearchToWpForm>
          )}
        </div>
      </header>

      <div
        className="overflow-hidden"
        style={{
          background: "var(--surface)",
          borderRadius: "var(--radius-xl)",
          boxShadow: "var(--shadow-sm)",
        }}
      >
        <div
          className="flex flex-wrap items-center gap-3 px-6 py-3"
          style={{ borderBottom: "1px solid var(--border)" }}
        >
          <span className="fp-eyebrow">Researcher</span>
          <span
            className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-[12px]"
            style={{
              background: "var(--bg-subtle)",
              color: "var(--fg-muted)",
            }}
          >
            <span style={{ fontWeight: 600 }}>
              {notes.ideas.length} ideas · {notes.quotes.length} quotes · {notes.facts.length} leads
            </span>
          </span>
        </div>

        <div className="grid grid-cols-12">
          <aside
            className="col-span-12 p-5 lg:col-span-3"
            style={{
              background: "#FAF7F1",
              borderRight: "1px solid var(--border)",
            }}
          >
            <header
              className="mb-4 flex items-baseline justify-between gap-2 pb-3"
              style={{ borderBottom: "1px solid var(--border)" }}
            >
              <div className="flex items-baseline gap-2.5">
                <span
                  aria-hidden
                  className="inline-block h-2.5 w-2.5 translate-y-[1px] rounded-full"
                  style={{ background: "var(--fg-subtle)" }}
                />
                <span className="fp-eyebrow">Sources</span>
                <span
                  className="rounded-full px-2 py-0.5 font-mono text-[10.5px]"
                  style={{ background: "var(--surface)", color: "var(--fg-muted)" }}
                >
                  {sources.length}
                </span>
              </div>
            </header>
            <p
              className="-mt-2 mb-3 text-[11.5px] leading-snug"
              style={{ color: "var(--fg-subtle)" }}
            >
              Where the notes came from. Open one to read the original.
            </p>
            <ul className="space-y-2 text-xs">
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
                  <div
                    className="mt-0.5 font-mono text-[10px]"
                    style={{ color: "var(--fg-subtle)" }}
                  >
                    {relativeTime(row.published_at)}
                  </div>
                  <div
                    className="mt-1.5 line-clamp-3 leading-snug"
                    style={{ color: "var(--fg-muted)" }}
                  >
                    {row.title}
                  </div>
                </li>
              ))}
            </ul>
          </aside>

          <div className="col-span-12 px-10 pt-10 pb-16 lg:col-span-9">
            <div className="mx-auto max-w-[760px] space-y-10">
              <IdeasSection ideas={notes.ideas} />
              <QuotesSection quotes={notes.quotes} />
              <FactsSection facts={notes.facts} />

              <div
                className="flex flex-wrap items-center justify-between gap-3 pt-6"
                style={{ borderTop: "1px solid var(--border)" }}
              >
                <p className="text-[12px]" style={{ color: "var(--fg-subtle)" }}>
                  Done with these notes? Delete to keep your drafts list tidy.
                </p>
                <form action={deleteDraftAction}>
                  <input type="hidden" name="draftId" value={draftId} />
                  <input type="hidden" name="redirectTo" value="/drafts" />
                  <button
                    type="submit"
                    className="text-[12px] hover:underline"
                    style={{ color: "var(--fg-subtle)" }}
                  >
                    Delete notes
                  </button>
                </form>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function SectionHeader({
  label,
  count,
  description,
  dotColor,
}: {
  label: string;
  count: number;
  description: string;
  dotColor: string;
}) {
  return (
    <header
      className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 pb-3"
      style={{ borderBottom: "1px solid var(--border)" }}
    >
      <div className="flex items-baseline gap-2.5">
        <span
          aria-hidden
          className="inline-block h-2.5 w-2.5 translate-y-[1px] rounded-full"
          style={{ background: dotColor }}
        />
        <span className="fp-eyebrow">{label}</span>
        <span
          className="rounded-full px-2 py-0.5 font-mono text-[10.5px]"
          style={{ background: "var(--bg-subtle)", color: "var(--fg-muted)" }}
        >
          {count}
        </span>
      </div>
      <p className="text-[12px]" style={{ color: "var(--fg-subtle)", maxWidth: "40ch" }}>
        {description}
      </p>
    </header>
  );
}

function IdeasSection({ ideas }: { ideas: ResearchIdea[] }) {
  if (ideas.length === 0) return null;
  return (
    <section className="space-y-4">
      <SectionHeader
        label="Ideas"
        count={ideas.length}
        description="Angles you might take. Pick one to write from."
        dotColor="#9C4A22"
      />
      <ul className="space-y-3">
        {ideas.map((idea, i) => (
          <li
            key={i}
            className="rounded-2xl p-4"
            style={{
              background: "var(--rose-tint)",
              color: "#9C4A22",
            }}
          >
            <div className="text-[14px] font-semibold leading-snug">{idea.angle}</div>
            {idea.rationale ? (
              <div className="mt-1 text-[12.5px] leading-snug">{idea.rationale}</div>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

function QuotesSection({ quotes }: { quotes: ResearchQuote[] }) {
  if (quotes.length === 0) return null;
  return (
    <section className="space-y-4">
      <SectionHeader
        label="Quotes"
        count={quotes.length}
        description="Verbatim from the source. Lift with attribution."
        dotColor="var(--fg-muted)"
      />
      <ul className="space-y-3">
        {quotes.map((q, i) => (
          <li
            key={i}
            className="rounded-2xl p-4"
            style={{
              background: "var(--bg-subtle)",
              fontFamily: "var(--font-serif), Georgia, serif",
            }}
          >
            <blockquote className="text-[15px] leading-relaxed" style={{ color: "var(--fg)" }}>
              &ldquo;{q.text}&rdquo;
            </blockquote>
            <div
              className="mt-2 text-[12px]"
              style={{ color: "var(--fg-muted)", fontFamily: "inherit" }}
            >
              {q.speaker ? `${q.speaker} · ` : ""}
              <a href={q.sourceUrl} target="_blank" rel="noreferrer" className="hover:underline">
                {hostFromUrl(q.sourceUrl)}
              </a>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function FactsSection({ facts }: { facts: ResearchFact[] }) {
  if (facts.length === 0) return null;
  return (
    <section className="space-y-4">
      <SectionHeader
        label="Leads"
        count={facts.length}
        description="Paraphrased; verify against the source before publishing."
        dotColor="var(--border-strong)"
      />
      <ul className="space-y-2">
        {facts.map((f, i) => (
          <li
            key={i}
            className="rounded-xl p-3 text-[13.5px] leading-snug"
            style={{
              background: "var(--surface)",
              border: "1px solid var(--border)",
            }}
          >
            <span style={{ color: "var(--fg)" }}>{f.text}</span>{" "}
            <a
              href={f.sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="text-[12px] hover:underline"
              style={{ color: "var(--fg-subtle)" }}
              title="Open the cited source to verify this lead"
            >
              verify ↗
            </a>
          </li>
        ))}
      </ul>
    </section>
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
