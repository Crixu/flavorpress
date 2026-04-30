"use client";

import { useTransition } from "react";
import { pollSourceAction } from "@/lib/v1/actions";
import { useBackgroundPolling } from "../../_components/useBackgroundPolling";

/**
 * Poll one source. Action returns instantly (the fetch runs in `after()`),
 * so the click never blocks the UI. The pill auto-dismisses after the
 * background window expires.
 */
export function PollSourceButton({
  sourceId,
  className,
  label = "Poll",
  busyLabel = "Polling…",
}: {
  sourceId: string;
  className?: string;
  label?: string;
  busyLabel?: string;
}) {
  const polling = useBackgroundPolling({ durationMs: 8_000 });
  const [pending, startTransition] = useTransition();

  function trigger() {
    polling.start();
    const fd = new FormData();
    fd.set("sourceId", sourceId);
    startTransition(async () => {
      await pollSourceAction(fd);
    });
  }

  const busy = pending || polling.active;
  return (
    <button
      type="button"
      onClick={trigger}
      disabled={pending}
      aria-busy={busy}
      className={
        className ??
        "rounded border border-stone-200 px-2 py-1 text-[11px] hover:bg-stone-50 disabled:opacity-60"
      }
    >
      {busy ? busyLabel : label}
    </button>
  );
}
