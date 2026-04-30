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
  item_count: number;
  items_24h: number;
}

interface FolderGroup {
  id: string | null;
  name: string;
  rows: SourceRow[];
}

const KIND_META: Record<
  string,
  { icon: string; color: string; label: string }
> = {
  rss: { icon: "📰", color: "bg-stone-100 text-stone-700", label: "RSS" },
  reddit: {
    icon: "🔥",
    color: "bg-orange-100 text-orange-800",
    label: "Reddit",
  },
  podcast: {
    icon: "🎙️",
    color: "bg-purple-100 text-purple-800",
    label: "Podcast",
  },
  youtube: {
    icon: "▶",
    color: "bg-rose-100 text-rose-800",
    label: "YouTube",
  },
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
            <div className="grid grid-cols-12 gap-3 border-b border-stone-200 bg-stone-50 px-4 py-2 text-[10px] uppercase tracking-wider text-stone-500">
              <div className="col-span-1">Pick</div>
              <div className="col-span-4">Source</div>
              <div className="col-span-1">Type</div>
              <div className="col-span-2">Folder</div>
              <div className="col-span-2 text-right">Last fetch</div>
              <div className="col-span-2 text-right">Actions</div>
            </div>

            {groups.map((group) => (
              <details
                key={group.id ?? "ungrouped"}
                open
                className="border-b border-stone-100 last:border-b-0"
              >
                <summary className="flex cursor-pointer items-center gap-2 bg-stone-100/70 px-4 py-2 text-xs hover:bg-stone-100">
                  <span className="text-stone-500">▾</span>
                  <span className="font-semibold text-stone-900">
                    {group.id ? "📁" : "📂"} {group.name}
                  </span>
                  <span className="text-stone-500">
                    · {group.rows.length} source
                    {group.rows.length === 1 ? "" : "s"}
                  </span>
                </summary>

                {group.rows.length === 0 ? (
                  <div className="px-4 py-4 text-xs text-stone-500">
                    No sources here yet.
                  </div>
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

      <BulkActionBar
        selected={selected}
        folders={folders}
        onClear={clearSelection}
      />
    </>
  );
}

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
  const paused =
    row.paused_until !== null && row.paused_until > Date.now();
  return (
    <div
      className={`grid grid-cols-12 items-center gap-3 px-4 py-3 text-xs ${
        selected
          ? "bg-indigo-50/60"
          : paused
            ? "bg-amber-50/40 hover:bg-amber-50/70"
            : "hover:bg-stone-50"
      }`}
    >
      <div className="col-span-1">
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggle}
          aria-label={`Select ${row.display_name || hostFromUrl(row.url)}`}
          className="h-4 w-4 rounded border-stone-300"
        />
      </div>
      <div className="col-span-4 min-w-0">
        <div className="flex items-center gap-2">
          <Link
            href={`/sources/${row.id}`}
            prefetch={false}
            className="font-medium text-stone-900 hover:underline"
          >
            {row.display_name || hostFromUrl(row.url)}
          </Link>
          {paused ? (
            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-amber-800">
              Paused · resumes {relativeFuture(row.paused_until!)}
            </span>
          ) : null}
        </div>
        <div className="truncate text-[11px] text-stone-500">{row.url}</div>
        {row.last_error ? (
          <div className="mt-0.5 truncate text-[11px] text-rose-600">
            {row.last_error}
          </div>
        ) : null}
      </div>
      <div className="col-span-1">
        <span
          className={`rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wider ${meta.color}`}
        >
          {meta.label}
        </span>
      </div>
      <div className="col-span-2">
        <InlineFolderPicker
          sourceId={row.id}
          currentFolderId={row.folder_id}
          folders={folders}
        />
      </div>
      <div className="col-span-2 text-right text-stone-500">
        {row.last_polled_at ? relativeTime(Number(row.last_polled_at)) : "never"}
      </div>
      <div className="col-span-2 flex flex-wrap justify-end gap-1.5">
        <Link
          href={`/sources/${row.id}`}
          prefetch={false}
          className="rounded border border-stone-200 px-2 py-1 text-[11px] hover:bg-stone-50"
        >
          Open
        </Link>
        {paused ? (
          <form action={resumeSourceAction}>
            <input type="hidden" name="sourceId" value={row.id} />
            <SubmitButton
              className="rounded border border-amber-300 bg-amber-50 px-2 py-1 text-[11px] text-amber-800 hover:bg-amber-100"
              pendingLabel="Resuming"
            >
              Resume
            </SubmitButton>
          </form>
        ) : (
          <SnoozePicker sourceId={row.id} />
        )}
        <form action={pollSourceAction}>
          <input type="hidden" name="sourceId" value={row.id} />
          <SubmitButton
            className="rounded border border-stone-200 px-2 py-1 text-[11px] hover:bg-stone-50"
            pendingLabel="Polling"
          >
            Poll
          </SubmitButton>
        </form>
        <form action={deleteSourceAction}>
          <input type="hidden" name="sourceId" value={row.id} />
          <SubmitButton
            className="rounded border border-rose-200 px-2 py-1 text-[11px] text-rose-700 hover:bg-rose-50"
            pendingLabel="Removing"
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
        {pending ? "Snoozing…" : "💤 Snooze"}
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
      <option value="">📂 Ungrouped</option>
      {folders.map((f) => (
        <option key={f.id} value={f.id}>
          📁 {f.name}
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
  const [pending, startTransition] = useTransition();
  const [folderId, setFolderId] = useState<string>("");

  if (selected.size === 0) return null;

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData();
    fd.set("folderId", folderId);
    for (const id of selected) fd.append("sourceId", id);
    startTransition(async () => {
      await bulkAssignSourcesToFolderAction(fd);
      onClear();
      setFolderId("");
    });
  }

  const targetLabel =
    folderId === ""
      ? "Ungrouped"
      : (folders.find((f) => f.id === folderId)?.name ?? "folder");

  return (
    <div className="fixed bottom-4 left-1/2 z-30 -translate-x-1/2">
      <form
        onSubmit={handleSubmit}
        className="flex items-center gap-3 rounded-xl border border-stone-300 bg-white px-4 py-3 shadow-lg"
      >
        <span className="text-sm font-medium text-stone-900">
          {selected.size} selected
        </span>
        <span className="text-stone-300">→</span>
        <select
          value={folderId}
          onChange={(e) => setFolderId(e.target.value)}
          className="rounded border border-stone-300 px-2 py-1 text-xs"
          aria-label="Target folder"
        >
          <option value="">📂 Ungrouped</option>
          {folders.map((f) => (
            <option key={f.id} value={f.id}>
              📁 {f.name}
            </option>
          ))}
        </select>
        <button
          type="submit"
          disabled={pending}
          className="rounded bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
        >
          {pending
            ? "Moving…"
            : `Move ${selected.size} to ${targetLabel}`}
        </button>
        <button
          type="button"
          onClick={onClear}
          disabled={pending}
          className="rounded border border-stone-200 px-3 py-1.5 text-sm hover:bg-stone-50 disabled:opacity-60"
        >
          Cancel
        </button>
      </form>
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

function relativeFuture(ms: number): string {
  const diff = ms - Date.now();
  if (diff <= 0) return "soon";
  const min = Math.ceil(diff / 60000);
  if (min < 60) return `in ${min}m`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `in ${hr}h`;
  const day = Math.round(hr / 24);
  return `in ${day}d`;
}
