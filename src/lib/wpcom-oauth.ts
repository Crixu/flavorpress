import "server-only";
import { timingSafeEqual } from "node:crypto";

const STATE_TTL_MS = 10 * 60 * 1000;
let warnedFallbackSecret = false;

export const WPCOM_OAUTH_STATE_COOKIE = "fp_wpcom_state";
export const WPCOM_OAUTH_STATE_COOKIE_TTL_SECONDS = STATE_TTL_MS / 1000;

export interface WpcomOAuthState {
  nonce: string;
  mode: "signup" | "login" | "outlet";
  invite?: string;
  userId?: string;
  outletId?: string;
  expectedSiteUrl?: string;
}

interface SignedStatePayload extends WpcomOAuthState {
  exp: number;
}

type EnvLike = Record<string, string | undefined>;

const encoder = new TextEncoder();

// Set of consumed nonces. Bounded by the TTL window; cleared on test reset.
const consumedNonces = new Set<string>();

export function wpcomStateCookieOptions(maxAgeSec: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/api",
    maxAge: maxAgeSec,
  };
}

export function resetWpcomStateCacheForTests(): void {
  consumedNonces.clear();
}

export function getWpcomStateSecret(): string {
  const dedicated = process.env.FLAVORPRESS_WPCOM_STATE_SECRET;
  if (dedicated && dedicated.length >= 32) return dedicated;
  const shared = process.env.FLAVORPRESS_SESSION_SECRET;
  if (shared && shared.length >= 32) {
    if (!warnedFallbackSecret) {
      warnedFallbackSecret = true;
      console.warn(
        "FLAVORPRESS_WPCOM_STATE_SECRET is unset; falling back to FLAVORPRESS_SESSION_SECRET. Set a dedicated secret before the next release.",
      );
    }
    return shared;
  }
  throw new Error(
    "FLAVORPRESS_WPCOM_STATE_SECRET (or fallback FLAVORPRESS_SESSION_SECRET) is required for WP.com state signing.",
  );
}

async function hmac(message: string, secret: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return new Uint8Array(sig);
}

