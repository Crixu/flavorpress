"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  SESSION_COOKIE_NAME,
  SESSION_TTL_SECONDS,
  createSessionCookie,
  hasValidCredentials,
  isAllowedMutationOrigin,
  requestOriginFromHeaders,
  safeRedirectPath,
} from "@/lib/auth";

export async function loginAction(formData: FormData) {
  const next = safeRedirectPath(formData.get("next"));
  const headerStore = await headers();
  const requestOrigin = requestOriginFromHeaders(headerStore);
  if (!isAllowedMutationOrigin(headerStore, requestOrigin)) {
    redirect(loginPath("origin", next));
  }

  const username = String(formData.get("username") ?? "");
  const password = String(formData.get("password") ?? "");
  if (!hasValidCredentials(username, password)) {
    redirect(loginPath("credentials", next));
  }

  const session = await createSessionCookie();
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, session.value, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
    expires: new Date(session.expiresAt),
  });

  redirect(next);
}

function loginPath(error: string, next: string): string {
  const params = new URLSearchParams({ error });
  if (next !== "/") params.set("next", next);
  return `/login?${params.toString()}`;
}
