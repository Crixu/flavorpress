"use client";

import { useMemo, useState, useTransition } from "react";
import { flushSync } from "react-dom";
import { useRouter } from "next/navigation";
import {
  dismissClusterAction,
  getFolderPollProgressAction,
  pollFolderAction,
} from "@/lib/v1/actions";
import { Card } from "@/components/wpds";
import { ClusterActions } from "./ClusterActions";
import { useToast } from "./Toast";
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

export function TodayFolderStreams({ streams, outlets, defaultOutletId }: Props) {
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());

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

  // Default: first folder in the array is expanded. All others start collapsed.
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => {
    const first = streams[0]?.id;
    return first ? new Set([first]) : new Set();
  });

  function toggleFolder(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  // Optimistic dismiss + rollback. Same semantics as before; the card
  // hides immediately, the action runs, and on failure the id goes back
  // so the cluster doesn't appear deleted while the server still has it
  // as 'fired'.
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

  if (visibleStreams.length === 0) return null;

  return (
    <div className="flex flex-col gap-3">
      {visibleStreams.map((stream) => (
        <FolderSection
          key={stream.id}
          stream={stream}
          expanded={expandedIds.has(stream.id)}
          onToggle={() => toggleFolder(stream.id)}
          outlets={outlets}
          defaultOutletId={defaultOutletId}
          onDismiss={dismissOptimistically}
          onDismissFailed={restoreAfterFailure}
        />
      ))}
    </div>
  );
}

