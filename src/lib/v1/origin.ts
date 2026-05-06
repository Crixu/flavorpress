/**
 * Resolve the public origin FlavorPress is running on. Used by:
 *   - server actions building absolute callback URLs (WP authorize flow)
 *   - server components deciding whether to expose flows that require
 *     a reachable HTTPS callback
 *
 * Resolution order:
 *   1. FLAVORPRESS_ORIGIN env (explicit override; macOS app launcher uses
 *      this to pin the random port).
 *   2. Incoming request headers, only for safe localhost development.
 *   3. http://localhost:3000 (last-resort non-production fallback).
 */

import { headers } from "next/headers";

export async function getOrigin(): Promise<string> {
  const configured = normalizeOrigin(process.env.FLAVORPRESS_ORIGIN);
  if (configured) return configured;
  if (process.env.FLAVORPRESS_ORIGIN && process.env.NODE_ENV === "production") {
    throw new Error("FLAVORPRESS_ORIGIN must be a valid http or https origin.");
  }

  try {
    const h = await headers();
    const host = h.get("host");
    if (host) {
      const proto = h.get("x-forwarded-proto") ?? "http";
      const candidate = originFromRequestHeaders(proto, host);
      if (candidate && isSafeDevOrigin(candidate)) return candidate;
    }
  } catch {
    // headers() throws outside a request scope; fall through.
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error("FLAVORPRESS_ORIGIN is required in production.");
  }
  return "http://localhost:3000";
}

export function normalizeOrigin(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

function originFromRequestHeaders(protoHeader: string, hostHeader: string): string | null {
  const proto = protoHeader.split(",")[0]?.trim().toLowerCase() || "http";
  const host = hostHeader.split(",")[0]?.trim();
  if (!host || !["http", "https"].includes(proto)) return null;
  if (/[\s/\\]/.test(host)) return null;
  return normalizeOrigin(`${proto}://${host}`);
}

function isSafeDevOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    return ["localhost", "127.0.0.1", "[::1]", "::1"].includes(url.hostname);
  } catch {
    return false;
  }
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
