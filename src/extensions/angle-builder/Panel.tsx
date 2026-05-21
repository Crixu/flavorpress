"use client";

import { useEffect, useState, useTransition } from "react";
import { regenerateDraftAction } from "@/lib/v1/actions";
import type { ExtensionPanelProps } from "../types";
import { clearAngleBuilderAction, loadAngleBuilderAction, runAngleBuilderAction } from "./actions";
import { ANGLE_BUILDER_LABEL, type AngleBuilderKind, type AngleBuilderSuggestion } from "./types";

interface PanelState {
  suggestions: AngleBuilderSuggestion[];
  ranAt: number | null;
  status: "loading" | "idle" | "running" | "regenerating" | "error";
  error: string | null;
}

const INITIAL_STATE: PanelState = {
  suggestions: [],
  ranAt: null,
  status: "loading",
  error: null,
};

const KIND_TONE: Record<AngleBuilderKind, string> = {
  archive: "var(--amber)",
  gap: "var(--rose)",
  stance: "var(--fg)",
  reader: "var(--emerald)",
};

export function AngleBuilderPanel({ draftId }: ExtensionPanelProps) {
  const [state, setState] = useState<PanelState>(INITIAL_STATE);
  const [now, setNow] = useState(() => Date.now());
  const [, startTransition] = useTransition();

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const fd = new FormData();
      fd.set("draftId", draftId);
      const res = await loadAngleBuilderAction(fd);
      if (cancelled) return;
      if (res.ok) {
        setState({
          suggestions: res.payload.suggestions,
          ranAt: res.payload.ranAt,
          status: "idle",
          error: null,
        });
      } else {
        setState((s) => ({ ...s, status: "error", error: res.error }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [draftId]);

  function handleRun() {
    setState((s) => ({ ...s, status: "running", error: null }));
    startTransition(async () => {
      const fd = new FormData();
      fd.set("draftId", draftId);
      const res = await runAngleBuilderAction(fd);
      if (res.ok) {
        setState({
          suggestions: res.payload.suggestions,
          ranAt: res.payload.ranAt,
          status: "idle",
          error: null,
        });
      } else {
        setState((s) => ({ ...s, status: "error", error: res.error }));
      }
    });
  }

  function handleClear() {
    startTransition(async () => {
      const fd = new FormData();
      fd.set("draftId", draftId);
      const res = await clearAngleBuilderAction(fd);
      if (res.ok) setState({ suggestions: [], ranAt: null, status: "idle", error: null });
      else setState((s) => ({ ...s, status: "error", error: res.error }));
    });
  }

  function handleUse(suggestion: AngleBuilderSuggestion) {
    setState((s) => ({ ...s, status: "regenerating", error: null }));
    const fd = new FormData();
    fd.set("draftId", draftId);
    fd.set("angleHint", "custom");
    fd.set("customAngle", `${suggestion.title}: ${suggestion.thesis}`.slice(0, 200));
    startTransition(async () => {
      await regenerateDraftAction(fd);
    });
  }

  const busy = state.status === "running" || state.status === "loading";

  return (
    <div
      className="rounded-2xl p-4"
      style={{ background: "var(--surface)", boxShadow: "var(--shadow-xs)" }}
    >
      <div className="flex items-center justify-between">
        <div className="fp-eyebrow">{ANGLE_BUILDER_LABEL}</div>
        {state.ranAt ? (
          <span className="text-[10px]" style={{ color: "var(--fg-subtle)" }}>
            {relativeTime(now - state.ranAt)}
          </span>
        ) : null}
      </div>
      <p className="mt-2 text-[11.5px] leading-snug" style={{ color: "var(--fg-muted)" }}>
        {state.status === "running"
          ? "Reading the attached sources for stronger framings."
          : state.suggestions.length === 0
            ? "Builds alternate source-grounded angles before you rewrite the draft."
            : `${state.suggestions.length} angles ready. Using one regenerates this draft.`}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={handleRun}
          disabled={busy || state.status === "regenerating"}
          className="rounded-full px-3 py-1.5 text-[12px]"
          style={{
            background: busy ? "var(--bg-subtle)" : "var(--fg)",
            color: busy ? "var(--fg-muted)" : "var(--surface)",
            cursor: busy ? "wait" : "pointer",
          }}
        >
          {state.status === "running"
            ? "Building…"
            : state.status === "loading"
              ? "Loading…"
              : state.suggestions.length > 0
                ? "Build again"
                : "Build angles"}
        </button>
        {state.suggestions.length > 0 && state.status !== "regenerating" ? (
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
      {state.error ? (
        <p
          className="mt-3 rounded-lg p-2 text-[11.5px] leading-snug"
          style={{ background: "var(--rose-tint)", color: "#9C4A22" }}
        >
          {state.error}
        </p>
      ) : null}
      {state.status === "running" && state.suggestions.length === 0 ? <Skeleton /> : null}
      {state.suggestions.length > 0 ? (
        <ul className="mt-4 space-y-2">
          {state.suggestions.map((suggestion) => (
            <li
              key={suggestion.id}
              className="rounded-xl p-3"
              style={{ border: "1px solid var(--border)", background: "var(--surface)" }}
            >
              <div
                className="flex items-center gap-1.5 text-[10.5px] uppercase tracking-wider"
                style={{ color: "var(--fg-subtle)" }}
              >
                <span
                  className="inline-block h-1.5 w-1.5 rounded-full"
                  style={{ background: KIND_TONE[suggestion.kind] }}
                />
                <span>{suggestion.label}</span>
              </div>
              <h3
                className="mt-1.5 text-[13px] font-semibold leading-snug"
                style={{ color: "var(--fg)" }}
              >
                {suggestion.title}
              </h3>
              <p className="mt-1.5 text-[12px] leading-snug" style={{ color: "var(--fg-muted)" }}>
                {suggestion.thesis}
              </p>
              <p className="mt-2 text-[11px] leading-snug" style={{ color: "var(--fg-subtle)" }}>
                {suggestion.sourceCue}
              </p>
              <button
                type="button"
                onClick={() => handleUse(suggestion)}
                disabled={state.status === "regenerating"}
                className="mt-3 rounded-full px-3 py-1 text-[11.5px]"
                style={{
                  background: state.status === "regenerating" ? "var(--bg-subtle)" : "var(--fg)",
                  color: state.status === "regenerating" ? "var(--fg-muted)" : "var(--surface)",
                  cursor: state.status === "regenerating" ? "wait" : "pointer",
                }}
              >
                {state.status === "regenerating" ? "Regenerating…" : "Use this angle"}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

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

function relativeTime(diffMs: number): string {
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}
