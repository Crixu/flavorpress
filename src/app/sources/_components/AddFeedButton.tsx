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
}

export function AddFeedButton({ folders, currentFolderId }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded border border-stone-200 bg-white px-3 py-1.5 text-sm font-medium hover:bg-stone-50"
      >
        + Add feed
      </button>
      <AddFeedSheet
        open={open}
        onClose={() => setOpen(false)}
        folders={folders}
        currentFolderId={currentFolderId}
      />
    </>
  );
}
