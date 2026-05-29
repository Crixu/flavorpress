"use client";

/**
 * Client wrapper that owns the open/closed state for the AddFeedSheet.
 * The sources page is a server component, so state must live here.
 */

import { useState } from "react";
import { AddFeedSheet } from "./AddFeedSheet";

interface Props {
  folders: { id: string; name: string }[];
  currentFolderId?: string | null;
  sourceCount: number;
  sourceLimit: number;
}

export function AddFeedButton({ folders, currentFolderId, sourceCount, sourceLimit }: Props) {
  const [open, setOpen] = useState(false);
  const canAddSource = sourceCount < sourceLimit;
  const sourceLabel = sourceLimit === 1 ? "source" : "sources";
  const limitMessage = `This plan allows ${sourceLimit} ${sourceLabel}. Remove a source or ask an admin to raise the cap.`;

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={!canAddSource}
        title={canAddSource ? "Add feeds" : limitMessage}
        className="rounded border border-stone-200 bg-white px-3 py-1.5 text-sm font-medium hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-60"
      >
        + Add feed
      </button>
      {!canAddSource ? (
        <span className="max-w-[260px] text-right text-[11px] leading-snug text-stone-500">
          {limitMessage}
        </span>
      ) : null}
      <AddFeedSheet
        open={open}
        onClose={() => setOpen(false)}
        folders={folders}
        currentFolderId={currentFolderId}
        sourceCount={sourceCount}
        sourceLimit={sourceLimit}
      />
    </span>
  );
}
