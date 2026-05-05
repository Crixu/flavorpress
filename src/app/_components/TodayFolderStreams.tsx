"use client";

import { useMemo, useState, useTransition } from "react";
import { flushSync } from "react-dom";
import { useRouter } from "next/navigation";
import {
  dismissClusterAction,
  getFolderPollProgressAction,
  pollFolderAction,
} from "@/lib/v1/actions";
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

  const firstWithContent = visibleStreams.find((s) => s.clusters.length > 0)?.id;
  const fallbackFolderId = visibleStreams[0]?.id;
  const initialSelected = firstWithContent ?? fallbackFolderId ?? null;
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(initialSelected);

  // If the selected folder disappears (rare; folder removal mid-session),
  // fall back to whichever lane has content. Single-user prototype, but
  // keeps the rail honest when the dataset shifts under us.
  const selected =
    visibleStreams.find((s) => s.id === selectedFolderId) ??
    visibleStreams.find((s) => s.clusters.length > 0) ??
    visibleStreams[0] ??
    null;

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

  if (!selected) return null;

  return (
    <div
      className="fp-finder"
      style={{
        background: "var(--surface)",
        borderRadius: "var(--radius-xl)",
        boxShadow: "var(--shadow-sm)",
        // overflow:hidden was here originally; it broke position:sticky
        // on the rail. Border-radius on the rail (left side) and pane
        // (right side) keeps the corners rounded without clipping.
        minHeight: 540,
      }}
    >
      <FolderRail
        streams={visibleStreams}
        selectedId={selected.id}
        onSelect={setSelectedFolderId}
      />
      <FolderPane
        stream={selected}
        outlets={outlets}
        defaultOutletId={defaultOutletId}
        onDismiss={dismissOptimistically}
        onDismissFailed={restoreAfterFailure}
      />
    </div>
  );
}

function FolderRail({
  streams,
  selectedId,
  onSelect,
}: {
  streams: TodayFolderStream[];
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  return (
    <nav
      aria-label="Folders"
      style={{
        // Outer wrapper fills the grid column so the cream rail
        // background extends top to bottom even when the pane is
        // taller than the folder list.
        background: "var(--bg-subtle)",
        borderRight: "1px solid var(--border)",
        borderTopLeftRadius: "var(--radius-xl)",
        borderBottomLeftRadius: "var(--radius-xl)",
      }}
    >
      <div
        style={{
          // Inner sticky wrapper carries the actual folder buttons.
          // Sticky needs no overflow:hidden ancestor to function;
          // top offset clears the pill nav (~70px) + page pt-8 (~32px)
          // plus a small margin.
          position: "sticky",
          top: 112,
          padding: "16px 8px",
          display: "flex",
          flexDirection: "column",
          gap: 2,
          maxHeight: "calc(100vh - 128px)",
          overflowY: "auto",
        }}
      >
        <div
          className="fp-eyebrow"
          style={{
            padding: "6px 12px 10px",
            color: "var(--fg-subtle)",
          }}
        >
          Folders
        </div>
        {streams.map((stream) => {
          const active = stream.id === selectedId;
          const isEmpty = stream.clusters.length === 0;
          const lead = stream.clusters[0]?.items[0]?.title ?? null;
          return (
            <button
              key={stream.id}
              type="button"
              onClick={() => onSelect(stream.id)}
              aria-pressed={active}
              className="text-left"
              style={{
                display: "grid",
                gridTemplateColumns: "1fr auto",
                gap: 10,
                padding: "10px 12px",
                borderRadius: "var(--radius-md)",
                color: isEmpty && !active ? "var(--fg-muted)" : "var(--fg)",
                background: active ? "var(--surface)" : "transparent",
                boxShadow: active ? "var(--shadow-xs)" : "none",
                cursor: "pointer",
                alignItems: "center",
                fontFamily: "inherit",
                border: "0",
              }}
            >
              <span style={{ minWidth: 0 }}>
                <span
                  style={{
                    display: "block",
                    fontSize: 14,
                    fontWeight: 500,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {stream.name}
                </span>
                <span
                  style={{
                    display: "block",
                    fontSize: 11,
                    color: "var(--fg-muted)",
                    marginTop: 2,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {lead ?? "No clusters yet"}
                </span>
              </span>
              <span
                className="tabular"
                style={{
                  fontSize: 11,
                  color: active ? "var(--bg)" : "var(--fg-muted)",
                  background: active ? "var(--indigo)" : "var(--surface)",
                  border: active ? "1px solid var(--indigo)" : "1px solid var(--border)",
                  padding: "1px 8px",
                  borderRadius: 9999,
                }}
              >
                {stream.clusters.length}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

function FolderPane({
  stream,
  outlets,
  defaultOutletId,
  onDismiss,
  onDismissFailed,
}: {
  stream: TodayFolderStream;
  outlets: OutletOption[];
  defaultOutletId: string | null;
  onDismiss: (id: string) => void;
  onDismissFailed: (id: string) => void;
}) {
  return (
    <div
      style={{
        padding: "24px 28px 32px",
        display: "flex",
        flexDirection: "column",
        gap: 18,
        viewTransitionName: laneTransitionName(stream.id),
        borderTopRightRadius: "var(--radius-xl)",
        borderBottomRightRadius: "var(--radius-xl)",
        background: "var(--surface)",
      }}
    >
      <FolderPaneHeader stream={stream} />
      {stream.clusters.length === 0 ? (
        <EmptyStreamRow folderName={stream.name} />
      ) : (
        <div className="flex flex-col gap-3">
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
        </div>
      )}
    </div>
  );
}

function FolderPaneHeader({ stream }: { stream: TodayFolderStream }) {
  const [, startTransition] = useTransition();
  const polling = useBackgroundPolling();
  const { show } = useToast();

  function refresh() {
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
      // Determinate toast: progress bar reflects (sources finished / total)
      // by polling getFolderPollProgressAction every 1s. Watchdog cap at
      // 120s in case a feed hangs forever; complete=true dismisses early
      // when the count catches up.
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
    <div
      className="flex items-baseline justify-between gap-4 pb-3"
      style={{ borderBottom: "1px solid var(--border)" }}
    >
      <div className="flex items-baseline gap-3">
        <h2 className="fp-h1-serif" style={{ fontSize: "1.7rem", lineHeight: 1, fontWeight: 500 }}>
          {stream.name}
        </h2>
        <span className="text-xs" style={{ color: "var(--fg-muted)" }}>
          {stream.clusters.length} {stream.clusters.length === 1 ? "cluster" : "clusters"}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="fp-btn fp-btn-ghost"
          style={{ fontSize: 12, padding: "0.3rem 0.7rem" }}
          onClick={refresh}
        >
          Refresh
        </button>
      </div>
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
