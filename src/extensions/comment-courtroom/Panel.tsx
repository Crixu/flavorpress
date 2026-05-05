"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import type { ClientExtensionEntry, ExtensionPanelProps } from "../types";
import {
  clearCommentCourtroomAction,
  loadCommentCourtroomAction,
  runCommentCourtroomAction,
  type CourtroomPayload,
} from "./actions";
import {
  COMMENT_COURTROOM_ID,
  COMMENT_COURTROOM_LABEL,
  PERSONAS,
  type CourtroomComment,
} from "./types";

interface PanelState {
  comments: CourtroomComment[];
  ranAt: number | null;
  status: "loading" | "idle" | "running" | "error";
  error: string | null;
}

const INITIAL_STATE: PanelState = {
  comments: [],
  ranAt: null,
  status: "loading",
  error: null,
};

interface ThreadNode {
  comment: CourtroomComment;
  children: ThreadNode[];
}

function buildThread(comments: CourtroomComment[]): ThreadNode[] {
  // Comments are persisted flat in `sort_order`; that order already
  // groups each parent with its descendants because of the depth-first
  // walk on the way in. Group children by parent_id so the panel can
  // render nesting without a recursive DB lookup.
  const byParent = new Map<string | null, CourtroomComment[]>();
  for (const c of comments) {
    const list = byParent.get(c.parentId) ?? [];
    list.push(c);
    byParent.set(c.parentId, list);
  }
  function build(parentId: string | null): ThreadNode[] {
    return (byParent.get(parentId) ?? []).map((comment) => ({
      comment,
      children: build(comment.id),
    }));
  }
  return build(null);
}

function CommentCourtroomPanel({ draftId }: ExtensionPanelProps) {
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
      const res = await loadCommentCourtroomAction(fd);
      if (cancelled) return;
      if (res.ok) {
        setState({
          comments: res.payload.comments,
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

  function applyPayload(payload: CourtroomPayload) {
    setState({
      comments: payload.comments,
      ranAt: payload.ranAt,
      status: "idle",
      error: null,
    });
  }

  function handleRun() {
    setState((s) => ({ ...s, status: "running", error: null }));
    startTransition(async () => {
      const fd = new FormData();
      fd.set("draftId", draftId);
      const res = await runCommentCourtroomAction(fd);
      if (res.ok) applyPayload(res.payload);
      else setState((s) => ({ ...s, status: "error", error: res.error }));
    });
  }

  function handleClear() {
    startTransition(async () => {
      const fd = new FormData();
      fd.set("draftId", draftId);
      await clearCommentCourtroomAction(fd);
      setState({ comments: [], ranAt: null, status: "idle", error: null });
    });
  }

  const tree = useMemo(() => buildThread(state.comments), [state.comments]);
  const isRunning = state.status === "running";
  const isLoading = state.status === "loading";
  const topLevelCount = tree.length;

  return (
    <div
      className="rounded-2xl p-4"
      style={{ background: "var(--surface)", boxShadow: "var(--shadow-xs)" }}
    >
      <div className="flex items-center justify-between">
        <div className="fp-eyebrow">{COMMENT_COURTROOM_LABEL}</div>
        {state.ranAt ? (
          <span
            className="text-[10px]"
            style={{ color: "var(--fg-subtle)" }}
            title={new Date(state.ranAt).toLocaleString()}
          >
            {relativeTime(now - state.ranAt)}
          </span>
        ) : null}
      </div>

      <p className="mt-2 text-[11.5px] leading-snug" style={{ color: "var(--fg-muted)" }}>
        {isRunning
          ? "Simulating…"
          : topLevelCount === 0
            ? "Simulates a nested comment thread from a fixed jury of reader personas, so you can feel the room before publishing. Nothing is posted anywhere."
            : `${topLevelCount} top-level reaction${topLevelCount === 1 ? "" : "s"} from the simulated jury.`}
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={handleRun}
          disabled={isRunning || isLoading}
          className="rounded-full px-3 py-1.5 text-[12px]"
          style={{
            background: isRunning || isLoading ? "var(--bg-subtle)" : "var(--fg)",
            color: isRunning || isLoading ? "var(--fg-muted)" : "var(--surface)",
            cursor: isRunning ? "wait" : isLoading ? "default" : "pointer",
          }}
        >
          {isRunning
            ? "Simulating…"
            : isLoading
              ? "Loading…"
              : topLevelCount > 0
                ? "Run again"
                : "Simulate comments"}
        </button>
        {topLevelCount > 0 && !isRunning ? (
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

      {isRunning && topLevelCount === 0 ? (
        <ul aria-hidden className="mt-4 space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <li
              key={i}
              className="rounded-xl p-3"
              style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
            >
              <div
                className="h-2.5 w-1/3 animate-pulse rounded-full"
                style={{ background: "var(--bg-subtle)" }}
              />
              <div
                className="mt-2 h-2 w-full animate-pulse rounded-full"
                style={{ background: "var(--bg-subtle)" }}
              />
              <div
                className="mt-1.5 h-2 w-5/6 animate-pulse rounded-full"
                style={{ background: "var(--bg-subtle)" }}
              />
            </li>
          ))}
        </ul>
      ) : null}

      {topLevelCount > 0 ? (
        <ul className="mt-4 space-y-2.5">
          {tree.map((node) => (
            <CommentNode key={node.comment.id} node={node} />
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function CommentNode({ node }: { node: ThreadNode }) {
  const persona = PERSONAS[node.comment.personaKey];
  const indent = Math.min(node.comment.depth, 2);
  return (
    <li
      className="rounded-xl p-3"
      style={{
        marginLeft: indent === 0 ? 0 : indent * 14,
        background: "var(--surface)",
        border: "1px solid var(--border)",
      }}
    >
      <div
        className="flex items-center gap-1.5 text-[10.5px] uppercase tracking-wider"
        style={{ color: "var(--fg-subtle)" }}
      >
        <span
          className="inline-block h-1.5 w-1.5 rounded-full"
          style={{ background: "var(--fg-subtle)" }}
        />
        <span>{persona?.label ?? node.comment.personaKey}</span>
      </div>
      <p
        className="mt-1.5 text-[12.5px] leading-snug"
        style={{
          color: "var(--fg)",
          fontFamily: "var(--font-serif), Georgia, serif",
        }}
      >
        {node.comment.body}
      </p>
      {node.children.length > 0 ? (
        <ul className="mt-2.5 space-y-2.5">
          {node.children.map((child) => (
            <CommentNode key={child.comment.id} node={child} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

export const commentCourtroomClientEntry: ClientExtensionEntry = {
  id: COMMENT_COURTROOM_ID,
  label: COMMENT_COURTROOM_LABEL,
  Panel: CommentCourtroomPanel,
};

function relativeTime(diffMs: number): string {
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}
