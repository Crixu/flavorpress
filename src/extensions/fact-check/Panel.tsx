"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { setActive, setSlice, useActiveSelection, useExtensionSlice } from "../store";
import type { ClientExtensionEntry, ExtensionAnnotation, ExtensionPanelProps } from "../types";
import {
  applyFactCheckFixAction,
  clearFactCheckAction,
  runFactCheckAction,
  suggestFactCheckFixAction,
} from "./actions";
import { FACT_CHECK_ID, FACT_CHECK_LABEL } from "./types";

interface ClaimSuggestion {
  original: string;
  replacement: string;
  rationale: string;
}

const TONE_DOT: Record<ExtensionAnnotation["tone"], string> = {
  positive: "var(--emerald)",
  negative: "var(--rose)",
  neutral: "var(--amber)",
};

function FactCheckPanel({ draftId }: ExtensionPanelProps) {
  const router = useRouter();
  const slice = useExtensionSlice(draftId, FACT_CHECK_ID);
  const active = useActiveSelection(draftId);
  const [, startTransition] = useTransition();
  const [suggestingId, setSuggestingId] = useState<string | null>(null);
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<Record<string, ClaimSuggestion>>({});
  const [errorByClaim, setErrorByClaim] = useState<Record<string, string>>({});

  const isRunning = slice.status === "running";
  const annotations = slice.annotations;

  function handleRun() {
    setSlice(draftId, FACT_CHECK_ID, { status: "running", error: null });
    startTransition(async () => {
      const fd = new FormData();
      fd.set("draftId", draftId);
      const res = await runFactCheckAction(fd);
      if (res.ok) {
        setSlice(draftId, FACT_CHECK_ID, {
          annotations: res.annotations,
          ranAt: res.ranAt,
          status: "idle",
          error: null,
        });
        if (res.annotations[0]) {
          setActive(draftId, {
            extensionId: FACT_CHECK_ID,
            annotationId: res.annotations[0].id,
          });
        }
      } else {
        setSlice(draftId, FACT_CHECK_ID, {
          status: "error",
          error: res.error,
        });
      }
    });
  }

  function handleClear() {
    startTransition(async () => {
      const fd = new FormData();
      fd.set("draftId", draftId);
      await clearFactCheckAction(fd);
      setSlice(draftId, FACT_CHECK_ID, {
        annotations: [],
        ranAt: null,
        status: "idle",
        error: null,
      });
      if (active?.extensionId === FACT_CHECK_ID) setActive(draftId, null);
    });
  }

  function clearError(id: string) {
    setErrorByClaim((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }

  function handleSuggest(annotationId: string) {
    if (suggestingId || applyingId) return;
    setSuggestingId(annotationId);
    clearError(annotationId);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("draftId", draftId);
      fd.set("claimId", annotationId);
      const res = await suggestFactCheckFixAction(fd);
      if (res.ok) {
        setSuggestions((prev) => ({
          ...prev,
          [annotationId]: {
            original: res.original,
            replacement: res.replacement,
            rationale: res.rationale,
          },
        }));
      } else {
        setErrorByClaim((prev) => ({ ...prev, [annotationId]: res.error }));
      }
      setSuggestingId(null);
    });
  }

  function handleApply(annotationId: string) {
    const suggestion = suggestions[annotationId];
    if (!suggestion || applyingId || suggestingId) return;
    setApplyingId(annotationId);
    clearError(annotationId);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("draftId", draftId);
      fd.set("claimId", annotationId);
      fd.set("original", suggestion.original);
      fd.set("replacement", suggestion.replacement);
      const res = await applyFactCheckFixAction(fd);
      if (res.ok) {
        setSlice(draftId, FACT_CHECK_ID, {
          annotations: res.annotations,
          ranAt: res.ranAt,
          status: "idle",
          error: null,
        });
        setSuggestions((prev) => {
          const next = { ...prev };
          delete next[annotationId];
          return next;
        });
        if (active?.extensionId === FACT_CHECK_ID && active.annotationId === annotationId) {
          setActive(draftId, null);
        }
        // Refresh so the rewritten body re-renders in the article overlay.
        router.refresh();
      } else {
        setErrorByClaim((prev) => ({ ...prev, [annotationId]: res.error }));
      }
      setApplyingId(null);
    });
  }

  function handleDismiss(annotationId: string) {
    setSuggestions((prev) => {
      if (!(annotationId in prev)) return prev;
      const next = { ...prev };
      delete next[annotationId];
      return next;
    });
    clearError(annotationId);
  }

  function handleJump(annotationId: string) {
    setActive(draftId, { extensionId: FACT_CHECK_ID, annotationId });
    const mark = document.querySelector(
      `mark[data-fp-ext="${FACT_CHECK_ID}"][data-fp-ann="${cssEscape(annotationId)}"]`,
    ) as HTMLElement | null;
    if (mark) mark.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  return (
    <div
      className="rounded-2xl p-4"
      style={{
        background: "var(--surface)",
        boxShadow: "var(--shadow-xs)",
      }}
    >
      <div className="flex items-center justify-between">
        <div className="fp-eyebrow">{FACT_CHECK_LABEL}</div>
        {slice.ranAt ? (
          <span
            className="text-[10px]"
            style={{ color: "var(--fg-subtle)" }}
            title={new Date(slice.ranAt).toLocaleString()}
          >
            {relativeTime(Date.now() - slice.ranAt)}
          </span>
        ) : null}
      </div>

      {annotations.length === 0 ? (
        <p className="mt-2 text-[11.5px] leading-snug" style={{ color: "var(--fg-muted)" }}>
          Highlights checkable claims in the draft and links a source for each.
        </p>
      ) : (
        <p className="mt-2 text-[11.5px]" style={{ color: "var(--fg-muted)" }}>
          {annotations.length} claim{annotations.length === 1 ? "" : "s"} checked.
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={handleRun}
          disabled={isRunning}
          className="rounded-full px-3 py-1.5 text-[12px]"
          style={{
            background: isRunning ? "var(--bg-subtle)" : "var(--fg)",
            color: isRunning ? "var(--fg-muted)" : "var(--surface)",
            cursor: isRunning ? "wait" : "pointer",
          }}
        >
          {isRunning
            ? "Checking sources…"
            : annotations.length > 0
              ? "Re-run fact-check"
              : "Run fact-check"}
        </button>
        {annotations.length > 0 && !isRunning ? (
          <button
            type="button"
            onClick={handleClear}
            className="text-[11px]"
            style={{ color: "var(--fg-subtle)" }}
          >
            Clear
          </button>
        ) : null}
      </div>

      {slice.error ? (
        <p
          className="mt-3 rounded-lg p-2 text-[11.5px] leading-snug"
          style={{ background: "var(--rose-tint)", color: "#9C4A22" }}
        >
          {slice.error}
        </p>
      ) : null}

      {annotations.length > 0 ? (
        <ul className="mt-4 space-y-2">
          {annotations.map((a) => {
            const isActive = active?.extensionId === FACT_CHECK_ID && active.annotationId === a.id;
            return (
              <li
                key={a.id}
                data-fp-comment={`${FACT_CHECK_ID}:${a.id}`}
                onClick={() => handleJump(a.id)}
                className="cursor-pointer rounded-xl p-3 transition"
                style={{
                  background: isActive ? "var(--bg-subtle)" : "var(--surface)",
                  border: isActive ? "1px solid var(--border-strong)" : "1px solid var(--border)",
                }}
              >
                <div
                  className="flex items-center gap-1.5 text-[10.5px] uppercase tracking-wider"
                  style={{ color: "var(--fg-subtle)" }}
                >
                  <span
                    className="inline-block h-1.5 w-1.5 rounded-full"
                    style={{ background: TONE_DOT[a.tone] }}
                  />
                  <span>{a.title}</span>
                </div>
                <p
                  className="mt-1.5 line-clamp-2 text-[12px] italic leading-snug"
                  style={{
                    color: "var(--fg-muted)",
                    fontFamily: "var(--font-serif), Georgia, serif",
                  }}
                >
                  &ldquo;{a.spanText}&rdquo;
                </p>
                <p className="mt-1.5 text-[12.5px] leading-snug" style={{ color: "var(--fg)" }}>
                  {a.body}
                </p>
                {a.linkUrl ? (
                  <a
                    href={a.linkUrl}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="mt-2 inline-block text-[11.5px] hover:underline"
                    style={{ color: "var(--fg)" }}
                  >
                    {a.linkTitle ?? hostFromUrl(a.linkUrl)} ↗
                  </a>
                ) : null}
                {isFixable(a) ? (
                  <ClaimFixActions
                    annotationId={a.id}
                    suggestion={suggestions[a.id] ?? null}
                    error={errorByClaim[a.id] ?? null}
                    isSuggesting={suggestingId === a.id}
                    isApplying={applyingId === a.id}
                    busy={suggestingId !== null || applyingId !== null}
                    onSuggest={() => handleSuggest(a.id)}
                    onApply={() => handleApply(a.id)}
                    onDismiss={() => handleDismiss(a.id)}
                  />
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

interface ClaimFixActionsProps {
  annotationId: string;
  suggestion: ClaimSuggestion | null;
  error: string | null;
  isSuggesting: boolean;
  isApplying: boolean;
  /** True if any other claim is mid-suggest/apply; disables our buttons. */
  busy: boolean;
  onSuggest: () => void;
  onApply: () => void;
  onDismiss: () => void;
}

function ClaimFixActions({
  suggestion,
  error,
  isSuggesting,
  isApplying,
  busy,
  onSuggest,
  onApply,
  onDismiss,
}: ClaimFixActionsProps) {
  const stop = (handler: () => void) => (e: React.MouseEvent) => {
    e.stopPropagation();
    handler();
  };

  if (!suggestion) {
    return (
      <div className="mt-2.5 flex items-center gap-2">
        <button
          type="button"
          onClick={stop(onSuggest)}
          disabled={busy}
          className="rounded-full px-3 py-1 text-[11.5px]"
          style={{
            background: isSuggesting ? "var(--bg-subtle)" : "var(--fg)",
            color: isSuggesting ? "var(--fg-muted)" : "var(--surface)",
            cursor: !busy ? "pointer" : isSuggesting ? "wait" : "not-allowed",
            opacity: busy && !isSuggesting ? 0.5 : 1,
          }}
        >
          {isSuggesting ? "Drafting fix…" : "Suggest fix"}
        </button>
        {error ? (
          <span className="text-[11px]" style={{ color: "#9C4A22" }}>
            {error}
          </span>
        ) : null}
      </div>
    );
  }

  return (
    <div
      className="mt-3 rounded-lg p-2.5"
      style={{ background: "var(--bg-subtle)", border: "1px solid var(--border)" }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="text-[10.5px] uppercase tracking-wider" style={{ color: "var(--fg-subtle)" }}>
        Suggested rewrite
      </div>
      <p
        className="mt-1.5 text-[12.5px] leading-snug"
        style={{
          color: "var(--fg)",
          fontFamily: "var(--font-serif), Georgia, serif",
        }}
      >
        {stripHtmlForPreview(suggestion.replacement)}
      </p>
      <p className="mt-2 text-[11.5px] leading-snug" style={{ color: "var(--fg-muted)" }}>
        {suggestion.rationale}
      </p>
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={stop(onApply)}
          disabled={busy}
          className="rounded-full px-3 py-1 text-[11.5px]"
          style={{
            background: isApplying ? "var(--bg-subtle)" : "var(--fg)",
            color: isApplying ? "var(--fg-muted)" : "var(--surface)",
            cursor: !busy ? "pointer" : isApplying ? "wait" : "not-allowed",
            opacity: busy && !isApplying ? 0.5 : 1,
          }}
        >
          {isApplying ? "Applying…" : "Apply to draft"}
        </button>
        <button
          type="button"
          onClick={stop(onSuggest)}
          disabled={busy}
          className="text-[11px]"
          style={{ color: "var(--fg-subtle)" }}
        >
          {isSuggesting ? "Trying again…" : "Try again"}
        </button>
        <button
          type="button"
          onClick={stop(onDismiss)}
          disabled={busy}
          className="text-[11px]"
          style={{ color: "var(--fg-subtle)" }}
        >
          Dismiss
        </button>
      </div>
      {error ? (
        <p className="mt-2 text-[11px]" style={{ color: "#9C4A22" }}>
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Render the suggestion as plain text in the panel preview. The full
 * replacement_html still lands in the body on Apply, but the panel
 * lives outside the article's serif column and shouldn't pull in
 * arbitrary inline tags via dangerouslySetInnerHTML.
 */
function stripHtmlForPreview(html: string): string {
  return html
    .replace(/<\s*br\s*\/?>/gi, " ")
    .replace(/<\/(p|h\d|li|blockquote)>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isFixable(a: ExtensionAnnotation): boolean {
  // Supported claims (positive tone) need no rewrite. Disputed (negative)
  // and unverified (neutral) are the actionable ones.
  return a.tone !== "positive";
}

export const factCheckClientEntry: ClientExtensionEntry = {
  id: FACT_CHECK_ID,
  label: FACT_CHECK_LABEL,
  Panel: FactCheckPanel,
};

function hostFromUrl(s: string): string {
  try {
    return new URL(s).host;
  } catch {
    return s;
  }
}

function relativeTime(diffMs: number): string {
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}

function cssEscape(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }
  return value.replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`);
}
