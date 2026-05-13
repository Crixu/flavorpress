import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse, after } from "next/server";
import { SESSION_COOKIE_NAME, createSessionCookie, getSessionTtlSeconds } from "@/lib/auth";
import { db } from "@/lib/db";
import { consumeInvite, InviteError } from "@/lib/invites";
import { notifySignupWithEmail } from "@/lib/notifications";
import { consumeWpcomState, exchangeCodeForUser, isWpcomOAuthConfigured } from "@/lib/wpcom-oauth";
import { createUser, getUserByEmail, hasAdmin } from "@/lib/users";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function origin(): string {
  return (process.env.FLAVORPRESS_ORIGIN ?? "http://localhost:3000").replace(/\/$/, "");
}

function loginErr(reason: string): NextResponse {
  return NextResponse.redirect(new URL(`/login?error=${reason}`, origin()), 302);
}

function signupErr(invite: string | undefined, reason: string): NextResponse {
  const params = new URLSearchParams({ error: reason });
  if (invite) params.set("invite", invite);
  return NextResponse.redirect(new URL(`/signup?${params.toString()}`, origin()), 302);
}

function newUserId(): string {
  return `u_${randomBytes(12).toString("base64url")}`;
}

async function setSessionCookie(userId: string, sessionVersion: number): Promise<void> {
  const session = await createSessionCookie({ userId, sessionVersion });
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, session.value, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: getSessionTtlSeconds(),
    expires: new Date(session.expiresAt),
  });
}

export async function GET(req: Request) {
  if (!isWpcomOAuthConfigured()) {
    return NextResponse.json({ error: "WP.com OAuth is not configured." }, { status: 501 });
  }

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const stateToken = url.searchParams.get("state");
  if (!code || !stateToken) return loginErr("oauth_state");

  const state = await consumeWpcomState(stateToken);
  if (!state) return loginErr("oauth_state");
  if (state.mode !== "signup" && state.mode !== "login") return loginErr("oauth_state");

  let wp;
  try {
    wp = await exchangeCodeForUser({
      code,
      redirectUri: `${origin()}/api/auth/wpcom/callback`,
    });
  } catch {
    return state.mode === "signup" ? signupErr(state.invite, "oauth") : loginErr("oauth");
  }

  if (state.mode === "login") {
    const byWpcom = await db.execute({
      sql: "SELECT id, status, session_version FROM users WHERE wpcom_id = ?",
      args: [wp.id],
    });
    const row = byWpcom.rows[0];
    if (!row) return loginErr("credentials");
    if (String(row.status) !== "active") return loginErr("credentials");
    await setSessionCookie(String(row.id), Number(row.session_version));
    return NextResponse.redirect(new URL("/", origin()), 302);
  }

  if (!state.invite) return signupErr(undefined, "invite");

  const collide = await getUserByEmail(wp.email);
  if (collide) return signupErr(state.invite, "account");

  const byWpcom = await db.execute({
    sql: "SELECT id FROM users WHERE wpcom_id = ?",
    args: [wp.id],
  });
  if (byWpcom.rows.length > 0) return signupErr(state.invite, "account");

  const adminEmail = (process.env.FLAVORPRESS_ADMIN_EMAIL ?? "").trim().toLowerCase();
  const isFirstAdmin =
    adminEmail.length > 0 && wp.email.toLowerCase() === adminEmail && !(await hasAdmin());

  const userId = newUserId();
  try {
    await consumeInvite(state.invite, userId);
  } catch (err) {
    if (err instanceof InviteError) return signupErr(state.invite, "invite");
    throw err;
  }

  try {
    await createUser({
      id: userId,
      email: wp.email,
      passwordHash: null,
      wpcomId: wp.id,
      wpcomUsername: wp.username,
      isAdmin: isFirstAdmin,
    });
    await db.execute({
      sql: "UPDATE users SET email_verified_at = ? WHERE id = ?",
      args: [Date.now(), userId],
    });
  } catch {
    return signupErr(state.invite, "account");
  }

  await setSessionCookie(userId, 0);
  after(() => notifySignupWithEmail({ userId, email: wp.email, method: "wpcom" }));
  return NextResponse.redirect(new URL("/", origin()), 302);
}
