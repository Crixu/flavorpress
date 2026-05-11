import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { consumeVerificationToken } from "@/lib/email-tokens";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface Params {
  params: Promise<{ token: string }>;
}

export async function GET(_req: Request, { params }: Params) {
  const { token } = await params;
  const origin = (process.env.FLAVORPRESS_ORIGIN ?? "").replace(/\/$/, "") || "http://localhost:3000";
  const userId = await consumeVerificationToken(token);
  if (!userId) {
    return NextResponse.redirect(new URL("/verify-email?status=invalid", origin));
  }
  await db.execute({
    sql: "UPDATE users SET email_verified_at = ? WHERE id = ?",
    args: [Date.now(), userId],
  });
  return NextResponse.redirect(new URL("/?verified=1", origin));
}
