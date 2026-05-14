"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  SESSION_COOKIE_NAME,
  createSessionCookie,
  getSessionTtlSeconds,
  isAllowedMutationOrigin,
  requestOriginFromHeaders,
  safeRedirectPath,
} from "@/lib/auth";
import { placeholderHash, verifyPassword } from "@/lib/password";
import { getUserByEmail } from "@/lib/users";

export async function loginAction(formData: FormData) {
  const next = safeRedirectPath(formData.get("next"));
  const headerStore = await headers();
  const requestOrigin = requestOriginFromHeaders(headerStore);
  if (!isAllowedMutationOrigin(headerStore, requestOrigin)) {
    redirect(loginPath("origin", next));
  }

  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  const user = await getUserByEmail(email);
  const hashToVerify = user?.passwordHash ?? (await placeholderHash());
  const ok = await verifyPassword(password, hashToVerify);
  if (!user || !user.passwordHash || !ok || user.status !== "active") {
    redirect(loginPath("credentials", next));
  }

  const session = await createSessionCookie({
    userId: user.id,
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

  redirect(next);
}

function loginPath(error: string, next: string): string {
  const params = new URLSearchParams({ error });
  if (next !== "/") params.set("next", next);
  return `/login?${params.toString()}`;
}
