"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  isAllowedMutationOrigin,
  requestOriginFromHeaders,
} from "@/lib/auth";
import { getUserByEmail } from "@/lib/users";
import { issuePasswordResetToken } from "@/lib/email-tokens";
import { sendEmail } from "@/lib/email";
import { passwordResetEmail } from "@/lib/email-templates";

export async function requestPasswordResetAction(formData: FormData) {
  const headerStore = await headers();
  const requestOrigin = requestOriginFromHeaders(headerStore);
  if (!isAllowedMutationOrigin(headerStore, requestOrigin)) {
    redirect("/reset-password?error=origin");
  }

  const email = String(formData.get("email") ?? "").trim();
  if (!email) redirect("/reset-password?error=email");

  // Same generic outcome regardless of whether the user exists.
  const user = await getUserByEmail(email);
  if (user && user.passwordHash) {
    const token = await issuePasswordResetToken(user.id);
    const origin = (process.env.FLAVORPRESS_ORIGIN ?? requestOrigin ?? "http://localhost:3000").replace(/\/$/, "");
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
