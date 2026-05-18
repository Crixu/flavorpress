"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { isAllowedMutationOrigin, requestOriginFromHeaders } from "@/lib/auth";
import { getUserByEmail } from "@/lib/users";
import { issuePasswordResetToken } from "@/lib/email-tokens";
import { sendEmail } from "@/lib/email";
import { passwordResetEmail } from "@/lib/email-templates";
import {
  AUTH_ACCOUNT_RATE_LIMIT,
  AUTH_IP_RATE_LIMIT,
  consumeRateLimit,
  getClientIp,
  rateLimitKey,
} from "@/lib/rate-limit";

export async function requestPasswordResetAction(formData: FormData) {
  const headerStore = await headers();
  const requestOrigin = requestOriginFromHeaders(headerStore);
  if (!isAllowedMutationOrigin(headerStore, requestOrigin)) {
    redirect("/reset-password?error=origin");
  }
  const ipLimit = await consumeRateLimit({
    scope: "reset",
    key: rateLimitKey("ip", getClientIp(headerStore)),
    ...AUTH_IP_RATE_LIMIT,
  });
  if (!ipLimit.ok) redirect("/reset-password?error=rate");

  const email = String(formData.get("email") ?? "").trim();
  if (!email) redirect("/reset-password?error=email");

  const accountLimit = await consumeRateLimit({
    scope: "reset",
    key: rateLimitKey("account", email),
    ...AUTH_ACCOUNT_RATE_LIMIT,
  });
  if (!accountLimit.ok) redirect("/reset-password?check=1");

  // Same generic outcome regardless of whether the user exists.
  const user = await getUserByEmail(email);
  if (user && user.passwordHash) {
    const token = await issuePasswordResetToken(user.id);
    const origin = (
      process.env.FLAVORPRESS_ORIGIN ??
      requestOrigin ??
      "http://localhost:3000"
    ).replace(/\/$/, "");
    const url = `${origin}/reset-password/${token}`;
    const tmpl = passwordResetEmail(url);
    try {
      await sendEmail({ to: user.email, subject: tmpl.subject, html: tmpl.html, text: tmpl.text });
    } catch {
      // Log and continue; never surface to the user.
    }
  }

  redirect("/reset-password?check=1");
}
