"use client";

/**
 * Folder filter and management surface.
 *
 * One chip per folder (plus All and Ungrouped) so the user picks a reading
 * scope the same way they pick an outlet. The active folder reveals an
 * inline manage panel: rename on blur, poll the folder, remove with
 * confirmation when sources would be reparented.
 */

import Link from "next/link";
import { useState, useTransition } from "react";
import {
  createFolderAction,
  deleteFolderAction,
  pollFolderAction,
  renameFolderAction,
} from "@/lib/v1/actions";
import { SubmitButton } from "../../_components/SubmitButton";

interface FolderRow {
  id: string;
  name: string;
}

type FolderToken = string | "ungrouped" | null;

interface Props {
  folders: FolderRow[];
  allCount: number;
  ungroupedCount: number;
  folderCounts: Record<string, number>;
  currentFolder: FolderToken;
  outletParam: string | null;
}

function buildHref(folder: FolderToken, outletParam: string | null): string {
  const params = new URLSearchParams();
  if (folder) params.set("folder", folder);
  if (outletParam) params.set("outlet", outletParam);
  const q = params.toString();
  return q ? `/sources?${q}` : "/sources";
}

export function FolderChipBar({
  folders,
  allCount,
  ungroupedCount,
  folderCounts,
  currentFolder,
  outletParam,
}: Props) {
  const activeFolder =
    currentFolder && currentFolder !== "ungrouped"
      ? folders.find((f) => f.id === currentFolder) ?? null
      : null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className="text-[11px] uppercase tracking-wider"
          style={{ color: "var(--fg-muted)" }}
        >
          Folder
        </span>
        <Link
          href={buildHref(null, outletParam)}
          className={`fp-chip ${!currentFolder ? "fp-chip-indigo" : ""} transition`}
        >
          All · {allCount}
        </Link>
        <Link
          href={buildHref("ungrouped", outletParam)}
          className={`fp-chip ${currentFolder === "ungrouped" ? "fp-chip-indigo" : ""} transition`}
        >
          📂 Ungrouped · {ungroupedCount}
        </Link>
        {folders.map((f) => {
          const active = currentFolder === f.id;
          const count = folderCounts[f.id] ?? 0;
          // On the Ungrouped view, empty folder chips are noise: the user is
          // looking at sources without a folder, not at the folder roster.
          if (currentFolder === "ungrouped" && count === 0) return null;
          return (
            <Link
              key={f.id}
              href={buildHref(f.id, outletParam)}
              className={`fp-chip ${active ? "fp-chip-indigo" : ""} transition`}
            >
              📁 {f.name} · {count}
            </Link>
          );
        })}
        <NewFolderChip />
      </div>

      {currentFolder === "ungrouped" ? (
        <UngroupedManagePanel count={ungroupedCount} />
      ) : null}
      {activeFolder ? (
        <FolderManagePanel
          folder={activeFolder}
          count={folderCounts[activeFolder.id] ?? 0}
        />
      ) : null}
    </div>
  );
}

function NewFolderChip() {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fp-chip transition hover:bg-stone-100"
      >
        + Folder
      </button>
    );
  }

  return (
    <form
      action={createFolderAction}
      onSubmit={() => setOpen(false)}
      className="flex items-center gap-1"
    >
      <input
        name="name"
        autoFocus
        required
        maxLength={60}
        placeholder="Folder name"
        onBlur={(e) => {
          if (!e.currentTarget.value.trim()) setOpen(false);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
        }}
        className="rounded border border-stone-300 px-2 py-1 text-xs"
      />
      <SubmitButton
        className="rounded border border-stone-300 px-2 py-1 text-[11px] hover:bg-stone-50"
        pendingLabel="Creating"
      >
        Create
      </SubmitButton>
    </form>
  );
}

