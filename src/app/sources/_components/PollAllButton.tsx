"use client";

import { useState, useTransition } from "react";
import { pollAllSourcesAction } from "@/lib/v1/actions";
import { useBackgroundPolling } from "../../_components/useBackgroundPolling";

/**
 * Kicks off polling for every active source and returns immediately —
 * the actual fetches run in Next.js `after()`. The button stays usable
 * and a small inline pill says how many feeds are still in flight while
 * `router.refresh()` pulls items in as they ingest.
 */
export function PollAllButton() {
  const [, startTransition] = useTransition();
  const polling = useBackgroundPolling({ durationMs: 20_000 });
  const [count, setCount] = useState<number | null>(null);

  function trigger() {
    polling.start();
    startTransition(async () => {
      const result = await pollAllSourcesAction();
      setCount(result.sourceCount);
    });
  }

  return (
    <div className="flex items-center gap-2">
      {polling.active ? (
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
          <span>
            {count === null
              ? "Polling"
              : count === 0
                ? "Nothing to poll"
                : `Polling ${count} ${count === 1 ? "source" : "sources"}`}
          </span>
        </span>
      ) : null}
      <button
        type="button"
        onClick={trigger}
        className="rounded border border-stone-200 bg-white px-3 py-1.5 text-xs hover:bg-stone-50"
      >
        ↻ Poll all
      </button>
    </div>
  );
}
