import { cookies, headers } from "next/headers";
import { NextResponse } from "next/server";
import {
  LEGACY_SESSION_COOKIE_NAME,
  SESSION_COOKIE_NAME,
  isAllowedMutationOrigin,
  requestOriginFromHeaders,
} from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST() {
  const headerStore = await headers();
  const requestOrigin = requestOriginFromHeaders(headerStore);
  if (!isAllowedMutationOrigin(headerStore, requestOrigin)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const cookieStore = await cookies();
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
