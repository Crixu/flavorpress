"use client";

import { useMemo, useState, useTransition } from "react";
import { flushSync } from "react-dom";
import { useRouter } from "next/navigation";
import { dismissClusterAction, pollFolderAction } from "@/lib/v1/actions";
import { ClusterActions } from "./ClusterActions";
import { useBackgroundPolling } from "./useBackgroundPolling";

export interface TodayClusterPreview {
  cluster: {
    id: string;
    formedAt: number;
    firedAt: number | null;
    latestPublishedAt: number;
    sourceCount: number;
    signals: {
      archiveOverlap: number;
      beatMatch: number;
      sourceTrust: number;
      composite: number;
    } | null;
  };
  folder: {
    id: string;
    name: string;
  };
  items: {
    title: string;
    sourceId: string;
    sourceUrl: string;
    displayName: string;
  }[];
  draftsByOutlet: Record<
    string,
    Record<
      "drafter" | "researcher",
      { id: string; voiceMatch: number; wpEditLink: string | null } | null
    >
  >;
  preferredOutletId: string | null;
}

export interface OutletOption {
  id: string;
  displayName: string;
}

export interface TodayFolderStream {
  id: string;
  folderId: string;
  name: string;
  clusters: TodayClusterPreview[];
}

interface Props {
  streams: TodayFolderStream[];
  outlets: OutletOption[];
  defaultOutletId: string | null;
}

const PEEK_COUNT = 2;

export function TodayFolderStreams({ streams, outlets, defaultOutletId }: Props) {
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());
  const [expandedStreams, setExpandedStreams] = useState<Set<string>>(new Set());

  // Filter out optimistically-dismissed clusters but keep the lane visible
  // even when it goes empty: every folder is a reading lane the user
  // declared, so they should always see it. We re-derive on every render
  // so the moment setDismissedIds + a view transition fire, the next paint
  // reflects it.
  const visibleStreams = useMemo(() => {
    return streams.map((stream) => ({
      ...stream,
      clusters: stream.clusters.filter((c) => !dismissedIds.has(c.cluster.id)),
    }));
  }, [streams, dismissedIds]);

  // Lane-level view-transition-name keeps the section in place during a
  // dismiss; cards animate within while the surrounding lane stays anchored.
  // Compact mode kicks in based on lanes with content, not empty placeholders.
  const compact = visibleStreams.filter((s) => s.clusters.length > 0).length > 2;

  // Optimistic dismiss + rollback. The card hides immediately so the user
  // sees feedback while the server action runs; if the action throws (DB
  // error, network blip, etc.), we put the id back so the cluster doesn't
  // appear deleted while the server still has it as 'fired'. Wrapping
  // both directions in startViewTransition keeps the animation symmetric.
  const dismissOptimistically = (id: string) => {
    applyDismissalWithTransition(() =>
      setDismissedIds((prev) => {
        const next = new Set(prev);
        next.add(id);
        return next;
      }),
    );
  };
  const restoreAfterFailure = (id: string) => {
    applyDismissalWithTransition(() =>
      setDismissedIds((prev) => {
        if (!prev.has(id)) return prev;
        const next = new Set(prev);
        next.delete(id);
        return next;
      }),
    );
  };

  return (
    <div className="space-y-6">
      {visibleStreams.map((stream) => {
        const expanded = expandedStreams.has(stream.id);
        const isEmpty = stream.clusters.length === 0;
        const heroPreview = stream.clusters[0];
        const peekPreviews = expanded
          ? stream.clusters.slice(1)
          : stream.clusters.slice(1, 1 + PEEK_COUNT);
        const hiddenCount = expanded ? 0 : Math.max(0, stream.clusters.length - 1 - PEEK_COUNT);

        return (
          <section
            key={stream.id}
            className="space-y-3"
            style={{ viewTransitionName: laneTransitionName(stream.id) }}
          >
            <FolderStreamHeader stream={stream} compact={compact} />
            <div className="space-y-3">
              {isEmpty ? (
                <EmptyStreamRow folderName={stream.name} />
              ) : (
                <ClusterCard
                  key={heroPreview!.cluster.id}
                  preview={heroPreview!}
                  rank={1}
                  isTop
                  outlets={outlets}
                  defaultOutletId={defaultOutletId}
                  onDismiss={dismissOptimistically}
                  onDismissFailed={restoreAfterFailure}
                />
              )}
              {peekPreviews.map((preview, idx) => (
                <PeekRow
                  key={preview.cluster.id}
                  preview={preview}
                  rank={idx + 2}
                  outlets={outlets}
                  defaultOutletId={defaultOutletId}
                  onDismiss={dismissOptimistically}
                  onDismissFailed={restoreAfterFailure}
                />
              ))}
              {hiddenCount > 0 ? (
                <button
                  type="button"
                  className="fp-btn fp-btn-ghost w-full justify-center"
                  onClick={() =>
                    setExpandedStreams((prev) => {
                      const next = new Set(prev);
                      next.add(stream.id);
                      return next;
                    })
                  }
                >
                  Show {hiddenCount} more from {stream.name}
                </button>
              ) : null}
              {expanded && stream.clusters.length > 1 + PEEK_COUNT ? (
                <button
                  type="button"
                  className="fp-btn fp-btn-ghost w-full justify-center"
                  onClick={() =>
                    setExpandedStreams((prev) => {
                      const next = new Set(prev);
                      next.delete(stream.id);
                      return next;
                    })
                  }
                >
                  Collapse {stream.name}
                </button>
              ) : null}
            </div>
          </section>
        );
      })}
    </div>
  );
}

