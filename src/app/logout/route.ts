import { cookies, headers } from "next/headers";
import { NextResponse } from "next/server";
import {
  LEGACY_SESSION_COOKIE_NAME,
  SESSION_COOKIE_NAME,
  isAllowedMutationOrigin,
  requestOriginFromHeaders,
  verifySessionCookie,
} from "@/lib/auth";
import { bumpSessionVersionIfActiveAndCurrent } from "@/lib/users";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST() {
  const headerStore = await headers();
  const requestOrigin = requestOriginFromHeaders(headerStore);
  if (!isAllowedMutationOrigin(headerStore, requestOrigin)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const cookieStore = await cookies();
  const sessionCookie =
    cookieStore.get(SESSION_COOKIE_NAME)?.value ??
    cookieStore.get(LEGACY_SESSION_COOKIE_NAME)?.value;
  const verified = await verifySessionCookie(sessionCookie);
  if (verified) {
    await bumpSessionVersionIfActiveAndCurrent(verified.userId, verified.sessionVersion);
  }

  for (const name of [SESSION_COOKIE_NAME, LEGACY_SESSION_COOKIE_NAME]) {
    cookieStore.set(name, "", {
      httpOnly: true,
      sameSite: "lax",
      secure: true,
      path: "/",
      maxAge: 0,
      expires: new Date(0),
    });
  }

  return NextResponse.redirect(new URL("/login", requestOrigin ?? "http://localhost:3000"), 303);
}
