"use client";

/**
 * Source explorer with selection-aware bulk actions.
 *
 * Single-source moves use a per-row folder picker that auto-submits on
 * change. The bulk-move bar stays hidden at rest and slides in from the
 * bottom only when a checkbox is ticked, so the resting state is a clean
 * list and the primary action gains a count once it has work to do.
 */

import Link from "next/link";
import { useState, useTransition } from "react";
import {
  assignSourceToFolderAction,
  bulkAssignSourcesToFolderAction,
  deleteSourceAction,
  pauseSourceAction,
  pollSourceAction,
  resumeSourceAction,
} from "@/lib/v1/actions";
import { SubmitButton } from "../../_components/SubmitButton";
import { PollSourceButton } from "./PollSourceButton";
import { TrustBoostControl } from "./TrustBoostControl";

interface FolderRow {
  id: string;
  name: string;
}

interface SourceRow {
  id: string;
  kind: string;
  url: string;
  display_name: string | null;
  folder_id: string | null;
  trust_score: number;
  last_polled_at: number | null;
  last_error: string | null;
  paused_until: number | null;
  backoff_until: number | null;
  item_count: number;
  items_24h: number;
  last_item_at: number | null;
}

interface FolderGroup {
  id: string | null;
  name: string;
  rows: SourceRow[];
}

const KIND_META: Record<string, { color: string; label: string }> = {
  rss: { color: "bg-stone-100 text-stone-700", label: "RSS" },
  reddit: { color: "bg-orange-100 text-orange-800", label: "Reddit" },
  podcast: { color: "bg-purple-100 text-purple-800", label: "Podcast" },
  youtube: { color: "bg-rose-100 text-rose-800", label: "YouTube" },
};

