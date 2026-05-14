import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { ensureRegisteredCapabilities } from "@/lib/v1/bootstrap";
import { runDuePolls } from "@/lib/v1/scheduler";

function readMaxBatch(): number | undefined {
  const raw = process.env.FLAVORPRESS_CRON_MAX_BATCH;
  if (!raw) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return Math.floor(n);
}

function tokenMatches(token: string, configuredToken: string): boolean {
  const tokenBytes = createHash("sha256").update(token).digest();
  const configuredBytes = createHash("sha256").update(configuredToken).digest();
  if (tokenBytes.byteLength !== configuredBytes.byteLength) return false;
  return timingSafeEqual(tokenBytes, configuredBytes);
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

export async function handlePollCron(req: Request): Promise<NextResponse> {
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
