"use server";

import { randomBytes } from "node:crypto";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { after } from "next/server";
import {
  SESSION_COOKIE_NAME,
  createSessionCookie,
  getSessionTtlSeconds,
  isAllowedMutationOrigin,
  requestOriginFromHeaders,
} from "@/lib/auth";
import { db } from "@/lib/db";
import { hashPassword, validatePasswordStrength } from "@/lib/password";
import { consumeInvite, readInvite, InviteError } from "@/lib/invites";
import { createUser, getUserByEmail, hasAdmin, migrateDefaultUser } from "@/lib/users";
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
  const adminEmail = (process.env.FLAVORPRESS_ADMIN_EMAIL ?? "").trim().toLowerCase();
  const isFirstAdmin =
    adminEmail.length > 0 && email.toLowerCase() === adminEmail && !(await hasAdmin());

  const defaultRow = isFirstAdmin
    ? await db.execute({ sql: "SELECT 1 FROM users WHERE id = 'default-user'" })
    : { rows: [] as unknown[] };
  const shouldMigrate = isFirstAdmin && defaultRow.rows.length > 0;

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

  // From here on, the invite is consumed. Both branches commit the user.
  // We do not need to roll back the invite on createUser failure because
  // consumeInvite already validated the token was valid at this instant.
  if (shouldMigrate) {
    await migrateDefaultUser({
      newId: userId,
      email,
      passwordHash: hash,
      isAdmin: true,
    });
  } else {
    try {
      await createUser({
        email,
        passwordHash: hash,
        isAdmin: isFirstAdmin,
        id: userId,
      });
    } catch {
      redirect(signupErrorPath(invite, "account"));
    }
  }

  const session = await createSessionCookie({ userId, sessionVersion: 0 });
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, session.value, {
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    path: "/",
    maxAge: getSessionTtlSeconds(),
    expires: new Date(session.expiresAt),
  });

  // Send verification email. Swallow errors so a transient email-provider
  // failure does not block signup.
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
    // best-effort
  }

  after(() => notifySignupWithEmail({ userId, email, method: "email" }));

  redirect("/");
}
