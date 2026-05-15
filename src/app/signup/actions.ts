"use server";

import { randomBytes } from "node:crypto";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { isAllowedMutationOrigin, requestOriginFromHeaders } from "@/lib/auth";
import { db } from "@/lib/db";
import { hashPassword, validatePasswordStrength } from "@/lib/password";
import { consumeInvite, readInvite, InviteError } from "@/lib/invites";
import { createUser, getUserByEmail } from "@/lib/users";
import { issueVerificationToken } from "@/lib/email-tokens";
import { sendEmail } from "@/lib/email";
import { verificationEmail } from "@/lib/email-templates";
import { notifySignupWithEmail } from "@/lib/notifications";

function safeInvite(raw: string): string {
  if (raw.length > 64) return "";
  return /^[A-Za-z0-9_-]+$/.test(raw) ? raw : "";
}

function signupErrorPath(invite: string, error: string): string {
  const params = new URLSearchParams();
  const safe = safeInvite(invite);
  if (safe) params.set("invite", safe);
  params.set("error", error);
  return `/signup?${params.toString()}`;
}

function newUserId(): string {
  return `u_${randomBytes(12).toString("base64url")}`;
}

export async function signupAction(formData: FormData) {
  const invite = safeInvite(String(formData.get("invite") ?? "").trim());
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  const headerStore = await headers();
  const requestOrigin = requestOriginFromHeaders(headerStore);
  if (!isAllowedMutationOrigin(headerStore, requestOrigin)) {
    redirect(signupErrorPath(invite, "origin"));
  }

  if (!invite) redirect(signupErrorPath("", "invite"));
  const inviteRow = await readInvite(invite);
  if (!inviteRow) redirect(signupErrorPath(invite, "invite"));

  const passwordError = validatePasswordStrength(password);
  if (passwordError) redirect(signupErrorPath(invite, "password"));

  if (!email || !email.includes("@")) {
    redirect(signupErrorPath(invite, "email"));
  }

  const existing = await getUserByEmail(email);
  if (existing) redirect("/signup/check-email");

  const hash = await hashPassword(password);
  const userId = newUserId();

  // Consume the invite before any user-table writes. If consumeInvite fails
  // (raced by a concurrent signup), no rollback is needed: the invite-table
  // change is the only write so far.
  try {
    await consumeInvite(invite, userId);
  } catch (err) {
    if (err instanceof InviteError) redirect(signupErrorPath(invite, "invite"));
    throw err;
  }

  // From here on, the invite is consumed. The user write owns first-admin
  // claiming inside the same batch, so concurrent signups cannot both win it.
  // We do not need to roll back the invite on createUser failure because
  // consumeInvite already validated the token was valid at this instant.
  try {
    await createUser({
      email,
      passwordHash: hash,
      claimFirstAdmin: true,
      id: userId,
    });
  } catch {
    redirect(signupErrorPath(invite, "account"));
  }

  // The account is not usable until this email arrives, so failed delivery
  // rolls the just-created signup back and leaves the invite retryable.
  try {
    const verifyToken = await issueVerificationToken(userId);
    const origin = (
      process.env.FLAVORPRESS_ORIGIN ??
      requestOrigin ??
      "http://localhost:3000"
    ).replace(/\/$/, "");
    const url = `${origin}/verify-email/${verifyToken}`;
    const tmpl = verificationEmail(url);
    await sendEmail({ to: email, subject: tmpl.subject, html: tmpl.html, text: tmpl.text });
  } catch {
    await db.batch([
      {
        sql: "DELETE FROM email_verification_tokens WHERE user_id = ? AND used_at IS NULL",
        args: [userId],
      },
      {
        sql: "DELETE FROM users WHERE id = ? AND email_verified_at IS NULL",
        args: [userId],
      },
      {
        sql: `UPDATE invites
              SET used_at = NULL, used_by_user_id = NULL
              WHERE used_by_user_id = ?`,
        args: [userId],
      },
      {
        sql: `UPDATE deployment_state
              SET value = (
                SELECT id FROM users
                WHERE is_admin = 1
                ORDER BY created_at ASC
                LIMIT 1
              )
              WHERE key = 'first_admin_user_id'
                AND value = ?`,
        args: [userId],
      },
    ]);
    redirect(signupErrorPath(invite, "account"));
  }

  after(() => notifySignupWithEmail({ userId, email, method: "email" }));

  redirect("/signup/check-email");
}
