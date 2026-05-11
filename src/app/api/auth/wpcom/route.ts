import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import {
  buildAuthorizeUrl,
  isWpcomOAuthConfigured,
  issueWpcomState,
} from "@/lib/wpcom-oauth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function redirectUri(): string {
  const origin = (process.env.FLAVORPRESS_ORIGIN ?? "http://localhost:3000").replace(/\/$/, "");
  return `${origin}/api/auth/wpcom/callback`;
}

function fallbackPath(mode: string, invite: string | null, reason: string): string {
  if (mode === "signup") {
    const params = new URLSearchParams({ error: reason });
    if (invite) params.set("invite", invite);
    return `/signup?${params.toString()}`;
  }
  return `/login?error=${reason}`;
}

export async function GET(req: Request) {
  if (!isWpcomOAuthConfigured()) {
    return NextResponse.json(
      { error: "WP.com OAuth is not configured." },
      { status: 501 },
    );
  }
  const url = new URL(req.url);
  const modeParam = url.searchParams.get("mode");
  const mode: "signup" | "login" = modeParam === "signup" ? "signup" : "login";
  const invite = url.searchParams.get("invite");

  if (mode === "signup" && !invite) {
    return NextResponse.redirect(new URL(fallbackPath("signup", null, "invite"), url.origin));
  }

  const state = await issueWpcomState({
    nonce: randomBytes(16).toString("base64url"),
    mode,
    invite: invite ?? undefined,
  });
  const authorize = buildAuthorizeUrl({ redirectUri: redirectUri(), state });
  return NextResponse.redirect(authorize);
}
