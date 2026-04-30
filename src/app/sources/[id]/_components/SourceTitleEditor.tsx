"use client";

/**
 * Inline rename for the source detail header. Default state shows the title
 * as a heading with a small Edit affordance; clicking switches to a text
 * input bound to the rename action. Esc cancels, Enter (form submit) saves.
 */

import { useState, useTransition } from "react";
import { renameSourceAction } from "@/lib/v1/actions";

export function SourceTitleEditor({
  sourceId,
  initialTitle,
}: {
  sourceId: string;
  initialTitle: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(initialTitle);
  const [pending, startTransition] = useTransition();

  function save(value: string) {
    const next = value.trim();
    if (next === initialTitle.trim()) {
      setEditing(false);
      return;
    }
    const fd = new FormData();
    fd.set("sourceId", sourceId);
    fd.set("displayName", next);
    startTransition(async () => {
      await renameSourceAction(fd);
      setEditing(false);
    });
  }

  if (!editing) {
    return (
      <div className="flex items-center gap-3 flex-wrap">
        <h1 className="fp-h1 fp-h1-serif" style={{ maxWidth: "26ch" }}>
          {initialTitle}
        </h1>
        <button
          type="button"
          onClick={() => {
            setDraft(initialTitle);
            setEditing(true);
          }}
          className="rounded border border-stone-200 px-2 py-1 text-[11px] text-stone-700 hover:bg-stone-50"
        >
          Rename
        </button>
      </div>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save(draft);
      }}
      className="flex items-center gap-2 flex-wrap"
    >
      <input
        type="text"
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            setDraft(initialTitle);
            setEditing(false);
          }
        }}
        disabled={pending}
        maxLength={120}
        className="fp-h1 fp-h1-serif flex-1 min-w-[12ch] rounded border border-stone-300 bg-white px-2 py-1"
        style={{ maxWidth: "26ch" }}
        aria-label="Source name"
      />
      <button
        type="submit"
        disabled={pending}
        className="rounded bg-indigo-600 px-3 py-1.5 text-sm text-white hover:bg-indigo-700 disabled:opacity-60"
      >
        {pending ? "Saving…" : "Save"}
      </button>
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          setDraft(initialTitle);
          setEditing(false);
        }}
        className="rounded border border-stone-200 px-3 py-1.5 text-sm text-stone-700 hover:bg-stone-50 disabled:opacity-60"
      >
        Cancel
      </button>
    </form>
  );
}
