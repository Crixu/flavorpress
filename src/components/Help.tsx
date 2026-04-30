"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useCallback, useEffect } from "react";
import { GLOSSARY, listEntries, type GlossaryEntry } from "@/lib/v1/glossary";

/**
 * Inline trigger: a small "?" button next to a term. Pushes ?help=<id>
 * to the URL, which the flyout reads.
 *
 * <HelpTrigger id="trust" /> — bare icon
 * <HelpTrigger id="trust">Trust</HelpTrigger> — wraps text and adds icon
 */
export function HelpTrigger({
  id,
  children,
  className = "",
}: {
  id: string;
  children?: React.ReactNode;
  className?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const entry = GLOSSARY[id];

  const open = useCallback(() => {
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    params.set("help", id);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }, [id, pathname, router, searchParams]);

  if (children) {
    return (
      <span className={`inline-flex items-baseline gap-1 ${className}`}>
        <span>{children}</span>
        <button
          type="button"
          onClick={open}
          aria-label={`Help: ${entry?.term ?? id}`}
          title={entry?.short ?? `Help: ${id}`}
          className="inline-flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-semibold transition hover:scale-110"
          style={{
            background: "var(--bg-subtle)",
            color: "var(--fg-muted)",
            border: "1px solid var(--border)",
          }}
        >
          ?
        </button>
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={open}
      aria-label={`Help: ${entry?.term ?? id}`}
      title={entry?.short ?? `Help: ${id}`}
      className={`inline-flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-semibold transition hover:scale-110 ${className}`}
      style={{
        background: "var(--bg-subtle)",
        color: "var(--fg-muted)",
        border: "1px solid var(--border)",
      }}
    >
      ?
    </button>
  );
}

/**
 * Right-side flyout drawer. Reads ?help=<id> from URL. Renders the matching
 * glossary entry with related links. Closes on ESC, backdrop click, or
 * close button.
 */
export function HelpFlyout() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const helpId = searchParams?.get("help") ?? null;
  const isIndex = helpId === "index";
  const entry: GlossaryEntry | null =
    helpId && !isIndex ? GLOSSARY[helpId] ?? null : null;
  const isOpen = isIndex || entry !== null;

  const close = useCallback(() => {
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    params.delete("help");
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [pathname, router, searchParams]);

  useEffect(() => {
    if (!isOpen) return;
    function handler(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    window.addEventListener("keydown", handler);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", handler);
      document.body.style.overflow = "";
    };
  }, [isOpen, close]);

  if (!isOpen) return null;

  return (
    <div className="fp-help-overlay" role="dialog" aria-labelledby="fp-help-title">
      <button
        type="button"
        className="fp-help-backdrop"
        aria-label="Close help"
        onClick={close}
      />
      <aside className="fp-help-panel">
        <header className="fp-help-header">
          <div className="flex-1 min-w-0">
            <div className="fp-eyebrow">Glossary</div>
            <h2 id="fp-help-title" className="fp-h1-serif text-2xl font-semibold leading-tight">
              {isIndex ? "Every term, defined." : entry!.term}
            </h2>
            <p
              className="mt-1 text-[13px] leading-relaxed"
              style={{ color: "var(--fg-muted)" }}
            >
              {isIndex
                ? "What every signal, score, and capability means in FlavorPress. Tap any entry."
                : entry!.short}
            </p>
          </div>
          <button
            type="button"
            onClick={close}
            aria-label="Close"
            className="ml-3 inline-flex h-8 w-8 items-center justify-center rounded-md transition hover:bg-[color:var(--bg-subtle)]"
          >
            ✕
          </button>
        </header>

        {isIndex ? (
          <div className="fp-help-body">
            <div className="grid gap-2">
              {listEntries().map((e) => (
                <RelatedLink
                  key={e.id}
                  id={e.id}
                  term={e.term}
                  short={e.short}
                  variant="row"
                />
              ))}
            </div>
          </div>
        ) : (
        <div className="fp-help-body">
          {entry!.body.map((p, i) => (
            <p key={i} className="text-sm leading-relaxed">
              {p}
            </p>
          ))}

          {entry!.formula ? (
            <div className="mt-2">
              <div className="fp-eyebrow mb-1.5">Formula</div>
              <pre
                className="whitespace-pre-wrap rounded-md p-3 text-xs leading-relaxed"
                style={{
                  background: "var(--bg-subtle)",
                  border: "1px solid var(--border)",
                  fontFamily:
                    "ui-monospace, SFMono-Regular, Menlo, monospace",
                }}
              >
                {entry!.formula}
              </pre>
            </div>
          ) : null}

          {entry!.example ? (
            <div className="mt-2">
              <div className="fp-eyebrow mb-1.5">Example</div>
              <p
                className="rounded-md p-3 text-[13px] leading-relaxed"
                style={{
                  background: "var(--indigo-tint)",
                  border:
                    "1px solid color-mix(in srgb, var(--indigo) 25%, var(--border))",
                }}
              >
                {entry!.example}
              </p>
            </div>
          ) : null}

          {entry!.appearsIn && entry!.appearsIn.length > 0 ? (
            <div className="mt-2">
              <div className="fp-eyebrow mb-1.5">Appears in</div>
              <div className="flex flex-wrap gap-1.5">
                {entry!.appearsIn.map((a) => (
                  <span key={a} className="fp-chip">
                    {a}
                  </span>
                ))}
              </div>
            </div>
          ) : null}

          {entry!.related && entry!.related.length > 0 ? (
            <div className="mt-3">
              <div className="fp-eyebrow mb-1.5">Related</div>
              <div className="flex flex-wrap gap-1.5">
                {entry!.related.map((rid) => {
                  const r = GLOSSARY[rid];
                  if (!r) return null;
                  return (
                    <RelatedLink key={rid} id={rid} term={r.term} />
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>
        )}

        <footer className="fp-help-footer">
          {isIndex ? (
            <span className="text-xs" style={{ color: "var(--fg-muted)" }}>
              {listEntries().length} terms
            </span>
          ) : (
            <RelatedLink id="index" term="Browse all terms" />
          )}
        </footer>
      </aside>

      <style jsx>{`
        .fp-help-overlay {
          position: fixed;
          inset: 0;
          z-index: 100;
          display: flex;
          justify-content: flex-end;
          animation: fp-help-fadein 200ms var(--ease-out, ease-out);
        }
        .fp-help-backdrop {
          position: absolute;
          inset: 0;
          background: rgba(20, 20, 30, 0.32);
          backdrop-filter: saturate(140%) blur(2px);
          -webkit-backdrop-filter: saturate(140%) blur(2px);
          border: 0;
          padding: 0;
          cursor: pointer;
        }
        .fp-help-panel {
          position: relative;
          width: min(480px, 100vw);
          height: 100%;
          background: var(--surface);
          box-shadow: var(--shadow-lg);
          display: flex;
          flex-direction: column;
          animation: fp-help-slidein 280ms var(--ease, cubic-bezier(0.16, 1, 0.3, 1));
        }
        .fp-help-header {
          display: flex;
          align-items: flex-start;
          padding: 24px 24px 16px;
          border-bottom: 1px solid var(--border);
        }
        .fp-help-body {
          flex: 1;
          overflow-y: auto;
          padding: 20px 24px;
          display: flex;
          flex-direction: column;
          gap: 14px;
        }
        .fp-help-footer {
          padding: 14px 24px;
          border-top: 1px solid var(--border);
          background: var(--bg-subtle);
          display: flex;
          justify-content: flex-end;
        }
        @keyframes fp-help-fadein {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes fp-help-slidein {
          from { transform: translateX(20px); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
        @media (prefers-reduced-motion: reduce) {
          .fp-help-overlay, .fp-help-panel {
            animation-duration: 0ms;
          }
        }
      `}</style>
    </div>
  );
}

function RelatedLink({
  id,
  term,
  short,
  variant = "chip",
}: {
  id: string;
  term: string;
  short?: string;
  variant?: "chip" | "row";
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const navigate = () => {
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    params.set("help", id);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };
  if (variant === "row") {
    return (
      <button
        type="button"
        onClick={navigate}
        className="fp-card fp-card-hover p-3 text-left transition"
        style={{ cursor: "pointer" }}
      >
        <div className="text-sm font-semibold">{term}</div>
        {short ? (
          <div
            className="mt-0.5 text-[12px] leading-relaxed"
            style={{ color: "var(--fg-muted)" }}
          >
            {short}
          </div>
        ) : null}
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={navigate}
      className="fp-chip fp-chip-indigo transition hover:scale-[1.02]"
      style={{ cursor: "pointer" }}
    >
      {term} →
    </button>
  );
}

/**
 * Page-wide help button. Sits in the nav. Opens the glossary index in the
 * flyout. Use `<HelpIndexButton />`.
 */
export function HelpIndexButton() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const open = () => {
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    params.set("help", "index");
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };
  return (
    <button
      type="button"
      onClick={open}
      aria-label="Open glossary"
      title="Glossary"
      className="inline-flex h-7 w-7 items-center justify-center rounded-full text-[12px] font-semibold transition hover:scale-105"
      style={{
        background: "var(--bg-subtle)",
        color: "var(--fg-muted)",
        border: "1px solid var(--border)",
      }}
    >
      ?
    </button>
  );
}
