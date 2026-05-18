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
import {
  AUTH_ACCOUNT_RATE_LIMIT,
  AUTH_FAILURE_SESSION_BUMP_THRESHOLD,
  AUTH_IP_RATE_LIMIT,
  clearAuthFailures,
  consumeRateLimit,
  getClientIp,
  rateLimitKey,
  recordAuthFailure,
} from "@/lib/rate-limit";
import { bumpSessionVersion, getUserByEmail } from "@/lib/users";

export async function loginAction(formData: FormData) {
  const next = safeRedirectPath(formData.get("next"));
  const headerStore = await headers();
  const requestOrigin = requestOriginFromHeaders(headerStore);
  if (!isAllowedMutationOrigin(headerStore, requestOrigin)) {
    redirect(loginPath("origin", next));
  }
  const ipLimit = await consumeRateLimit({
    scope: "login",
    key: rateLimitKey("ip", getClientIp(headerStore)),
    ...AUTH_IP_RATE_LIMIT,
  });
  if (!ipLimit.ok) redirect(loginPath("rate", next));

  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const accountKey = rateLimitKey("account", email);
  const accountLimit = await consumeRateLimit({
    scope: "login",
    key: accountKey,
    ...AUTH_ACCOUNT_RATE_LIMIT,
  });
  if (!accountLimit.ok) redirect(loginPath("rate", next));

  const user = await getUserByEmail(email);
  const failureKey = user ? rateLimitKey("user", user.id) : null;
  const hashToVerify = user?.passwordHash ?? (await placeholderHash());
  const ok = await verifyPassword(password, hashToVerify);
  if (!user || !user.passwordHash || !ok || user.status !== "active" || !user.emailVerifiedAt) {
    if (user && failureKey) {
      const failureCount = await recordAuthFailure({
        scope: "login_failures",
        key: failureKey,
      });
      if (failureCount % AUTH_FAILURE_SESSION_BUMP_THRESHOLD === 0) {
        await bumpSessionVersion(user.id);
      }
    }
    redirect(loginPath("credentials", next));
  }
  await clearAuthFailures({
    scope: "login_failures",
    key: failureKey!,
  });

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