function b64url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function b64urlDecode(s: string): Uint8Array {
  const base = s.replaceAll("-", "+").replaceAll("_", "/");
  const padded = base.padEnd(base.length + ((4 - (base.length % 4)) % 4), "=");
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

export async function issueWpcomState(state: WpcomOAuthState): Promise<string> {
  const payload: SignedStatePayload = { ...state, exp: Date.now() + STATE_TTL_MS };
  const part = b64url(encoder.encode(JSON.stringify(payload)));
  const sig = await hmac(part, getWpcomStateSecret());
  return `v1.${part}.${b64url(sig)}`;
}

export async function consumeWpcomState(token: string): Promise<WpcomOAuthState | null> {
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") return null;
  const [, part, sig] = parts;
  if (!part || !sig) return null;
  const expected = await hmac(part, getWpcomStateSecret());
  const actual = b64urlDecode(sig);
  if (actual.length !== expected.length) return null;
  if (!timingSafeEqual(actual, expected)) return null;
  let payload: SignedStatePayload;
  try {
    payload = JSON.parse(new TextDecoder().decode(b64urlDecode(part))) as SignedStatePayload;
  } catch {
    return null;
  }
  if (typeof payload.exp !== "number" || payload.exp <= Date.now()) return null;
  if (typeof payload.nonce !== "string") return null;
  if (payload.mode !== "signup" && payload.mode !== "login" && payload.mode !== "outlet") {
    return null;
  }
  if (consumedNonces.has(payload.nonce)) return null;
  consumedNonces.add(payload.nonce);
  // Bound cache growth: drop oldest entries when over a soft cap.
  if (consumedNonces.size > 4096) {
    const drop = consumedNonces.values().next().value;
    if (drop) consumedNonces.delete(drop);
  }
  const out: WpcomOAuthState = { nonce: payload.nonce, mode: payload.mode };
  if (payload.invite) out.invite = payload.invite;
  if (payload.userId) out.userId = payload.userId;
  if (payload.outletId) out.outletId = payload.outletId;
  if (payload.expectedSiteUrl) out.expectedSiteUrl = payload.expectedSiteUrl;
  return out;
}

export function buildAuthorizeUrl(opts: { redirectUri: string; state: string }): string {
  const url = new URL("https://public-api.wordpress.com/oauth2/authorize");
  url.searchParams.set("client_id", process.env.WPCOM_OAUTH_CLIENT_ID ?? "");
  url.searchParams.set("redirect_uri", opts.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "auth");
  url.searchParams.set("state", opts.state);
  return url.toString();
}

export function buildSiteAuthorizeUrl(opts: {
  redirectUri: string;
  state: string;
  siteUrl: string;
}): string {
  const url = new URL("https://public-api.wordpress.com/oauth2/authorize");
  url.searchParams.set("client_id", process.env.WPCOM_OAUTH_CLIENT_ID ?? "");
  url.searchParams.set("redirect_uri", opts.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "sites posts media");
  url.searchParams.set("blog", opts.siteUrl);
  url.searchParams.set("state", opts.state);
  return url.toString();
}

export function isWpcomOAuthConfigured(env: EnvLike = process.env): boolean {
  return Boolean(env.WPCOM_OAUTH_CLIENT_ID && env.WPCOM_OAUTH_CLIENT_SECRET);
}

export interface WpcomUserInfo {
  id: string;
  username: string;
  email: string;
}

export interface WpcomSiteConnection {
  accessToken: string;
  siteId: string;
  siteUrl: string;
  siteName: string | null;
  username: string | null;
  isJetpack: boolean;
}

interface TokenResponse {
  access_token?: string;
  blog_id?: string | number;
  blog_url?: string;
}

export async function exchangeCodeForUser(opts: {
  code: string;
  redirectUri: string;
}): Promise<WpcomUserInfo> {
  const clientId = process.env.WPCOM_OAUTH_CLIENT_ID;
  const clientSecret = process.env.WPCOM_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("WP.com OAuth env vars are not configured.");
  }
  const tokenRes = await fetch("https://public-api.wordpress.com/oauth2/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code: opts.code,
      grant_type: "authorization_code",
      redirect_uri: opts.redirectUri,
    }).toString(),
  });
  if (!tokenRes.ok) {
    const body = await tokenRes.text().catch(() => "<unreadable>");
    throw new Error(`WP.com token exchange failed (${tokenRes.status}): ${body}`);
  }
  const { access_token } = (await tokenRes.json()) as TokenResponse;
  if (!access_token) throw new Error("WP.com token exchange returned no access_token.");

  const meRes = await fetch("https://public-api.wordpress.com/rest/v1.1/me", {
    headers: { authorization: `Bearer ${access_token}` },
  });
  if (!meRes.ok) {
    const body = await meRes.text().catch(() => "<unreadable>");
    throw new Error(`WP.com /me failed (${meRes.status}): ${body}`);
  }
  const me = (await meRes.json()) as {
    ID?: number;
    username?: string;
    email?: string;
  };
  if (!me.ID || !me.username || !me.email) {
    throw new Error("WP.com /me returned incomplete user info.");
  }
  return {
    id: String(me.ID),
    username: me.username,
    email: me.email,
  };
}

function normalizeSiteUrl(raw: string): string {
  try {
    const u = new URL(raw);
    u.hash = "";
    u.search = "";
    return u.toString().replace(/\/$/, "");
  } catch {
    return raw.trim().replace(/\/$/, "");
  }
}

function sameSite(a: string, b: string): boolean {
  try {
    const aa = new URL(normalizeSiteUrl(a));
    const bb = new URL(normalizeSiteUrl(b));
    return aa.hostname.toLowerCase() === bb.hostname.toLowerCase();
  } catch {
    return normalizeSiteUrl(a).toLowerCase() === normalizeSiteUrl(b).toLowerCase();
  }
}

