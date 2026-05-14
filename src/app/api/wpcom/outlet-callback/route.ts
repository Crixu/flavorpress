import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { AuthRequiredError, requireSession } from "@/lib/session";
import { commitOutletWpcomOAuthCredentials, recordOutletError } from "@/lib/v1/outlets";
import { getOrigin } from "@/lib/v1/origin";
import {
  consumeWpcomState,
  exchangeCodeForSiteConnection,
  isWpcomOAuthConfigured,
  WPCOM_OAUTH_STATE_COOKIE,
  wpcomStateCookieOptions,
} from "@/lib/wpcom-oauth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function redirectTo(path: string): Promise<NextResponse> {
  return NextResponse.redirect(new URL(path, await getOrigin()), 302);
}

async function clearStateCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(WPCOM_OAUTH_STATE_COOKIE, "", {
    ...wpcomStateCookieOptions(0),
    expires: new Date(0),
  });
}

export async function GET(req: Request) {
  if (!isWpcomOAuthConfigured()) {
    return NextResponse.json({ error: "WP.com OAuth is not configured." }, { status: 501 });
  }

  try {
    let session;
    try {
      session = await requireSession();
    } catch (err) {
      if (err instanceof AuthRequiredError) return redirectTo("/login?error=credentials");
      throw err;
    }

    const url = new URL(req.url);
    const error = url.searchParams.get("error");
    if (error) return redirectTo(`/voice?wp_error=${encodeURIComponent(error)}`);

    const code = url.searchParams.get("code");
    const stateToken = url.searchParams.get("state");
    if (!code || !stateToken) return redirectTo("/voice?wp_error=oauth_state");

    const cookieStore = await cookies();
    const cookieNonce = cookieStore.get(WPCOM_OAUTH_STATE_COOKIE)?.value;
    if (!cookieNonce) return redirectTo("/voice?wp_error=oauth_state");

    const state = await consumeWpcomState(stateToken);
    if (
      !state ||
      state.nonce !== cookieNonce ||
      state.mode !== "outlet" ||
      !state.outletId ||
      !state.expectedSiteUrl ||
      state.userId !== session.userId
    ) {
      return redirectTo("/voice?wp_error=oauth_state");
    }

    try {
      const connection = await exchangeCodeForSiteConnection({
        code,
        redirectUri: `${await getOrigin()}/api/wpcom/outlet-callback`,
        expectedSiteUrl: state.expectedSiteUrl,
      });
      await commitOutletWpcomOAuthCredentials({
        outletId: state.outletId,
        accessToken: connection.accessToken,
        siteId: connection.siteId,
        siteUrl: connection.siteUrl,
        siteName: connection.siteName,
        username: connection.username,
        kind: connection.isJetpack ? "jetpack-managed" : "wp-com",
      });
      return redirectTo(`/voice?wp_connected=${state.outletId}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "WordPress.com authorization failed.";
      await recordOutletError(state.outletId, message);
      return redirectTo(`/voice?wp_error=${encodeURIComponent(message)}`);
    }
  } finally {
    await clearStateCookie();
  }
}
