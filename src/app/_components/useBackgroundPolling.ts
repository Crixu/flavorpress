"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Drive a non-blocking "running in the background" indicator and
 * progressively pick up server-side updates via `router.refresh()` while
 * a deferred server action (one that runs its real work inside Next.js
 * `after()`) is finishing.
 *
 * Each `start()` call resets the deadline and the refresh cadence so a
 * user clicking Refresh repeatedly keeps the window open and items can
 * trickle in as feeds finish polling.
 */
export interface BackgroundPolling {
  active: boolean;
  remainingMs: number;
  start: () => void;
}

interface Options {
  /** How long to keep tickling the router after a click. */
  durationMs?: number;
  /** Cadence between `router.refresh()` calls during the window. */
  intervalMs?: number;
}

export function useBackgroundPolling({
  durationMs = 12_000,
  intervalMs = 2_500,
}: Options = {}): BackgroundPolling {
  const router = useRouter();
  const [deadline, setDeadline] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const intervalRef = useRef<number | null>(null);

  const start = useCallback(() => {
    setDeadline(Date.now() + durationMs);
  }, [durationMs]);

  useEffect(() => {
    if (deadline === null) return;

    function clear() {
      if (intervalRef.current !== null) {
        window.clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }

    clear();
    intervalRef.current = window.setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (t >= deadline) {
        clear();
        // One last refresh to catch anything that committed near the deadline.
        router.refresh();
        setDeadline(null);
        return;
      }
      router.refresh();
    }, intervalMs);

    return clear;
  }, [deadline, intervalMs, router]);

  const active = deadline !== null && now < deadline;
  const remainingMs = active ? Math.max(0, deadline - now) : 0;
  return { active, remainingMs, start };
}