function siteLookupKey(raw: string): string {
  try {
    const u = new URL(raw);
    return u.hostname;
  } catch {
    return raw;
  }
}

async function fetchSiteInfo(opts: {
  accessToken?: string | null;
  site: string;
}): Promise<{ id: string; url: string; name: string | null; isJetpack: boolean }> {
  const headers: Record<string, string> = {};
  if (opts.accessToken) headers.authorization = `Bearer ${opts.accessToken}`;
  const res = await fetch(
    `https://public-api.wordpress.com/rest/v1.1/sites/${encodeURIComponent(opts.site)}`,
    { headers },
  );
  if (!res.ok) {
    const body = await res.text().catch(() => "<unreadable>");
    throw new Error(`WP.com site lookup failed (${res.status}): ${body}`);
  }
  const site = (await res.json()) as {
    ID?: number;
    URL?: string;
    name?: string;
    jetpack?: boolean;
    is_jetpack?: boolean;
  };
  if (!site.ID) throw new Error("WP.com site lookup returned no site ID.");
  return {
    id: String(site.ID),
    url: normalizeSiteUrl(site.URL ?? opts.site),
    name: site.name ? String(site.name) : null,
    isJetpack: Boolean(site.jetpack ?? site.is_jetpack),
  };
}

export async function resolveWpcomSiteBlogId(siteUrl: string): Promise<string | null> {
  const site = await fetchSiteInfo({ site: siteLookupKey(siteUrl) });
  return site.id;
}

export async function exchangeCodeForSiteConnection(opts: {
  code: string;
  redirectUri: string;
  expectedSiteUrl: string;
  expectedBlogId?: string | null;
}): Promise<WpcomSiteConnection> {
  const clientId = process.env.WPCOM_OAUTH_CLIENT_ID;
  const clientSecret = process.env.WPCOM_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("WP.com OAuth env vars are not configured.");
  }
  const tokenRes = await fetch("https://public-api.wordpress.com/oauth2/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code: opts.code,
      grant_type: "authorization_code",
      redirect_uri: opts.redirectUri,
    }).toString(),
  });
  if (!tokenRes.ok) {
    const body = await tokenRes.text().catch(() => "<unreadable>");
    throw new Error(`WP.com token exchange failed (${tokenRes.status}): ${body}`);
  }
  const token = (await tokenRes.json()) as TokenResponse;
  if (!token.access_token) throw new Error("WP.com token exchange returned no access_token.");

  if (opts.expectedBlogId != null) {
    const returnedBlogId = token.blog_id != null ? String(token.blog_id) : null;
    if (returnedBlogId !== opts.expectedBlogId) {
      throw new Error("WordPress.com returned a different site than the one requested.");
    }
  }

  const meRes = await fetch("https://public-api.wordpress.com/rest/v1.1/me", {
    headers: { authorization: `Bearer ${token.access_token}` },
  });
  const me = meRes.ok
    ? ((await meRes.json()) as { username?: string })
    : ({ username: undefined } as { username?: string });

  const initialSite = token.blog_id ? String(token.blog_id) : siteLookupKey(opts.expectedSiteUrl);
  let site = await fetchSiteInfo({ accessToken: token.access_token, site: initialSite });
  if (opts.expectedBlogId == null && !sameSite(opts.expectedSiteUrl, site.url)) {
    const expectedSite = await fetchSiteInfo({
      accessToken: token.access_token,
      site: siteLookupKey(opts.expectedSiteUrl),
    });
    if (expectedSite.id !== site.id) {
      throw new Error("WordPress.com returned a different site than the one requested.");
    }
    site = expectedSite;
  }

  return {
    accessToken: token.access_token,
    siteId: site.id,
    siteUrl: site.url,
    siteName: site.name,
    username: me.username ? String(me.username) : null,
    isJetpack: site.isJetpack,
  };
}
