/**
 * Researcher mode editor view. The user writes their own post in their
 * own surface (WordPress, an editor, paper); we show notes - angles,
 * verbatim quotes, concrete facts - that they can mine. No headline
 * picker, no voice match, no push-to-WordPress; this artefact is meant
 * to be read alongside the writer's own draft, not turned into one.
 *
 * Layout: single-column notebook (max-width 760px, centered). Three
 * sections stacked - Angles, Quotes, Leads - each with per-section
 * remix controls inline at the bottom. No right rail, no sources rail.
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
import {
  AddSourceForm,
  FlagMismatchButton,
  MoreQuotesButton,
  RemixIdeasButton,
} from "./ResearchActions";

const QUOTE_CAP = 12;

interface SourceRow {
  id: string;
  title: string;
  display_name: string | null;
  source_url: string;
  published_at: number;
}

interface Props {
  draftId: string;
  clusterId: string;
  topic: string;
  notes: ResearchNotes;
  sources: SourceRow[];
  sourceCount: number;
  wpEditLink: string | null;
  sibling?: React.ReactNode;
}

export function ResearcherView({
  draftId,
  clusterId,
  topic,
  notes,
  sources,
  sourceCount,
  wpEditLink,
  sibling,
}: Props) {
  return (
    <article className="fp-researcher-notebook">
      <header className="fp-researcher-h">
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
        <h1 className="fp-researcher-title">{topic}</h1>
        <p className="fp-researcher-lede">
          Raw material to write from. Pick an angle, lift a verbatim quote, chase a lead. Quotes are
          checked against the source text; leads are claims to verify before you use them.
        </p>
        <div className="fp-researcher-header-actions">
          {sibling ? <div>{sibling}</div> : null}
          {wpEditLink ? (
            <a
              href={wpEditLink}
              target="_blank"
              rel="noreferrer"
              className="fp-btn fp-btn-primary"
            >
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

      <section className="fp-researcher-section">
        <h2 className="fp-researcher-section-h">
          <span className="fp-researcher-section-dot" style={{ background: "#9C4A22" }} />
          Angles
          <span className="fp-researcher-section-count">{notes.ideas.length}</span>
        </h2>
        <p className="fp-researcher-section-desc">
          Angles you might take. Pick one to write from.
        </p>
        {notes.ideas.length > 0 ? (
          <ul className="fp-researcher-angles">
            {notes.ideas.map((idea, i) => (
              <IdeasItem key={i} idea={idea} />
            ))}
          </ul>
        ) : (
          <p className="fp-researcher-empty">No angles yet.</p>
        )}
        <div className="fp-researcher-section-actions">
          <RemixIdeasButton draftId={draftId} />
        </div>
      </section>

      <section className="fp-researcher-section">
        <h2 className="fp-researcher-section-h">
          <span className="fp-researcher-section-dot" style={{ background: "var(--fg-muted)" }} />
          Quotes
          <span className="fp-researcher-section-count">{notes.quotes.length}</span>
        </h2>
        <p className="fp-researcher-section-desc">
          Verbatim from the source. Lift with attribution.
        </p>
        {notes.quotes.length > 0 ? (
          <ul className="fp-researcher-quotes">
            {notes.quotes.map((q, i) => (
              <QuoteItem key={i} quote={q} />
            ))}
          </ul>
        ) : (
          <p className="fp-researcher-empty">No quotes yet.</p>
        )}
        <div className="fp-researcher-section-actions">
          <MoreQuotesButton draftId={draftId} atCap={notes.quotes.length >= QUOTE_CAP} />
        </div>
      </section>

      <section className="fp-researcher-section">
        <h2 className="fp-researcher-section-h">
          <span className="fp-researcher-section-dot" style={{ background: "var(--border-strong)" }} />
          Leads
          <span className="fp-researcher-section-count">{notes.facts.length}</span>
        </h2>
        <p className="fp-researcher-section-desc">
          Paraphrased; verify against the source before publishing.
        </p>
        {notes.facts.length > 0 ? (
          <ul className="fp-researcher-facts">
            {notes.facts.map((f, i) => (
              <FactItem key={i} fact={f} />
            ))}
          </ul>
        ) : (
          <p className="fp-researcher-empty">No leads yet.</p>
        )}
      </section>

      <section className="fp-researcher-section">
        <h2 className="fp-researcher-section-h">
          <span
            className="fp-researcher-section-dot"
            style={{ background: "var(--fg-subtle)" }}
          />
          Sources
          <span className="fp-researcher-section-count">{sources.length}</span>
        </h2>
        <p className="fp-researcher-section-desc">
          Where the notes came from. Open one to read the original.
        </p>
        {sources.length > 0 ? (
          <ul className="fp-researcher-sources">
            {sources.map((row) => (
              <SourceItem key={row.id} row={row} />
            ))}
          </ul>
        ) : null}
        <div className="fp-researcher-section-actions">
          <div className="fp-researcher-add-source">
            <p className="fp-researcher-add-source-hint">
              Paste an article URL to widen the input. Then hit Remix or More quotes to pull it
              into the notes.
            </p>
            <AddSourceForm draftId={draftId} clusterId={clusterId} />
          </div>
        </div>
      </section>

      <div className="fp-researcher-footer">
        <p className="fp-researcher-footer-label">Done with these notes? Delete to keep your drafts list tidy.</p>
        <div className="fp-researcher-footer-actions">
          <FlagMismatchButton draftId={draftId} clusterId={clusterId} />
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
    </article>
  );
}

function IdeasItem({ idea }: { idea: ResearchIdea }) {
  return (
    <li className="fp-researcher-angle">
      <div className="fp-researcher-angle-text">{idea.angle}</div>
      {idea.rationale ? (
        <div className="fp-researcher-angle-rationale">{idea.rationale}</div>
      ) : null}
    </li>
  );
}

function QuoteItem({ quote }: { quote: ResearchQuote }) {
  return (
    <li className="fp-researcher-quote">
      <blockquote>
        <p>&ldquo;{quote.text}&rdquo;</p>
      </blockquote>
      <footer>
        <cite>
          {quote.speaker ? `${quote.speaker} · ` : ""}
          <a href={quote.sourceUrl} target="_blank" rel="noreferrer" className="hover:underline">
            {hostFromUrl(quote.sourceUrl)}
          </a>
        </cite>
      </footer>
    </li>
  );
}

function FactItem({ fact }: { fact: ResearchFact }) {
  return (
    <li className="fp-researcher-fact">
      <p>{fact.text}</p>
      <a
        href={fact.sourceUrl}
        target="_blank"
        rel="noreferrer"
        className="hover:underline"
        title="Open the cited source to verify this lead"
      >
        verify ↗
      </a>
    </li>
  );
}

function SourceItem({ row }: { row: SourceRow }) {
  return (
    <li className="fp-researcher-source">
      <a
        href={row.source_url}
        target="_blank"
        rel="noreferrer"
        className="fp-researcher-source-name hover:underline"
      >
        {row.display_name ?? hostFromUrl(row.source_url)}
      </a>
      <div className="fp-researcher-source-meta">{relativeTime(row.published_at)}</div>
      <div className="fp-researcher-source-title">{row.title}</div>
    </li>
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
