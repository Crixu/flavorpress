"use client";

import { useTransition } from "react";
import { setActive, setSlice, useActiveSelection, useExtensionSlice } from "../store";
import type { ClientExtensionEntry, ExtensionAnnotation, ExtensionPanelProps } from "../types";
import { clearFactCheckAction, runFactCheckAction } from "./actions";
import { FACT_CHECK_ID, FACT_CHECK_LABEL } from "./types";

const TONE_DOT: Record<ExtensionAnnotation["tone"], string> = {
  positive: "var(--emerald)",
  negative: "var(--rose)",
  neutral: "var(--amber)",
};

function FactCheckPanel({ draftId }: ExtensionPanelProps) {
  const slice = useExtensionSlice(draftId, FACT_CHECK_ID);
  const active = useActiveSelection(draftId);
  const [, startTransition] = useTransition();

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
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
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
