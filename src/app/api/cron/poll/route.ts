/**
 * Vercel Cron entry point for source polling.
 *
 * The in-process scheduler is disabled on Vercel because serverless
 * functions do not keep a stable Node process alive between requests.
 * This route runs the same due-source pass and waits for queued polls
 * to settle before returning.
 */

import { handlePollCron } from "../_shared";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Vercel Pro gives function invocations up to 5 minutes; Hobby caps at 60s.
// Opt into the 5-minute window so a tick has headroom when many sources
// happen to fall due at once. The maxBatch cap further bounds per-tick
// work so we never get close to this limit.
export const maxDuration = 300;

export async function GET(req: Request) {
  return handlePollCron(req);
}
