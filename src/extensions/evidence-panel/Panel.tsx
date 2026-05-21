"use client";

import { useEffect, useState, useTransition } from "react";
import { setActive, setSlice, useActiveSelection, useExtensionSlice } from "../store";
import type { ClientExtensionEntry, ExtensionAnnotation, ExtensionPanelProps } from "../types";
import { clearEvidencePanelAction, runEvidencePanelAction } from "./actions";
import { EVIDENCE_PANEL_ID, EVIDENCE_PANEL_LABEL } from "./types";

const TONE_DOT: Record<ExtensionAnnotation["tone"], string> = {
  positive: "var(--emerald)",
  negative: "var(--rose)",
  neutral: "var(--amber)",
};

export function EvidencePanel({ draftId }: ExtensionPanelProps) {
  const slice = useExtensionSlice(draftId, EVIDENCE_PANEL_ID);
  const active = useActiveSelection(draftId);
  const [now, setNow] = useState(() => Date.now());
  const [, startTransition] = useTransition();
  const annotations = slice.annotations;
  const isRunning = slice.status === "running";

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60000);
    return () => window.clearInterval(id);
  }, []);

  function handleRun() {
    setSlice(draftId, EVIDENCE_PANEL_ID, { status: "running", error: null });
    startTransition(async () => {
      const fd = new FormData();
      fd.set("draftId", draftId);
      const res = await runEvidencePanelAction(fd);
      if (res.ok) {
        setSlice(draftId, EVIDENCE_PANEL_ID, {
          annotations: res.annotations,
          ranAt: res.ranAt,
          status: "idle",
          error: null,
        });
        if (res.annotations[0]) {
          setActive(draftId, {
            extensionId: EVIDENCE_PANEL_ID,
            annotationId: res.annotations[0].id,
          });
        }
      } else {
        setSlice(draftId, EVIDENCE_PANEL_ID, { status: "error", error: res.error });
      }
    });
  }

  function handleClear() {
    startTransition(async () => {
      const fd = new FormData();
      fd.set("draftId", draftId);
      await clearEvidencePanelAction(fd);
      setSlice(draftId, EVIDENCE_PANEL_ID, {
        annotations: [],
        ranAt: null,
        status: "idle",
        error: null,
      });
      if (active?.extensionId === EVIDENCE_PANEL_ID) setActive(draftId, null);
    });
  }

  function handleJump(annotationId: string) {
    setActive(draftId, { extensionId: EVIDENCE_PANEL_ID, annotationId });
    const mark = document.querySelector(
      `mark[data-fp-ext="${EVIDENCE_PANEL_ID}"][data-fp-ann="${cssEscape(annotationId)}"]`,
    ) as HTMLElement | null;
    if (mark) mark.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  const weakCount = annotations.filter((a) => a.tone !== "positive").length;

  return (
    <div
      className="rounded-2xl p-4"
      style={{ background: "var(--surface)", boxShadow: "var(--shadow-xs)" }}
    >
      <div className="flex items-center justify-between">
        <div className="fp-eyebrow">{EVIDENCE_PANEL_LABEL}</div>
        {slice.ranAt ? (
          <span className="text-[10px]" style={{ color: "var(--fg-subtle)" }}>
            {relativeTime(now - slice.ranAt)}
          </span>
        ) : null}
      </div>
      <p className="mt-2 text-[11.5px] leading-snug" style={{ color: "var(--fg-muted)" }}>
        {isRunning
          ? "Checking draft claims against attached sources."
          : annotations.length === 0
            ? "Highlights claims that need stronger source support before publishing."
            : weakCount === 0
              ? `${annotations.length} claims checked. No weak support flagged.`
              : `${weakCount} of ${annotations.length} claims need attention.`}
      </p>
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
          {isRunning ? "Checking…" : annotations.length > 0 ? "Check again" : "Check evidence"}
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
      {isRunning && annotations.length === 0 ? <Skeleton /> : null}
      {annotations.length > 0 ? (
        <ul className="mt-4 space-y-2">
          {annotations.map((a) => {
            const isActive =
              active?.extensionId === EVIDENCE_PANEL_ID && active.annotationId === a.id;
            return (
              <li
                key={a.id}
                data-fp-comment={`${EVIDENCE_PANEL_ID}:${a.id}`}
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

export const evidencePanelClientEntry: ClientExtensionEntry = {
  id: EVIDENCE_PANEL_ID,
  label: EVIDENCE_PANEL_LABEL,
  Panel: EvidencePanel,
};

function Skeleton() {
  return (
    <ul aria-hidden className="mt-4 space-y-2">
      {Array.from({ length: 3 }).map((_, i) => (
        <li key={i} className="rounded-xl p-3" style={{ border: "1px solid var(--border)" }}>
          <div
            className="h-2.5 w-1/3 animate-pulse rounded-full"
            style={{ background: "var(--bg-subtle)" }}
          />
          <div
            className="mt-2 h-2 w-full animate-pulse rounded-full"
            style={{ background: "var(--bg-subtle)" }}
          />
          <div
            className="mt-1.5 h-2 w-2/3 animate-pulse rounded-full"
            style={{ background: "var(--bg-subtle)" }}
          />
        </li>
      ))}
    </ul>
  );
}

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
  return `${Math.floor(hr / 24)}d ago`;
}

function cssEscape(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") return CSS.escape(value);
  return value.replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`);
}
