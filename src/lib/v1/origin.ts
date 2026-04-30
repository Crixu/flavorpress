/**
 * Resolve the public origin FlavorPress is running on. Used by:
 *   - server actions building absolute callback URLs (WP authorize flow)
 *   - server components deciding whether to expose flows that require
 *     a reachable HTTPS callback
 *
 * Resolution order:
 *   1. FLAVORPRESS_ORIGIN env (explicit override; macOS app launcher uses
 *      this to pin the random port).
 *   2. Incoming request headers (x-forwarded-proto + host). Set by Vercel,
 *      nginx, Caddy, Cloudflare, etc., so HTTPS deploys "just work" with
 *      no extra config.
 *   3. http://localhost:3000 (last-resort dev fallback).
 */

import { headers } from "next/headers";

export async function getOrigin(): Promise<string> {
  if (process.env.FLAVORPRESS_ORIGIN) return process.env.FLAVORPRESS_ORIGIN;
  try {
    const h = await headers();
    const host = h.get("host");
    if (host) {
      const proto = h.get("x-forwarded-proto") ?? "http";
      return `${proto}://${host}`;
    }
  } catch {
    // headers() throws outside a request scope; fall through.
  }
  return "http://localhost:3000";
}

/**
 * The WordPress one-click authorize flow asks WP to redirect back to a
 * success/reject URL. WP installs commonly refuse to redirect from an
 * HTTPS site to an http:// callback, which means the macOS app (always
 * http://127.0.0.1:...) and `npm run dev` (http://localhost:3000) can
 * never finish that flow against a real WP site. Hide the entry points
 * when we know it can't work.
 */
export async function canUseAuthorizeFlow(): Promise<boolean> {
  try {
    return new URL(await getOrigin()).protocol === "https:";
  } catch {
    return false;
  }
}
