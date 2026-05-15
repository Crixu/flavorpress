"use client";

/**
 * Client-side triggers for the in-place mutations on a notebook view:
 * remix ideas, pull more quotes, add a one-off source, flag the cluster
 * as a mismatch. Each button wraps its server action in a transition so
 * the rest of the view stays interactive while the LLM call runs.
 *
 * Kept in one file because the four buttons share the same draft + cluster
 * context and the same minimal pending-state UI; splitting them would mean
 * four near-identical wrappers.
 */

import { useState, useTransition } from "react";
import {
  addMoreNotesQuotesAction,
  addSourceToClusterAction,
  deleteManualClusterSourceAction,
  flagClusterMismatchAction,
  remixNotesIdeasAction,
} from "@/lib/v1/actions";

interface CommonProps {
  draftId: string;
  clusterId: string;
}

export function RemixIdeasButton({ draftId }: { draftId: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      onClick={() => {
        const fd = new FormData();
        fd.set("draftId", draftId);
        startTransition(() => remixNotesIdeasAction(fd));
      }}
      disabled={pending}
      className="rounded-full px-2.5 py-1 text-[11px] transition"
      style={{
        background: pending ? "var(--bg-subtle)" : "transparent",
        border: "1px solid var(--border)",
        color: "var(--fg-muted)",
      }}
    >
      {pending ? "Remixing…" : "Remix"}
    </button>
  );
}

export function MoreQuotesButton({ draftId, atCap }: { draftId: string; atCap: boolean }) {
  const [pending, startTransition] = useTransition();
  if (atCap) {
    return (
      <span className="text-[11px]" style={{ color: "var(--fg-subtle)" }}>
        max reached
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={() => {
        const fd = new FormData();
        fd.set("draftId", draftId);
        startTransition(() => addMoreNotesQuotesAction(fd));
      }}
      disabled={pending}
      className="rounded-full px-2.5 py-1 text-[11px] transition"
      style={{
        background: pending ? "var(--bg-subtle)" : "transparent",
        border: "1px solid var(--border)",
        color: "var(--fg-muted)",
      }}
    >
      {pending ? "Pulling more…" : "More quotes"}
    </button>
  );
}

export function AddSourceForm({ draftId, clusterId }: CommonProps) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [value, setValue] = useState("");
  return (
    <form
      action={(fd) => {
        setError(null);
        startTransition(async () => {
          try {
            await addSourceToClusterAction(fd);
            setValue("");
          } catch (e) {
            setError(e instanceof Error ? e.message : "Failed to add source.");
          }
        });
      }}
      className="space-y-1.5"
    >
      <input type="hidden" name="draftId" value={draftId} />
      <input type="hidden" name="clusterId" value={clusterId} />
      <input
        type="url"
        name="url"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Paste an article URL"
        required
        disabled={pending}
        className="w-full rounded-xl px-3 py-2 text-[12px]"
        style={{
          background: "var(--surface)",
          border: "1px solid var(--border)",
          color: "var(--fg)",
        }}
      />
      <div className="flex items-center justify-between">
        <button
          type="submit"
          disabled={pending || value.trim().length === 0}
          className="rounded-full px-2.5 py-1 text-[11px]"
          style={{
            background: pending ? "var(--bg-subtle)" : "transparent",
            border: "1px solid var(--border)",
            color: "var(--fg-muted)",
          }}
        >
          {pending ? "Adding…" : "Add to cluster"}
        </button>
        {error ? (
          <span className="text-[11px]" style={{ color: "#9C4A22" }}>
            {error}
          </span>
        ) : null}
      </div>
    </form>
  );
}

export function DeleteManualSourceButton({
  draftId,
  clusterId,
  itemId,
}: CommonProps & { itemId: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      onClick={() => {
        const fd = new FormData();
        fd.set("draftId", draftId);
        fd.set("clusterId", clusterId);
        fd.set("itemId", itemId);
        startTransition(() => deleteManualClusterSourceAction(fd));
      }}
      disabled={pending}
      className="fp-research-source-delete"
      aria-label="Remove manually added source"
    >
      {pending ? "Removing" : "Remove"}
    </button>
  );
}

export function FlagMismatchButton({ draftId, clusterId }: CommonProps) {
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      onClick={() => {
        if (!window.confirm("Flag this cluster as a mismatch and delete these notes?")) {
          return;
        }
        const fd = new FormData();
        fd.set("draftId", draftId);
        fd.set("clusterId", clusterId);
        // The action calls redirect("/"), which Next surfaces as a thrown
        // NEXT_REDIRECT signal; the framework intercepts it and swaps the
        // route. Awaiting inside the transition is enough; no router push.
        startTransition(() => flagClusterMismatchAction(fd));
      }}
      disabled={pending}
      className="text-[12px] hover:underline"
      style={{ color: "var(--fg-subtle)" }}
    >
      {pending ? "Flagging…" : "Sources don't match"}
    </button>
  );
}
