/**
 * Vercel Cron entry point for source polling.
 *
 * The in-process scheduler is disabled on Vercel because serverless
 * functions do not keep a stable Node process alive between requests.
 * This route runs the same due-source pass and waits for queued polls
 * to settle before returning.
 */

import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { ensureRegisteredCapabilities } from "@/lib/v1/bootstrap";
import { runDuePolls } from "@/lib/v1/scheduler";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Vercel Pro gives function invocations up to 5 minutes; Hobby caps at 60s.
// Opt into the 5-minute window so a tick has headroom when many sources
// happen to fall due at once. The maxBatch cap further bounds per-tick
// work so we never get close to this limit.
export const maxDuration = 300;

function readMaxBatch(): number | undefined {
  const raw = process.env.FLAVORPRESS_CRON_MAX_BATCH;
  if (!raw) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return Math.floor(n);
}

export async function GET(req: Request) {
  const authError = rejectInvalidCronRequest(req);
  if (authError) return authError;

  await ensureRegisteredCapabilities();
  const result = await runDuePolls({
    wait: true,
    throwOnError: true,
    maxBatch: readMaxBatch(),
  });
  return NextResponse.json(result, {
    headers: {
      "cache-control": "no-store",
    },
  });
}

function rejectInvalidCronRequest(req: Request): NextResponse | null {
  const secret = (process.env.CRON_SECRET ?? "").trim();
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 500 });
    }
    return null;
  }

  const header = req.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match || !tokenMatches(match[1] ?? "", secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return null;
}

function tokenMatches(token: string, configuredToken: string): boolean {
  const tokenBytes = new TextEncoder().encode(token);
  const configuredBytes = new TextEncoder().encode(configuredToken);
  if (tokenBytes.byteLength !== configuredBytes.byteLength) return false;
  return timingSafeEqual(tokenBytes, configuredBytes);
}
