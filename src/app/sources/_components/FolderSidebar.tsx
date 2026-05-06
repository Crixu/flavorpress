"use client";

/**
 * Left-rail folder navigation for the sources shell.
 *
 * Replaces FolderChipBar as the primary folder filter surface. Folder
 * management (rename, poll, delete) stays in a separate inline panel
 * accessible from the sidebar item when active.
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
import { useBackgroundPolling } from "../../_components/useBackgroundPolling";

interface FolderRow {
  id: string;
  name: string;
}

interface Props {
  folders: FolderRow[];
  allCount: number;
  ungroupedCount: number;
  folderCounts: Record<string, number>;
  currentFolder: string | "ungrouped" | null;
  outletParam: string | null;
}

function buildHref(folder: string | "ungrouped" | null, outletParam: string | null): string {
  const params = new URLSearchParams();
  if (folder) params.set("folder", folder);
  if (outletParam) params.set("outlet", outletParam);
  const q = params.toString();
  return q ? `/sources?${q}` : "/sources";
}

export function FolderSidebar({
  folders,
  allCount,
  ungroupedCount,
  folderCounts,
  currentFolder,
  outletParam,
}: Props) {
  const activeFolder =
    currentFolder && currentFolder !== "ungrouped"
      ? (folders.find((f) => f.id === currentFolder) ?? null)
      : null;

  return (
    <div className="fp-folder-side">
      <h5 className="fp-folder-side-h">Folders</h5>

      <Link
        href={buildHref(null, outletParam)}
        className={`fp-folder-item ${!currentFolder ? "on" : ""}`}
      >
        <span>All</span>
        <span className="n">{allCount}</span>
      </Link>

      <Link
        href={buildHref("ungrouped", outletParam)}
        className={`fp-folder-item ${currentFolder === "ungrouped" ? "on" : ""}`}
      >
        <span>Ungrouped</span>
        <span className="n">{ungroupedCount}</span>
      </Link>

      {folders.length > 0 ? (
        <>
          <div className="fp-folder-grp">Lanes</div>
          {folders.map((f) => {
            const active = currentFolder === f.id;
            return (
              <Link
                key={f.id}
                href={buildHref(f.id, outletParam)}
                className={`fp-folder-item ${active ? "on" : ""}`}
              >
                <span>{f.name}</span>
                <span className="n">{folderCounts[f.id] ?? 0}</span>
              </Link>
            );
          })}
        </>
      ) : null}

      <div className="fp-folder-grp" style={{ marginTop: 16 }}>
        <NewFolderInline />
      </div>

      {currentFolder === "ungrouped" ? (
        <UngroupedManagePanel count={ungroupedCount} />
      ) : activeFolder ? (
        <FolderManagePanel folder={activeFolder} count={folderCounts[activeFolder.id] ?? 0} />
      ) : null}
    </div>
  );
}

function NewFolderInline() {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fp-folder-item"
        style={{ color: "var(--ink-tertiary)", fontSize: 12 }}
      >
        + New folder
      </button>
    );
  }

  return (
    <form action={createFolderAction} onSubmit={() => setOpen(false)} className="px-2">
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
        className="mb-1 w-full rounded border border-stone-300 px-2 py-1 text-xs"
      />
      <div className="flex gap-1">
        <SubmitButton
          className="rounded bg-stone-800 px-2 py-0.5 text-[11px] text-white hover:bg-stone-900"
          pendingLabel="Creating"
        >
          Create
        </SubmitButton>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded px-2 py-0.5 text-[11px] text-stone-500 hover:bg-stone-100"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

function FolderManagePanel({ folder, count }: { folder: FolderRow; count: number }) {
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
    <div className="fp-folder-manage">
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
        className="mb-1.5 w-full rounded border border-transparent bg-transparent px-1 py-0.5 text-xs font-medium hover:border-stone-200 focus:border-stone-300 focus:bg-white focus:outline-none"
      />
      <div className="mb-2 text-[11px]" style={{ color: "var(--ink-muted)" }}>
        {count} source{count === 1 ? "" : "s"}
      </div>
      <div className="flex flex-wrap gap-1">
        <PollFolderButton
          folderId={folder.id}
          disabled={count === 0}
          title={count === 0 ? "Empty folder" : "Poll all sources in this folder"}
          label="Poll"
        />
        <RemoveFolderControl folder={folder} count={count} />
      </div>
    </div>
  );
}

function RemoveFolderControl({ folder, count }: { folder: FolderRow; count: number }) {
  const [confirming, setConfirming] = useState(false);

  if (count === 0) {
    return (
      <form action={deleteFolderAction}>
        <input type="hidden" name="folderId" value={folder.id} />
        <SubmitButton
          className="rounded border border-rose-200 bg-white px-2 py-0.5 text-[11px] text-rose-700 hover:bg-rose-50"
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
        className="rounded border border-rose-200 bg-white px-2 py-0.5 text-[11px] text-rose-700 hover:bg-rose-50"
      >
        Remove
      </button>
    );
  }

  return (
    <form action={deleteFolderAction} className="flex flex-wrap items-center gap-1">
      <input type="hidden" name="folderId" value={folder.id} />
      <span className="text-[11px] text-rose-700">
        Move {count} {count === 1 ? "source" : "sources"} to Ungrouped?
      </span>
      <SubmitButton
        className="rounded bg-rose-600 px-2 py-0.5 text-[11px] text-white hover:bg-rose-700"
        pendingLabel="Removing"
      >
        Confirm
      </SubmitButton>
      <button
        type="button"
        onClick={() => setConfirming(false)}
        className="rounded border border-stone-200 bg-white px-2 py-0.5 text-[11px] hover:bg-stone-50"
      >
        Cancel
      </button>
    </form>
  );
}

function PollFolderButton({
  folderId,
  disabled,
  title,
  label,
}: {
  folderId: string;
  disabled?: boolean;
  title?: string;
  label: string;
}) {
  const polling = useBackgroundPolling();
  const [pending, startTransition] = useTransition();
  const [count, setCount] = useState<number | null>(null);

  function trigger() {
    polling.start();
    const fd = new FormData();
    fd.set("folderId", folderId);
    startTransition(async () => {
      const result = await pollFolderAction(fd);
      setCount(result.sourceCount);
    });
  }

  const busy = pending || polling.active;
  return (
    <span className="inline-flex items-center gap-1">
      {polling.active ? (
        <span
          className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px]"
          style={{
            background: "var(--surface)",
            border: "1px solid var(--border)",
            color: "var(--fg-muted)",
          }}
          role="status"
          aria-live="polite"
        >
          <span className="fp-spinner" aria-hidden />
          <span>
            {count === null
              ? "Polling"
              : count === 0
                ? "Nothing"
                : `${count} ${count === 1 ? "source" : "sources"}`}
          </span>
        </span>
      ) : null}
      <button
        type="button"
        onClick={trigger}
        disabled={disabled || pending}
        title={title}
        className="rounded border border-stone-200 bg-white px-2 py-0.5 text-[11px] hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-60"
        aria-busy={busy}
      >
        {label}
      </button>
    </span>
  );
}

function UngroupedManagePanel({ count }: { count: number }) {
  return (
    <div className="fp-folder-manage">
      <div className="mb-1 text-xs font-medium">Ungrouped</div>
      <div className="mb-2 text-[11px]" style={{ color: "var(--ink-muted)" }}>
        {count} source{count === 1 ? "" : "s"}
      </div>
      <PollFolderButton
        folderId=""
        disabled={count === 0}
        title={count === 0 ? "No ungrouped sources" : "Poll every ungrouped source"}
        label="Poll"
      />
    </div>
  );
}
