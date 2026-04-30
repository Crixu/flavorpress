"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { dismissClusterAction, pollFolderAction } from "@/lib/v1/actions";
import { ClusterActions } from "./ClusterActions";
import { useBackgroundPolling } from "./useBackgroundPolling";

export interface TodayClusterPreview {
  cluster: {
    id: string;
    formedAt: number;
    firedAt: number | null;
    sourceCount: number;
    signals: {
      archiveOverlap: number;
      beatMatch: number;
      sourceTrust: number;
      composite: number;
    } | null;
  };
  folder: {
    id: string | null;
    name: string;
  };
  items: {
    title: string;
    sourceUrl: string;
    displayName: string;
  }[];
  draft: {
    id: string;
    voiceMatch: number;
    wpEditLink: string | null;
  } | null;
}

interface TodayFolderStream {
  id: string;
  folderId: string | null;
  name: string;
  clusters: TodayClusterPreview[];
}

interface Props {
  previews: TodayClusterPreview[];
}

const INITIAL_VISIBLE = 1;
const MORE_STEP = 2;

export function TodayFolderStreams({ previews }: Props) {
  const [visibleCounts, setVisibleCounts] = useState<Record<string, number>>({});

  const streams = useMemo(() => buildStreams(previews), [previews]);

  return (
    <div className="space-y-6">
      {streams.map((stream) => {
        const visibleCount = visibleCounts[stream.id] ?? INITIAL_VISIBLE;
        const shown = stream.clusters.slice(0, visibleCount);
        const remaining = stream.clusters.length - shown.length;
        return (
          <section key={stream.id} className="space-y-3">
            <FolderStreamHeader
              stream={stream}
              remaining={remaining}
              onMore={() => {
                setVisibleCounts((current) => ({
                  ...current,
                  [stream.id]: visibleCount + MORE_STEP,
                }));
              }}
            />
            <div className="space-y-4">
              {shown.map((preview, idx) => (
                <ClusterCard
                  key={preview.cluster.id}
                  preview={preview}
                  rank={idx + 1}
                  isTop={idx === 0}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function buildStreams(previews: TodayClusterPreview[]): TodayFolderStream[] {
  const byFolder = new Map<string, TodayFolderStream>();
  for (const preview of previews) {
    const id = preview.folder.id ?? "ungrouped";
    const existing = byFolder.get(id);
    if (existing) {
      existing.clusters.push(preview);
      continue;
    }
    byFolder.set(id, {
      id,
      folderId: preview.folder.id,
      name: preview.folder.name,
      clusters: [preview],
    });
  }
  return Array.from(byFolder.values()).sort((a, b) => {
    const aScore = a.clusters[0]?.cluster.signals?.composite ?? 0;
    const bScore = b.clusters[0]?.cluster.signals?.composite ?? 0;
    return bScore - aScore;
  });
}

function FolderStreamHeader({
  stream,
  remaining,
  onMore,
}: {
  stream: TodayFolderStream;
  remaining: number;
  onMore: () => void;
}) {
  const [, startTransition] = useTransition();
  const polling = useBackgroundPolling();
  const [lastCount, setLastCount] = useState<number | null>(null);

  function refresh() {
    const fd = new FormData();
    fd.set("folderId", stream.folderId ?? "");
    polling.start();
    startTransition(async () => {
      const result = await pollFolderAction(fd);
      setLastCount(result.sourceCount);
    });
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
          {stream.clusters.length} ready {stream.clusters.length === 1 ? "cluster" : "clusters"} from this reading lane.
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
        {remaining > 0 ? (
          <button type="button" className="fp-btn fp-btn-ghost" onClick={onMore}>
            More
          </button>
        ) : null}
        <button
          type="button"
          className="fp-btn fp-btn-ghost"
          onClick={refresh}
        >
          Refresh
        </button>
      </div>
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
}: {
  preview: TodayClusterPreview;
  rank: number;
  isTop: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const c = preview.cluster;
  const headline = preview.items[0]?.title ?? "Untitled cluster";
  const fit = c.signals?.composite ?? 0;

  function dismiss() {
    const fd = new FormData();
    fd.set("clusterId", c.id);
    startTransition(async () => {
      await dismissClusterAction(fd);
      router.refresh();
    });
  }

  return (
    <article
      className={`fp-card ${isTop ? "fp-card-feature" : "fp-card-hover"} relative p-6`}
      style={pending ? { opacity: 0.5 } : undefined}
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
            <span>#{rank} in {preview.folder.name}</span>
            <span style={{ color: "var(--border-strong)" }}>·</span>
            <span style={{ textTransform: "none", fontWeight: 400 }}>
              {c.sourceCount} sources
            </span>
            <span style={{ color: "var(--border-strong)" }}>·</span>
            <span style={{ textTransform: "none", fontWeight: 400 }}>
              {relativeTime(c.firedAt ?? c.formedAt)}
            </span>
            <span className="fp-chip fp-chip-emerald ml-1">
              fit {fit.toFixed(2)}
            </span>
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
        {preview.items.map((item, i) => (
          <span key={i} className="fp-chip">
            {item.displayName || hostFromUrl(item.sourceUrl)}
          </span>
        ))}
      </div>

      {c.signals ? (
        <div
          className="mt-4 grid grid-cols-1 gap-3 rounded-lg p-3 sm:grid-cols-3"
          style={{ background: "var(--bg-subtle)" }}
        >
          <RankerSignal
            label="Archive overlap"
            value={c.signals.archiveOverlap}
          />
          <RankerSignal label="Beat match" value={c.signals.beatMatch} />
          <RankerSignal label="Source trust" value={c.signals.sourceTrust} />
        </div>
      ) : null}

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <ClusterActions clusterId={c.id} draft={preview.draft} />
        <button
          type="button"
          className="fp-btn fp-btn-ghost"
          onClick={dismiss}
          disabled={pending}
        >
          {pending ? "Dismissing" : "Not now"}
        </button>
      </div>
    </article>
  );
}

function RankerSignal({ label, value }: { label: string; value: number }) {
  const pct = Math.round(value * 100);
  return (
    <div>
      <div className="flex items-center justify-between text-[11px]" style={{ color: "var(--fg-muted)" }}>
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
            background:
              "linear-gradient(90deg, var(--indigo) 0%, var(--rose) 200%)",
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

function hostFromUrl(s: string): string {
  try {
    return new URL(s).host.replace(/^www\./, "");
  } catch {
    return s;
  }
}
