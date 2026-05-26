/**
 * WordPress Application Password authorize callback.
 *
 * WP redirects here after the user clicks Approve. Query params:
 *   - outlet_id: which outlet we staged before redirecting
 *   - state: one-time server-side authorize nonce
 *   - site_url: WP confirms the base URL
 *   - user_login: WP username
 *   - password: freshly-issued application password
 *
 * The outlet_id pin is what makes 1:N work cleanly: each authorize flow
 * commits credentials to a specific outlet row, not the user.
 */

import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { ensureSchema } from "@/lib/db";
import { probeWordPress } from "@/lib/wordpress";
import { commitOutletCredentials, recordOutletError, getOutlet } from "@/lib/v1/outlets";
import { getOrigin } from "@/lib/v1/origin";
import { isWpAppPasswordRotationEnabled, rotateOutletAppPassword } from "@/lib/v1/wp-rotate";
import {
  consumeWPAuthorizeState,
  normalizeSiteUrl,
  siteOrigin,
  WP_AUTHORIZE_STATE_COOKIE,
  wpAuthorizeStateCookieOptions,
} from "@/lib/v1/wp-authorize-state";

export async function GET(req: Request) {
  await ensureSchema();
  const appOrigin = await getOrigin();
  const url = new URL(req.url);
  const outletId = url.searchParams.get("outlet_id") ?? "";
  const state = url.searchParams.get("state") ?? "";
  const baseUrl = url.searchParams.get("site_url") ?? "";
  const username = url.searchParams.get("user_login") ?? "";
  const callbackAppPassword = url.searchParams.get("password") ?? "";
  const stateCookie = readCookie(req, WP_AUTHORIZE_STATE_COOKIE);
  url.searchParams.delete("password");

  if (!state) {
    return redirectTo("/voice?wp_error=missing_state", appOrigin, true);
  }

  const consumed = await consumeWPAuthorizeState(state);
  if (!consumed.ok) {
    const code = consumed.reason === "expired" ? "expired_state" : "invalid_state";
    return redirectTo(`/voice?wp_error=${code}`, appOrigin, true);
  }

  const authorizeState = consumed.value;
  if (
    authorizeState.boundValue &&
    (!stateCookie || !constantTimeEquals(authorizeState.boundValue, stateCookie))
  ) {
    return redirectTo("/voice?wp_error=state_mismatch", appOrigin, true);
  }

  if (!outletId || outletId !== authorizeState.outletId) {
    return redirectTo("/voice?wp_error=state_mismatch", appOrigin, true);
  }

  if (!baseUrl || !username || !callbackAppPassword) {
    await recordOutletError(outletId, "WordPress authorize callback returned missing fields.");
    return redirectTo("/voice?wp_error=missing_params", appOrigin, true);
  }

  const outlet = await getOutlet(authorizeState.outletId, authorizeState.userId);
  if (!outlet) {
    return redirectTo("/voice?wp_error=unknown_outlet", appOrigin, true);
  }

  const returnedSiteUrl = normalizeSiteUrl(baseUrl);
  const stagedSiteUrl = normalizeSiteUrl(outlet.baseUrl);
  const returnedOrigin = returnedSiteUrl ? siteOrigin(returnedSiteUrl) : null;
  const stagedOrigin = stagedSiteUrl ? siteOrigin(stagedSiteUrl) : null;
  if (
    !returnedSiteUrl ||
    !stagedSiteUrl ||
    returnedSiteUrl !== authorizeState.expectedSiteUrl ||
    stagedSiteUrl !== authorizeState.expectedSiteUrl ||
    !returnedOrigin ||
    returnedOrigin !== authorizeState.expectedSiteOrigin ||
    stagedOrigin !== authorizeState.expectedSiteOrigin
  ) {
    await recordOutletError(
      authorizeState.outletId,
      "WordPress authorize callback returned a different site URL.",
    );
    return redirectTo("/voice?wp_error=site_mismatch", appOrigin, true);
  }

  const probe = await probeWordPress({
    baseUrl,
    username,
    appPassword: callbackAppPassword,
  });
  if (!probe.ok) {
    await recordOutletError(outletId, probe.message, probe.kind);
    return redirectTo(`/voice?wp_error=${encodeURIComponent(probe.message)}`, appOrigin, true);
  }

  let appPasswordToStore = callbackAppPassword;
  if (isWpAppPasswordRotationEnabled()) {
    try {
      const rotation = await rotateOutletAppPassword({
        baseUrl: returnedSiteUrl,
        username,
        appPassword: callbackAppPassword,
      });
      appPasswordToStore = rotation.appPassword;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await recordOutletError(outletId, `WordPress credential rotation failed: ${message}`);
      return redirectTo("/voice?wp_error=credential_rotation_failed", appOrigin, true);
    }
  }

  await commitOutletCredentials(outletId, username, appPasswordToStore, probe.kind);
  return redirectTo(`/voice?wp_connected=${outletId}`, appOrigin, true);
}

function redirectTo(path: string, origin: string, clearStateCookie = false): NextResponse {
  const response = NextResponse.redirect(new URL(path, origin));
  response.headers.set("Referrer-Policy", "no-referrer");
  response.headers.set("Cache-Control", "no-store");
  if (clearStateCookie) {
    response.cookies.set(WP_AUTHORIZE_STATE_COOKIE, "", {
      ...wpAuthorizeStateCookieOptions(0),
      expires: new Date(0),
    });
  }
  return response;
}

function readCookie(req: Request, name: string): string | null {
  const raw = req.headers.get("cookie");
  if (!raw) return null;
  const prefix = `${name}=`;
  for (const part of raw.split(";")) {
    const trimmed = part.trim();
    if (!trimmed.startsWith(prefix)) continue;
    return trimmed.slice(prefix.length);
  }
  return null;
}

function constantTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