export function SourcesExplorer({
  groups,
  folders,
}: {
  groups: FolderGroup[];
  folders: FolderRow[];
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function clearSelection() {
    setSelected(new Set());
  }

  if (groups.length === 0) return null;

  return (
    <>
      <section className="overflow-hidden rounded-xl border border-stone-200 bg-white">
        <div className="overflow-x-auto">
          <div className="min-w-[720px]">
            <div
              className="border-b border-stone-200 bg-stone-50 px-4 py-2 text-[10px] uppercase tracking-wider text-stone-500"
              style={{
                display: "grid",
                gridTemplateColumns: GRID_COLS,
                gap: 8,
                alignItems: "center",
              }}
            >
              <div />
              <div>Source</div>
              <div>Trust</div>
              <div className="text-right">Activity</div>
              <div className="text-right">Last poll</div>
              <div>Folder</div>
              <div className="text-right">Actions</div>
            </div>

            {groups.map((group) => (
              <details
                key={group.id ?? "ungrouped"}
                open
                className="border-b border-stone-100 last:border-b-0"
              >
                <summary className="flex cursor-pointer items-center gap-2 bg-stone-100/70 px-4 py-2 text-xs hover:bg-stone-100">
                  <span className="text-stone-500">▾</span>
                  <span className="font-semibold text-stone-900">{group.name}</span>
                  <span className="text-stone-500">
                    · {group.rows.length} source
                    {group.rows.length === 1 ? "" : "s"}
                  </span>
                </summary>

                {group.rows.length === 0 ? (
                  <div className="px-4 py-4 text-xs text-stone-500">No sources here yet.</div>
                ) : (
                  <div className="divide-y divide-stone-100">
                    {group.rows.map((row) => (
                      <ExplorerRow
                        key={row.id}
                        row={row}
                        folders={folders}
                        selected={selected.has(row.id)}
                        onToggle={() => toggle(row.id)}
                      />
                    ))}
                  </div>
                )}
              </details>
            ))}
          </div>
        </div>
      </section>

      <BulkActionBar selected={selected} folders={folders} onClear={clearSelection} />
    </>
  );
}

/** Shared column template for header and rows. */
const GRID_COLS = "28px 1fr 56px 80px 90px 56px 80px";

function ExplorerRow({
  row,
  folders,
  selected,
  onToggle,
}: {
  row: SourceRow;
  folders: FolderRow[];
  selected: boolean;
  onToggle: () => void;
}) {
  const meta = KIND_META[row.kind] ?? KIND_META.rss!;
  const paused = row.paused_until !== null && row.paused_until > Date.now();
  const waiting = !paused && row.backoff_until !== null && row.backoff_until > Date.now();
  const name = row.display_name || hostFromUrl(row.url);

  return (
    <div
      className={`px-4 py-2 text-xs ${
        selected
          ? "bg-indigo-50/60"
          : paused || waiting
            ? "bg-amber-50/40 hover:bg-amber-50/70"
            : "hover:bg-stone-50"
      }`}
      style={{ display: "grid", gridTemplateColumns: GRID_COLS, gap: 8, alignItems: "center" }}
    >
      {/* Checkbox */}
      <div>
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggle}
          aria-label={`Select ${name}`}
          className="h-4 w-4 rounded border-stone-300"
        />
      </div>

      {/* Name + URL + kind chip + status */}
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-1.5">
          <Link
            href={`/sources/${row.id}`}
            prefetch={false}
            className="font-medium text-stone-900 hover:underline"
          >
            {name}
          </Link>
          <span
            className={`rounded px-1 py-0.5 text-[10px] uppercase tracking-wider ${meta.color}`}
          >
            {meta.label}
          </span>
          {paused ? (
            <span className="rounded bg-amber-100 px-1 py-0.5 text-[10px] uppercase tracking-wider text-amber-800">
              Paused
            </span>
          ) : waiting ? (
            <span className="rounded bg-amber-100 px-1 py-0.5 text-[10px] uppercase tracking-wider text-amber-800">
              Waiting
            </span>
          ) : null}
        </div>
        <div className="truncate text-[11px] text-stone-400">{row.url}</div>
        {row.last_error ? (
          <div className="truncate text-[11px] text-rose-600">{row.last_error}</div>
        ) : null}
      </div>

      {/* Trust */}
      <div>
        <TrustBoostControl sourceId={row.id} trust={row.trust_score} />
      </div>

      {/* Activity */}
      <div className="text-right text-stone-500">
        <div className="text-[11px]">
          {row.items_24h > 0 ? `+${row.items_24h} today` : `${row.item_count} total`}
        </div>
        <FreshnessLine lastItemAt={row.last_item_at} itemCount={row.item_count} />
      </div>

      {/* Last poll */}
      <div className="text-right text-[11px] text-stone-400">
        {row.last_polled_at ? relativeTime(Number(row.last_polled_at)) : "never"}
      </div>

      {/* Routing: folder picker */}
      <div>
        <InlineFolderPicker sourceId={row.id} currentFolderId={row.folder_id} folders={folders} />
      </div>

      {/* Actions */}
      <div className="flex flex-wrap justify-end gap-1">
        {paused ? (
          <form action={resumeSourceAction}>
            <input type="hidden" name="sourceId" value={row.id} />
            <SubmitButton
              className="rounded border border-amber-300 bg-amber-50 px-2 py-1 text-[10px] text-amber-800 hover:bg-amber-100"
              pendingLabel="..."
            >
              Resume
            </SubmitButton>
          </form>
        ) : (
          <SnoozePicker sourceId={row.id} />
        )}
        <PollSourceButton sourceId={row.id} />
        <form action={deleteSourceAction}>
          <input type="hidden" name="sourceId" value={row.id} />
          <SubmitButton
            className="rounded border border-rose-200 px-2 py-1 text-[10px] text-rose-700 hover:bg-rose-50"
            pendingLabel="..."
          >
            Remove
          </SubmitButton>
        </form>
      </div>
    </div>
  );
}

function SnoozePicker({ sourceId }: { sourceId: string }) {
  const [pending, startTransition] = useTransition();

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const hours = e.target.value;
    if (!hours) return;
    const fd = new FormData();
    fd.set("sourceId", sourceId);
    fd.set("durationHours", hours);
    startTransition(async () => {
      await pauseSourceAction(fd);
    });
    e.target.value = "";
  }

  return (
    <select
      value=""
      onChange={handleChange}
      disabled={pending}
      aria-label="Snooze source"
      className="rounded border border-stone-200 bg-white px-2 py-1 text-[11px] hover:border-stone-300 disabled:opacity-60"
    >
      <option value="" disabled>
        {pending ? "Snoozing…" : "Snooze"}
      </option>
      <option value="1">1 hour</option>
      <option value="24">1 day</option>
      <option value="168">1 week</option>
    </select>
  );
}

function InlineFolderPicker({
  sourceId,
  currentFolderId,
  folders,
}: {
  sourceId: string;
  currentFolderId: string | null;
  folders: FolderRow[];
}) {
  const [pending, startTransition] = useTransition();

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const folderId = e.target.value;
    if (folderId === (currentFolderId ?? "")) return;
    const fd = new FormData();
    fd.set("sourceId", sourceId);
    fd.set("folderId", folderId);
    startTransition(async () => {
      await assignSourceToFolderAction(fd);
    });
  }

  return (
    <select
      value={currentFolderId ?? ""}
      onChange={handleChange}
      disabled={pending}
      aria-label="Move to folder"
      className="w-full rounded border border-stone-200 bg-white px-2 py-1 text-[11px] hover:border-stone-300 disabled:opacity-60"
    >
      <option value="">Ungrouped</option>
      {folders.map((f) => (
        <option key={f.id} value={f.id}>
          {f.name}
        </option>
      ))}
    </select>
  );
}

