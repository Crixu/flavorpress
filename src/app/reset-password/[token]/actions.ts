"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  SESSION_COOKIE_NAME,
  createSessionCookie,
  getSessionTtlSeconds,
  isAllowedMutationOrigin,
  requestOriginFromHeaders,
} from "@/lib/auth";
import { hashPassword, validatePasswordStrength } from "@/lib/password";
import { consumePasswordResetToken } from "@/lib/email-tokens";
import { getUserById, updatePassword } from "@/lib/users";

function safeToken(raw: string): string {
  if (raw.length > 128) return "";
  return /^[A-Za-z0-9_-]+$/.test(raw) ? raw : "";
}

function errorPath(token: string, error: string): string {
  const safe = safeToken(token);
  if (!safe) return `/reset-password?error=${error}`;
  return `/reset-password/${encodeURIComponent(safe)}?error=${error}`;
}

export async function confirmPasswordResetAction(formData: FormData) {
  const token = String(formData.get("token") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  const headerStore = await headers();
  const requestOrigin = requestOriginFromHeaders(headerStore);
  if (!isAllowedMutationOrigin(headerStore, requestOrigin)) {
    redirect(errorPath(token, "origin"));
  }

  if (!token) redirect("/reset-password?error=token");

  const passwordError = validatePasswordStrength(password);
  if (passwordError) redirect(errorPath(token, "password"));

  const userId = await consumePasswordResetToken(token);
  if (!userId) redirect(errorPath(token, "token"));

  const user = await getUserById(userId);
  if (!user) redirect(errorPath(token, "token"));

  const hash = await hashPassword(password);
  await updatePassword(user.id, hash);

  const fresh = await getUserById(user.id);
  if (!fresh) throw new Error("User vanished after password update");

  const session = await createSessionCookie({
    userId: fresh.id,
    sessionVersion: fresh.sessionVersion,
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

  redirect("/");
}
