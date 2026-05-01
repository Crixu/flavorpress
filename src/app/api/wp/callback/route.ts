/**
 * WordPress Application Password authorize callback.
 *
 * WP redirects here after the user clicks Approve. Query params:
 *   - outlet_id: which outlet we staged before redirecting
 *   - site_url: WP confirms the base URL
 *   - user_login: WP username
 *   - password: freshly-issued application password
 *
 * The outlet_id pin is what makes 1:N work cleanly: each authorize flow
 * commits credentials to a specific outlet row, not the user.
 */

import { NextResponse } from "next/server";
import { ensureSchema, ensureSingleUser } from "@/lib/db";
import { probeWordPress } from "@/lib/wordpress";
import { commitOutletCredentials, recordOutletError, getOutlet } from "@/lib/v1/outlets";

export async function GET(req: Request) {
  await ensureSchema();
  await ensureSingleUser();
  const url = new URL(req.url);
  const outletId = url.searchParams.get("outlet_id") ?? "";
  const baseUrl = url.searchParams.get("site_url") ?? "";
  const username = url.searchParams.get("user_login") ?? "";
  const password = url.searchParams.get("password") ?? "";

  if (!outletId || !baseUrl || !username || !password) {
    return NextResponse.redirect(new URL("/voice?wp_error=missing_params", url.origin));
  }

  const outlet = await getOutlet(outletId);
  if (!outlet) {
    return NextResponse.redirect(new URL("/voice?wp_error=unknown_outlet", url.origin));
  }

  const probe = await probeWordPress({
    baseUrl,
    username,
    appPassword: password,
  });
  if (!probe.ok) {
    await recordOutletError(outletId, probe.message, probe.kind);
    return NextResponse.redirect(
      new URL(`/voice?wp_error=${encodeURIComponent(probe.message)}`, url.origin),
    );
  }

  await commitOutletCredentials(outletId, username, password, probe.kind);
  return NextResponse.redirect(new URL(`/voice?wp_connected=${outletId}`, url.origin));
}
