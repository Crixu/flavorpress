"use client";

import { useTransition } from "react";
import { boostSourceTrustAction } from "@/lib/v1/actions";

/**
 * Manual trust boost. Two buttons (−/+ 0.1) flanking the current
 * percentage. Disabled at the [0, 1] boundaries so the user gets visual
 * feedback when the score has bottomed out or maxed out.
 */
export function TrustBoostControl({
  sourceId,
  trust,
  size = "sm",
}: {
  sourceId: string;
  trust: number;
  size?: "sm" | "md";
}) {
  const [pending, startTransition] = useTransition();
  const pct = Math.round(trust * 100);
  const atFloor = trust <= 0.001;
  const atCeil = trust >= 0.999;

  function bump(delta: number) {
    const fd = new FormData();
    fd.set("sourceId", sourceId);
    fd.set("delta", String(delta));
    startTransition(async () => {
      await boostSourceTrustAction(fd);
    });
  }

  const btn = size === "md" ? "h-7 w-7 text-sm" : "h-6 w-6 text-xs";
  const label =
    size === "md" ? "min-w-[3rem] text-sm tabular-nums" : "min-w-[2.5rem] text-[11px] tabular-nums";

  return (
    <div
      className="inline-flex items-center gap-1 rounded border border-stone-200 bg-white px-1 py-0.5"
      aria-label="Trust score"
    >
      <button
        type="button"
        onClick={() => bump(-0.1)}
        disabled={pending || atFloor}
        aria-label="Decrease trust by 0.1"
        title="−0.1"
        className={`${btn} rounded text-stone-600 hover:bg-stone-100 disabled:opacity-40 disabled:hover:bg-transparent`}
      >
        −
      </button>
      <span className={`${label} text-center font-medium text-stone-900`}>
        {pending ? "…" : `${pct}%`}
      </span>
      <button
        type="button"
        onClick={() => bump(0.1)}
        disabled={pending || atCeil}
        aria-label="Increase trust by 0.1"
        title="+0.1"
        className={`${btn} rounded text-stone-600 hover:bg-stone-100 disabled:opacity-40 disabled:hover:bg-transparent`}
      >
        +
      </button>
    </div>
  );
}