function BulkActionBar({
  selected,
  folders,
  onClear,
}: {
  selected: Set<string>;
  folders: FolderRow[];
  onClear: () => void;
}) {
  const [movePending, startMoveTransition] = useTransition();
  const [syncPending, startSyncTransition] = useTransition();
  const [folderId, setFolderId] = useState<string>("");

  if (selected.size === 0) return null;

  function handleMove(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData();
    fd.set("folderId", folderId);
    for (const id of selected) fd.append("sourceId", id);
    startMoveTransition(async () => {
      await bulkAssignSourcesToFolderAction(fd);
      onClear();
      setFolderId("");
    });
  }

  function handleSyncSelected() {
    startSyncTransition(async () => {
      for (const id of selected) {
        const fd = new FormData();
        fd.set("sourceId", id);
        await pollSourceAction(fd);
      }
      onClear();
    });
  }

  const targetLabel =
    folderId === "" ? "Ungrouped" : (folders.find((f) => f.id === folderId)?.name ?? "folder");
  const pending = movePending || syncPending;

  return (
    <div className="fixed bottom-4 left-1/2 z-30 -translate-x-1/2">
      <div className="flex items-center gap-3 rounded-xl border border-stone-300 bg-white px-4 py-3 shadow-lg">
        <span className="text-sm font-medium text-stone-900">{selected.size} selected</span>
        <span className="h-4 w-px bg-stone-200" />

        {/* Move to folder */}
        <form onSubmit={handleMove} className="flex items-center gap-2">
          <select
            value={folderId}
            onChange={(e) => setFolderId(e.target.value)}
            className="rounded border border-stone-300 px-2 py-1 text-xs"
            aria-label="Target folder"
            disabled={pending}
          >
            <option value="">Ungrouped</option>
            {folders.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
          <button
            type="submit"
            disabled={pending}
            className="rounded bg-stone-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-stone-900 disabled:opacity-60"
          >
            {movePending ? "Moving..." : `Move to ${targetLabel}`}
          </button>
        </form>

        <span className="h-4 w-px bg-stone-200" />

        {/* Sync selected */}
        <button
          type="button"
          onClick={handleSyncSelected}
          disabled={pending}
          className="rounded border border-stone-200 px-3 py-1.5 text-xs hover:bg-stone-50 disabled:opacity-60"
        >
          {syncPending ? "Syncing..." : "Sync selected"}
        </button>

        {/* Re-tag: not yet implemented */}
        <button
          type="button"
          disabled
          title="Re-tag: coming soon"
          className="rounded border border-stone-200 px-3 py-1.5 text-xs text-stone-400 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Re-tag
        </button>

        <span className="h-4 w-px bg-stone-200" />

        <button
          type="button"
          onClick={onClear}
          disabled={pending}
          className="rounded border border-stone-200 px-3 py-1.5 text-xs hover:bg-stone-50 disabled:opacity-60"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function hostFromUrl(s: string): string {
  try {
    return new URL(s).host.replace(/^www\./, "");
  } catch {
    return s;
  }
}

// Staleness threshold: 30 days without a new item flags the feed for
// pruning. Below that, the line stays neutral so live feeds don't shout.
const FRESHNESS_STALE_MS = 30 * 24 * 60 * 60 * 1000;

function FreshnessLine({
  lastItemAt,
  itemCount,
}: {
  lastItemAt: number | null;
  itemCount: number;
}) {
  if (lastItemAt === null) {
    return (
      <div className="text-[11px] text-stone-400">
        {itemCount === 0 ? "no items yet" : "no dates"}
      </div>
    );
  }
  const stale = Date.now() - lastItemAt >= FRESHNESS_STALE_MS;
  const cls = stale ? "text-[11px] text-amber-700" : "text-[11px] text-stone-400";
  return <div className={cls}>new item {relativeTime(lastItemAt)}</div>;
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

function _relativeFuture(ms: number): string {
  const diff = ms - Date.now();
  if (diff <= 0) return "soon";
  const min = Math.ceil(diff / 60000);
  if (min < 60) return `in ${min}m`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `in ${hr}h`;
  const day = Math.round(hr / 24);
  return `in ${day}d`;
}