// View transitions API: snapshot the DOM, apply state, animate between.
// Falls through synchronously when the browser doesn't support it (older
// Firefox builds) so behavior degrades to the same instant swap as before.
function applyDismissalWithTransition(apply: () => void) {
  if (
    typeof document !== "undefined" &&
    typeof (document as Document & { startViewTransition?: unknown }).startViewTransition ===
      "function"
  ) {
    (
      document as Document & {
        startViewTransition: (cb: () => void) => unknown;
      }
    ).startViewTransition(() => {
      flushSync(apply);
    });
    return;
  }
  apply();
}

function laneTransitionName(id: string) {
  return `fp-lane-${cssIdent(id)}`;
}

function cardTransitionName(id: string) {
  return `fp-cluster-${cssIdent(id)}`;
}

function cssIdent(s: string) {
  return s.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function FolderStreamHeader({ stream, compact }: { stream: TodayFolderStream; compact: boolean }) {
  const [, startTransition] = useTransition();
  const polling = useBackgroundPolling();
  const [lastCount, setLastCount] = useState<number | null>(null);

  function refresh() {
    const fd = new FormData();
    fd.set("folderId", stream.folderId);
    polling.start();
    startTransition(async () => {
      const result = await pollFolderAction(fd);
      setLastCount(result.sourceCount);
    });
  }

  if (compact) {
    return (
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-1">
        <div className="flex items-baseline gap-2">
          <h2 className="text-lg font-semibold tracking-tight">{stream.name}</h2>
          <span className="text-xs" style={{ color: "var(--fg-muted)" }}>
            {stream.clusters.length} ready
          </span>
        </div>
        <div className="flex items-center gap-2">
          {polling.active ? (
            <PollingPill
              label={
                lastCount === null
                  ? "Refreshing"
                  : lastCount === 0
                    ? "Nothing to poll"
                    : `Refreshing ${lastCount} ${lastCount === 1 ? "source" : "sources"}`
              }
            />
          ) : null}
          <button
            type="button"
            className="text-xs underline-offset-2 hover:underline"
            style={{ color: "var(--fg-muted)" }}
            onClick={refresh}
          >
            Refresh
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex flex-col gap-3 rounded-xl p-4 sm:flex-row sm:items-center sm:justify-between"
      style={{ background: "var(--bg-subtle)", border: "1px solid var(--border)" }}
    >
      <div>
        <div className="fp-eyebrow">Folder stream</div>
        <h2 className="mt-1 text-xl font-semibold tracking-tight">{stream.name}</h2>
        <p className="mt-1 text-xs" style={{ color: "var(--fg-muted)" }}>
          {stream.clusters.length} ready {stream.clusters.length === 1 ? "cluster" : "clusters"}{" "}
          from this reading lane.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {polling.active ? (
          <PollingPill
            label={
              lastCount === null
                ? "Refreshing"
                : lastCount === 0
                  ? "Nothing to poll"
                  : `Refreshing ${lastCount} ${lastCount === 1 ? "source" : "sources"}`
            }
          />
        ) : null}
        <button type="button" className="fp-btn fp-btn-ghost" onClick={refresh}>
          Refresh
        </button>
      </div>
    </div>
  );
}

function EmptyStreamRow({ folderName }: { folderName: string }) {
  return (
    <div
      className="fp-card flex items-center justify-between gap-3 px-4 py-3 text-sm"
      style={{ background: "var(--bg-subtle)", color: "var(--fg-muted)" }}
    >
      <span>No fired clusters in {folderName} yet.</span>
      <span className="text-xs" style={{ color: "var(--fg-subtle)" }}>
        Refresh to fetch new items.
      </span>
    </div>
  );
}

export function PollingPill({ label }: { label: string }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px]"
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        color: "var(--fg-muted)",
      }}
      role="status"
      aria-live="polite"
    >
      <span className="fp-spinner" aria-hidden />
      <span>{label}</span>
    </span>
  );
}

