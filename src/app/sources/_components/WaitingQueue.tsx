"use client";

/**
 * Waiting list for sources currently under a 429/503 retry-after backoff.
 *
 * The backoff timestamp comes from `politeFetch`: when a host returns 429 or
 * 503, we honor the `Retry-After` header (or fall back to a doubled poll
 * interval) and persist `sources.backoff_until`. This component shows the
 * resulting queue and arms a timer per row so the source kicks off again
 * the instant the backoff elapses, without the user having to click.
 *
 * The timer only fires while the tab is open. That's fine: if the user is
 * not at the desk, the next normal Poll-all will hit politeFetch's expired
 * backoff path and pick up from there.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { pollSourceAction } from "@/lib/v1/actions";
import { useBackgroundPolling } from "../../_components/useBackgroundPolling";

export interface WaitingRow {
  id: string;
  display: string;
  host: string;
  backoffUntil: number;
  lastError: string | null;
}

export function WaitingQueue({ rows }: { rows: WaitingRow[] }) {
  const polling = useBackgroundPolling({
    durationMs: 15_000,
    intervalMs: 2_500,
  });
  const startPollingRef = useRef(polling.start);
  startPollingRef.current = polling.start;
  const [now, setNow] = useState(() => Date.now());
  const fired = useRef<Set<string>>(new Set());

  // Tick once per second so countdowns advance smoothly without a reflow
  // storm. The retry trigger does not depend on this; see the second
  // effect for the per-row setTimeout.
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  // Arm one setTimeout per waiting row. Cleared and re-armed whenever the
  // row set changes, so a fresh server snapshot rewires the schedule
  // without leaving stale timers behind. The `fired` set is keyed by both
  // id and backoffUntil so a row that bounces back into a fresh backoff
  // (e.g. Reddit still 429s on retry) gets a new timer the next snapshot.
  useEffect(() => {
    const timers: number[] = [];
    for (const row of rows) {
      const key = `${row.id}:${row.backoffUntil}`;
      if (fired.current.has(key)) continue;
      const delay = Math.max(0, row.backoffUntil - Date.now()) + 250;
      const t = window.setTimeout(() => {
        fired.current.add(key);
        const fd = new FormData();
        fd.set("sourceId", row.id);
        // Server action runs the fetch in `after()`; the background polling
        // hook tickles router.refresh() over a 15s window so we catch the
        // cleared backoff and the new items as the fetch settles.
        startPollingRef.current();
        pollSourceAction(fd).catch(() => {
          // Logged server-side; the refresh window will surface success or
          // a fresh backoff when it lands.
        });
      }, delay);
      timers.push(t);
    }
    return () => {
      for (const t of timers) window.clearTimeout(t);
    };
    // We re-arm only when the underlying queue changes shape; the `now`
    // tick must not trigger a re-arm or we'd cancel timers every second.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowKey(rows)]);

  const sorted = useMemo(
    () => [...rows].sort((a, b) => a.backoffUntil - b.backoffUntil),
    [rows],
  );

  return (
    <section className="overflow-hidden rounded-xl border border-amber-200 bg-amber-50/40">
      <header className="flex items-center justify-between border-b border-amber-200/70 px-4 py-2">
        <div className="flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-wider text-amber-800">
            Waiting on rate limit
          </span>
          <span className="rounded-full bg-amber-200/70 px-2 py-0.5 text-[10px] font-medium text-amber-900">
            {sorted.length}
          </span>
        </div>
        <span className="text-[11px] text-amber-800/80">
          Retries automatically when each timer expires
        </span>
      </header>
      <ul className="divide-y divide-amber-200/60">
        {sorted.map((row) => {
          const remainingMs = Math.max(0, row.backoffUntil - now);
          const ready = remainingMs === 0;
          return (
            <li
              key={row.id}
              className="flex items-center justify-between gap-3 px-4 py-2.5 text-xs"
            >
              <div className="min-w-0">
                <div className="font-medium text-stone-900 truncate">
                  {row.display}
                </div>
                <div className="truncate text-[11px] text-stone-500">
                  {row.host}
                  {row.lastError ? (
                    <span className="ml-2 text-rose-700">{row.lastError}</span>
                  ) : null}
                </div>
              </div>
              <div className="flex items-center gap-2 whitespace-nowrap">
                <span
                  className={`tabular-nums ${
                    ready
                      ? "text-emerald-700"
                      : "text-amber-800"
                  }`}
                  aria-live="polite"
                >
                  {ready ? "retrying…" : `retry in ${formatRemaining(remainingMs)}`}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function rowKey(rows: WaitingRow[]): string {
  return rows
    .map((r) => `${r.id}:${r.backoffUntil}`)
    .sort()
    .join("|");
}

function formatRemaining(ms: number): string {
  const totalSec = Math.ceil(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (min < 60) return sec === 0 ? `${min}m` : `${min}m ${sec}s`;
  const hr = Math.floor(min / 60);
  const remMin = min % 60;
  return remMin === 0 ? `${hr}h` : `${hr}h ${remMin}m`;
}
