"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { isAllowedMutationOrigin, requestOriginFromHeaders } from "@/lib/auth";
import { hashPassword, validatePasswordStrength } from "@/lib/password";
import { consumePasswordResetToken } from "@/lib/email-tokens";
import { getUserById, markEmailVerified, updatePassword } from "@/lib/users";
import { AUTH_IP_RATE_LIMIT, consumeRateLimit, getClientIp, rateLimitKey } from "@/lib/rate-limit";

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
  const ipLimit = await consumeRateLimit({
    scope: "reset_confirm",
    key: rateLimitKey("ip", getClientIp(headerStore)),
    ...AUTH_IP_RATE_LIMIT,
  });
  if (!ipLimit.ok) redirect(errorPath(token, "rate"));

  if (!token) redirect("/reset-password?error=token");

  const passwordError = validatePasswordStrength(password);
  if (passwordError) redirect(errorPath(token, "password"));

  const userId = await consumePasswordResetToken(token);
  if (!userId) redirect(errorPath(token, "token"));

  const user = await getUserById(userId);
  if (!user) redirect(errorPath(token, "token"));

  const hash = await hashPassword(password);
  await updatePassword(user.id, hash);
  await markEmailVerified(user.id);

  redirect("/login?reset=1");
}