function ClusterCard({
  preview,
  rank,
  isTop,
  outlets,
  defaultOutletId,
  onDismiss,
  onDismissFailed,
}: {
  preview: TodayClusterPreview;
  rank: number;
  isTop: boolean;
  outlets: OutletOption[];
  defaultOutletId: string | null;
  onDismiss: (id: string) => void;
  onDismissFailed: (id: string) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const c = preview.cluster;
  const headline = preview.items[0]?.title ?? "Untitled cluster";
  const fit = c.signals?.composite ?? 0;

  function dismiss() {
    onDismiss(c.id);
    const fd = new FormData();
    fd.set("clusterId", c.id);
    startTransition(async () => {
      try {
        await dismissClusterAction(fd);
        router.refresh();
      } catch (err) {
        onDismissFailed(c.id);
        console.error("dismissClusterAction failed", err);
      }
    });
  }

  return (
    <article
      className={`fp-card ${isTop ? "fp-card-feature" : "fp-card-hover"} relative p-6`}
      style={{
        opacity: pending ? 0.5 : undefined,
        viewTransitionName: cardTransitionName(c.id),
      }}
    >
      {isTop ? (
        <div
          className="absolute -top-3 left-6 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-white"
          style={{
            background: "linear-gradient(135deg, var(--indigo) 0%, var(--rose) 130%)",
            boxShadow: "var(--shadow-sm)",
          }}
        >
          <span>Ready</span>
        </div>
      ) : null}

      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <div className="flex flex-wrap items-center gap-2 fp-eyebrow">
            <span>
              #{rank} in {preview.folder.name}
            </span>
            <span style={{ color: "var(--border-strong)" }}>·</span>
            <span style={{ textTransform: "none", fontWeight: 400 }}>{c.sourceCount} sources</span>
            <span style={{ color: "var(--border-strong)" }}>·</span>
            <span style={{ textTransform: "none", fontWeight: 400 }}>
              {relativeTime(c.latestPublishedAt)}
            </span>
            <span className="fp-chip fp-chip-emerald ml-1">fit {fit.toFixed(2)}</span>
          </div>
          <h3
            className={`mt-2 leading-snug font-semibold ${
              isTop ? "text-2xl fp-h1-serif" : "text-lg"
            }`}
          >
            {headline}
          </h3>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-1.5">
        {dedupeSourceChips(preview.items).map((chip, idx) => (
          <span key={`${idx}:${chip.sourceId}`} className="fp-chip">
            {chip.label}
            {chip.count > 1 ? (
              <span style={{ color: "var(--fg-muted)" }}> · {chip.count}</span>
            ) : null}
          </span>
        ))}
      </div>

      {c.signals ? (
        <div
          className="mt-4 grid grid-cols-1 gap-3 rounded-lg p-3 sm:grid-cols-3"
          style={{ background: "var(--bg-subtle)" }}
        >
          <RankerSignal label="Archive overlap" value={c.signals.archiveOverlap} />
          <RankerSignal label="Beat match" value={c.signals.beatMatch} />
          <RankerSignal label="Source trust" value={c.signals.sourceTrust} />
        </div>
      ) : null}

      <div className="mt-5 flex flex-wrap items-start justify-between gap-3">
        <ClusterActions
          clusterId={c.id}
          outlets={outlets}
          defaultOutletId={preview.preferredOutletId ?? defaultOutletId}
          draftsByOutlet={preview.draftsByOutlet}
        />
        <button type="button" className="fp-btn fp-btn-ghost" onClick={dismiss} disabled={pending}>
          {pending ? "Dismissing" : "Not now"}
        </button>
      </div>
    </article>
  );
}

function PeekRow({
  preview,
  rank,
  outlets,
  defaultOutletId,
  onDismiss,
  onDismissFailed,
}: {
  preview: TodayClusterPreview;
  rank: number;
  outlets: OutletOption[];
  defaultOutletId: string | null;
  onDismiss: (id: string) => void;
  onDismissFailed: (id: string) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [expanded, setExpanded] = useState(false);
  const c = preview.cluster;
  const headline = preview.items[0]?.title ?? "Untitled cluster";
  const fit = c.signals?.composite ?? 0;

  function dismiss() {
    onDismiss(c.id);
    const fd = new FormData();
    fd.set("clusterId", c.id);
    startTransition(async () => {
      try {
        await dismissClusterAction(fd);
        router.refresh();
      } catch (err) {
        onDismissFailed(c.id);
        console.error("dismissClusterAction failed", err);
      }
    });
  }

  if (expanded) {
    return (
      <ClusterCard
        preview={preview}
        rank={rank}
        isTop={false}
        outlets={outlets}
        defaultOutletId={defaultOutletId}
        onDismiss={onDismiss}
        onDismissFailed={onDismissFailed}
      />
    );
  }

  // The row itself is presentational. Two real controls live inside: an
  // expand button that wraps the rank+headline+meta, and the dismiss
  // button. Nesting interactives is invalid HTML and breaks keyboard and
  // screen-reader navigation; siblings keep both reachable.
  return (
    <div
      className="fp-card flex flex-wrap items-center gap-3 px-4 py-3"
      style={{
        opacity: pending ? 0.5 : undefined,
        viewTransitionName: cardTransitionName(c.id),
      }}
    >
      <button
        type="button"
        className="fp-peek-open flex min-w-0 flex-1 items-center gap-3 text-left"
        onClick={() => setExpanded(true)}
        aria-label={`Open ${headline}`}
      >
        <span
          className="text-xs tabular shrink-0"
          style={{ color: "var(--fg-subtle)", minWidth: "1.5rem" }}
        >
          #{rank}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{headline}</span>
          <span
            className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px]"
            style={{ color: "var(--fg-muted)" }}
          >
            <span>{c.sourceCount} sources</span>
            <span style={{ color: "var(--border-strong)" }}>·</span>
            <span>{relativeTime(c.latestPublishedAt)}</span>
          </span>
        </span>
      </button>
      <span className="fp-chip fp-chip-emerald shrink-0">fit {fit.toFixed(2)}</span>
      <button
        type="button"
        className="fp-btn fp-btn-ghost shrink-0"
        onClick={dismiss}
        disabled={pending}
        aria-label={`Dismiss ${headline}`}
      >
        {pending ? "Dismissing" : "Not now"}
      </button>
    </div>
  );
}

function RankerSignal({ label, value }: { label: string; value: number }) {
  const pct = Math.round(value * 100);
  return (
    <div>
      <div
        className="flex items-center justify-between text-[11px]"
        style={{ color: "var(--fg-muted)" }}
      >
        <span>{label}</span>
        <span className="tabular font-medium" style={{ color: "var(--fg)" }}>
          {value.toFixed(2)}
        </span>
      </div>
      <div
        className="mt-1 h-1 overflow-hidden rounded-full"
        style={{ background: "var(--border)" }}
      >
        <div
          className="h-full rounded-full transition-all"
          style={{
            width: `${pct}%`,
            background: "linear-gradient(90deg, var(--indigo) 0%, var(--rose) 200%)",
          }}
        />
      </div>
    </div>
  );
}

function relativeTime(ms: number): string {
  const diff = Date.now() - ms;
  const min = Math.floor(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}

function dedupeSourceChips(
  items: TodayClusterPreview["items"],
): { sourceId: string; label: string; count: number }[] {
  const order: string[] = [];
  const groups = new Map<string, { sourceId: string; label: string; count: number }>();
  for (const item of items) {
    const existing = groups.get(item.sourceId);
    if (existing) {
      existing.count += 1;
      continue;
    }
    order.push(item.sourceId);
    groups.set(item.sourceId, {
      sourceId: item.sourceId,
      label: item.displayName || hostFromUrl(item.sourceUrl),
      count: 1,
    });
  }
  return order.map((id) => groups.get(id)!);
}

function hostFromUrl(s: string): string {
  try {
    return new URL(s).host.replace(/^www\./, "");
  } catch {
    return s;
  }
}