function FolderManagePanel({
  folder,
  count,
}: {
  folder: FolderRow;
  count: number;
}) {
  const [renamePending, startRenameTransition] = useTransition();

  function commitRename(value: string) {
    const trimmed = value.trim();
    if (!trimmed || trimmed === folder.name) return;
    const fd = new FormData();
    fd.set("folderId", folder.id);
    fd.set("name", trimmed);
    startRenameTransition(async () => {
      await renameFolderAction(fd);
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-xs">
      <span className="text-base">📁</span>
      <input
        key={folder.id + ":" + folder.name}
        defaultValue={folder.name}
        maxLength={60}
        disabled={renamePending}
        onBlur={(e) => commitRename(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            e.currentTarget.blur();
          } else if (e.key === "Escape") {
            e.currentTarget.value = folder.name;
            e.currentTarget.blur();
          }
        }}
        aria-label="Folder name (press Enter to save)"
        className="rounded border border-transparent bg-transparent px-1.5 py-1 text-sm font-semibold hover:border-stone-200 focus:border-stone-300 focus:bg-white focus:outline-none"
      />
      <span className="text-stone-500">
        {count} source{count === 1 ? "" : "s"}
      </span>
      <span className="ml-auto flex items-center gap-1.5">
        <form action={pollFolderAction}>
          <input type="hidden" name="folderId" value={folder.id} />
          <SubmitButton
            className="rounded border border-stone-200 bg-white px-2.5 py-1 text-[11px] hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={count === 0}
            title={
              count === 0
                ? "Empty folder"
                : "Poll all sources in this folder"
            }
            pendingLabel="Polling"
          >
            ↻ Poll folder
          </SubmitButton>
        </form>
        <RemoveFolderControl folder={folder} count={count} />
      </span>
    </div>
  );
}

function RemoveFolderControl({
  folder,
  count,
}: {
  folder: FolderRow;
  count: number;
}) {
  const [confirming, setConfirming] = useState(false);

  if (count === 0) {
    return (
      <form action={deleteFolderAction}>
        <input type="hidden" name="folderId" value={folder.id} />
        <SubmitButton
          className="rounded border border-rose-200 bg-white px-2.5 py-1 text-[11px] text-rose-700 hover:bg-rose-50"
          title="Delete this empty folder"
          pendingLabel="Removing"
        >
          Remove
        </SubmitButton>
      </form>
    );
  }

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="rounded border border-rose-200 bg-white px-2.5 py-1 text-[11px] text-rose-700 hover:bg-rose-50"
      >
        Remove
      </button>
    );
  }

  return (
    <form action={deleteFolderAction} className="flex items-center gap-1.5">
      <input type="hidden" name="folderId" value={folder.id} />
      <span className="text-[11px] text-rose-700">
        Move {count} source{count === 1 ? "" : "s"} to Ungrouped?
      </span>
      <SubmitButton
        className="rounded bg-rose-600 px-2.5 py-1 text-[11px] text-white hover:bg-rose-700"
        pendingLabel="Removing"
      >
        Confirm remove
      </SubmitButton>
      <button
        type="button"
        onClick={() => setConfirming(false)}
        className="rounded border border-stone-200 bg-white px-2.5 py-1 text-[11px] hover:bg-stone-50"
      >
        Cancel
      </button>
    </form>
  );
}

function UngroupedManagePanel({ count }: { count: number }) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-xs">
      <span className="text-base">📂</span>
      <span className="text-sm font-semibold">Ungrouped</span>
      <span className="text-stone-500">
        {count} source{count === 1 ? "" : "s"}
      </span>
      <span className="ml-auto">
        <form action={pollFolderAction}>
          <input type="hidden" name="folderId" value="" />
          <SubmitButton
            className="rounded border border-stone-200 bg-white px-2.5 py-1 text-[11px] hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={count === 0}
            title={
              count === 0
                ? "No ungrouped sources"
                : "Poll every ungrouped source"
            }
            pendingLabel="Polling"
          >
            ↻ Poll Ungrouped
          </SubmitButton>
        </form>
      </span>
    </div>
  );
}
