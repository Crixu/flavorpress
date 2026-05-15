import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE_NAME, createSessionCookie, getSessionTtlSeconds } from "@/lib/auth";
import { consumeVerificationToken } from "@/lib/email-tokens";
import { getUserById, markEmailVerified } from "@/lib/users";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface Params {
  params: Promise<{ token: string }>;
}

export async function GET(_req: Request, { params }: Params) {
  const { token } = await params;
  const origin =
    (process.env.FLAVORPRESS_ORIGIN ?? "").replace(/\/$/, "") || "http://localhost:3000";
  const userId = await consumeVerificationToken(token);
  if (!userId) {
    return NextResponse.redirect(new URL("/verify-email?status=invalid", origin));
  }
  await markEmailVerified(userId);
  const user = await getUserById(userId);
  if (!user || user.status !== "active") {
    return NextResponse.redirect(new URL("/verify-email?status=invalid", origin));
  }
  const session = await createSessionCookie({
    userId,
    sessionVersion: user.sessionVersion,
  });
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, session.value, {
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    path: "/",
    maxAge: getSessionTtlSeconds(),
    expires: new Date(session.expiresAt),
  });
  return NextResponse.redirect(new URL("/?verified=1", origin));
}
