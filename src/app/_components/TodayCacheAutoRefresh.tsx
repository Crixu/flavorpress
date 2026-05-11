"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Poll the cheap status endpoint while a Today refresh is running, and
 * trigger a full `router.refresh()` only when the cache flips to "fresh"
 * (or surfaces an error worth showing). Backoff stretches the cadence as
 * the window grows so a slow refresh doesn't burn one Turso read per
 * second for the whole duration.
 */
export function TodayCacheAutoRefresh({
  durationMs = 45_000,
  initialDelayMs = 1500,
  maxDelayMs = 6_000,
  backoffFactor = 1.4,
}: {
  durationMs?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  backoffFactor?: number;
}) {
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;
    const deadline = Date.now() + durationMs;
    let delay = initialDelayMs;

    async function tick() {
      if (cancelled || Date.now() >= deadline) return;
      let keepGoing = true;
      try {
        const res = await fetch("/api/today-cache/status", { cache: "no-store" });
        if (res.ok) {
          const body = (await res.json()) as { status?: string; error?: string | null };
          if (body.status === "fresh" || body.error) {
            router.refresh();
            keepGoing = false;
          }
        }
      } catch {
        // Network blip; keep polling.
      }
      if (cancelled || !keepGoing) return;
      delay = Math.min(Math.round(delay * backoffFactor), maxDelayMs);
      timer = window.setTimeout(tick, delay);
    }

    timer = window.setTimeout(tick, initialDelayMs);

    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [durationMs, initialDelayMs, maxDelayMs, backoffFactor, router]);

  return null;
}