function FolderSection({
  stream,
  expanded,
  onToggle,
  outlets,
  defaultOutletId,
  onDismiss,
  onDismissFailed,
}: {
  stream: TodayFolderStream;
  expanded: boolean;
  onToggle: () => void;
  outlets: OutletOption[];
  defaultOutletId: string | null;
  onDismiss: (id: string) => void;
  onDismissFailed: (id: string) => void;
}) {
  return (
    <div
      style={{
        background: "var(--surface)",
        borderRadius: "var(--radius-xl)",
        boxShadow: "var(--shadow-sm)",
      }}
    >
      <FolderSectionHeader
        stream={stream}
        expanded={expanded}
        onToggle={onToggle}
      />
      {expanded && (
        <div
          style={{
            padding: "20px 24px 24px",
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          {stream.clusters.length === 0 ? (
            <EmptyStreamRow folderName={stream.name} />
          ) : (
            <>
              <ClusterCard
                key={stream.clusters[0]!.cluster.id}
                preview={stream.clusters[0]!}
                rank={1}
                isTop
                outlets={outlets}
                defaultOutletId={defaultOutletId}
                onDismiss={onDismiss}
                onDismissFailed={onDismissFailed}
              />
              {stream.clusters.slice(1).map((preview, idx) => (
                <PeekRow
                  key={preview.cluster.id}
                  preview={preview}
                  rank={idx + 2}
                  outlets={outlets}
                  defaultOutletId={defaultOutletId}
                  onDismiss={onDismiss}
                  onDismissFailed={onDismissFailed}
                />
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function FolderSectionHeader({
  stream,
  expanded,
  onToggle,
}: {
  stream: TodayFolderStream;
  expanded: boolean;
  onToggle: () => void;
}) {
  const [, startTransition] = useTransition();
  const polling = useBackgroundPolling();
  const { show } = useToast();

  function refresh(e: React.MouseEvent) {
    // Prevent the click from also toggling the folder open/closed.
    e.stopPropagation();
    const fd = new FormData();
    fd.set("folderId", stream.folderId);
    polling.start();
    startTransition(async () => {
      const { sourceCount, startedAt } = await pollFolderAction(fd);
      if (sourceCount === 0) {
        show({
          title: `${stream.name}: nothing to poll`,
          durationMs: 3000,
        });
        return;
      }
      show({
        title: `Refreshing ${stream.name}`,
        body: `${sourceCount} ${sourceCount === 1 ? "source" : "sources"} polling`,
        durationMs: 120_000,
        pollIntervalMs: 1000,
        pollProgress: async () => {
          const p = await getFolderPollProgressAction({
            folderId: stream.folderId,
            startedAt,
          });
          const total = p.total > 0 ? p.total : sourceCount;
          const progress = total > 0 ? Math.min(1, p.completed / total) : 1;
          const complete = p.completed >= total;
          return { progress, complete };
        },
        onComplete: () => {
          show({
            title: `${stream.name}: refreshed ${sourceCount} ${
              sourceCount === 1 ? "source" : "sources"
            }`,
            durationMs: 3000,
          });
        },
      });
    });
  }

  return (
    <button
      type="button"
      aria-expanded={expanded}
      onClick={onToggle}
      className="text-left w-full"
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        padding: "16px 24px",
        background: "transparent",
        border: 0,
        borderRadius: expanded ? "var(--radius-xl) var(--radius-xl) 0 0" : "var(--radius-xl)",
        cursor: "pointer",
        fontFamily: "inherit",
        borderBottom: expanded ? "1px solid var(--border)" : "none",
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
        <h2
          className="fp-h1-serif"
          style={{ fontSize: "1.25rem", lineHeight: 1, fontWeight: 500, margin: 0 }}
        >
          {stream.name}
        </h2>
        <span className="text-xs" style={{ color: "var(--fg-muted)" }}>
          {stream.clusters.length} {stream.clusters.length === 1 ? "cluster" : "clusters"}
        </span>
      </div>
      <div
        style={{ display: "flex", alignItems: "center", gap: 8 }}
        // Prevent this inner div from triggering the outer button click twice.
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="fp-btn fp-btn-ghost"
          style={{ fontSize: 12, padding: "0.3rem 0.7rem" }}
          onClick={refresh}
        >
          Refresh
        </button>
        <span
          aria-hidden
          style={{
            display: "inline-block",
            fontSize: 10,
            color: "var(--fg-muted)",
            transform: expanded ? "rotate(180deg)" : "rotate(0deg)",
            transition: "transform 0.15s ease",
            userSelect: "none",
          }}
        >
          ▾
        </span>
      </div>
    </button>
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

function cardTransitionName(id: string) {
  return `fp-cluster-${cssIdent(id)}`;
}

function cssIdent(s: string) {
  return s.replace(/[^a-zA-Z0-9_-]/g, "_");
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
  const isSingleSource = c.sourceCount === 1;

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

  const sourceName = preview.items[0]?.displayName || hostFromUrl(preview.items[0]?.sourceUrl ?? "");

  return (
    <Card
      emphasis={isSingleSource}
      className={`${isTop ? "fp-card-feature" : "fp-card-hover"} relative p-6`}
      style={{
        opacity: pending ? 0.5 : undefined,
        viewTransitionName: cardTransitionName(c.id),
      }}
    >
      {isTop && !isSingleSource ? (
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
            {isSingleSource ? (
              <>
                <span>Saved</span>
                <span style={{ color: "var(--border-strong)" }}>·</span>
                <span style={{ textTransform: "none", fontWeight: 400 }}>{sourceName}</span>
                <span style={{ color: "var(--border-strong)" }}>·</span>
                <span style={{ textTransform: "none", fontWeight: 400 }}>
                  marked {relativeTime(c.latestPublishedAt)}
                </span>
              </>
            ) : (
              <>
                <span>
                  #{rank} in {preview.folder.name}
                </span>
                <span style={{ color: "var(--border-strong)" }}>·</span>
                <span style={{ textTransform: "none", fontWeight: 400 }}>
                  {c.sourceCount} sources
                </span>
                <span style={{ color: "var(--border-strong)" }}>·</span>
                <span style={{ textTransform: "none", fontWeight: 400 }}>
                  {relativeTime(c.latestPublishedAt)}
                </span>
                <span className="fp-chip fp-chip-emerald ml-1">fit {fit.toFixed(2)}</span>
              </>
            )}
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

      {!isSingleSource && (
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
      )}

      {!isSingleSource && c.signals ? (
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
          clusterTitle={headline}
          outlets={outlets}
          defaultOutletId={preview.preferredOutletId ?? defaultOutletId}
          draftsByOutlet={preview.draftsByOutlet}
        />
        <button type="button" className="fp-btn fp-btn-ghost" onClick={dismiss} disabled={pending}>
          {pending ? "Dismissing" : isSingleSource ? "Unsave" : "Not now"}
        </button>
      </div>
    </Card>
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
  const isSingleSource = c.sourceCount === 1;
  const sourceName = preview.items[0]?.displayName || hostFromUrl(preview.items[0]?.sourceUrl ?? "");

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
        borderLeft: isSingleSource ? "3px solid var(--ink-primary)" : undefined,
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
          {isSingleSource ? "S" : `#${rank}`}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{headline}</span>
          <span
            className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px]"
            style={{ color: "var(--fg-muted)" }}
          >
            {isSingleSource ? (
              <>
                <span>Saved · {sourceName}</span>
                <span style={{ color: "var(--border-strong)" }}>·</span>
                <span>{relativeTime(c.latestPublishedAt)}</span>
              </>
            ) : (
              <>
                <span>{c.sourceCount} sources</span>
                <span style={{ color: "var(--border-strong)" }}>·</span>
                <span>{relativeTime(c.latestPublishedAt)}</span>
              </>
            )}
          </span>
        </span>
      </button>
      {!isSingleSource && (
        <span className="fp-chip fp-chip-emerald shrink-0">fit {fit.toFixed(2)}</span>
      )}
      <button
        type="button"
        className="fp-btn fp-btn-ghost shrink-0"
        onClick={dismiss}
        disabled={pending}
        aria-label={`${isSingleSource ? "Unsave" : "Dismiss"} ${headline}`}
      >
        {pending ? "Dismissing" : isSingleSource ? "Unsave" : "Not now"}
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
