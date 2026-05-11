import "server-only";

const STATE_TTL_MS = 10 * 60 * 1000;

export interface WpcomOAuthState {
  nonce: string;
  mode: "signup" | "login";
  invite?: string;
}

interface SignedStatePayload extends WpcomOAuthState {
  exp: number;
}

type EnvLike = Record<string, string | undefined>;

const encoder = new TextEncoder();

// Set of consumed nonces. Bounded by the TTL window; cleared on test reset.
const consumedNonces = new Set<string>();

export function resetWpcomStateCacheForTests(): void {
  consumedNonces.clear();
}

function getSecret(): string {
  const s = process.env.FLAVORPRESS_SESSION_SECRET;
  if (!s || s.length < 32) {
    throw new Error("FLAVORPRESS_SESSION_SECRET is required for WP.com state signing.");
  }
  return s;
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

function eq(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i += 1) d |= a[i]! ^ b[i]!;
  return d === 0;
}

export async function issueWpcomState(state: WpcomOAuthState): Promise<string> {
  const payload: SignedStatePayload = { ...state, exp: Date.now() + STATE_TTL_MS };
  const part = b64url(encoder.encode(JSON.stringify(payload)));
  const sig = await hmac(part, getSecret());
  return `v1.${part}.${b64url(sig)}`;
}

export async function consumeWpcomState(token: string): Promise<WpcomOAuthState | null> {
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") return null;
  const [, part, sig] = parts;
  if (!part || !sig) return null;
  const expected = await hmac(part, getSecret());
  const actual = b64urlDecode(sig);
  if (!eq(actual, expected)) return null;
  let payload: SignedStatePayload;
  try {
    payload = JSON.parse(new TextDecoder().decode(b64urlDecode(part))) as SignedStatePayload;
  } catch {
    return null;
  }
  if (typeof payload.exp !== "number" || payload.exp <= Date.now()) return null;
  if (typeof payload.nonce !== "string") return null;
  if (payload.mode !== "signup" && payload.mode !== "login") return null;
  if (consumedNonces.has(payload.nonce)) return null;
  consumedNonces.add(payload.nonce);
  // Bound cache growth: drop oldest entries when over a soft cap.
  if (consumedNonces.size > 4096) {
    const drop = consumedNonces.values().next().value;
    if (drop) consumedNonces.delete(drop);
  }
  const out: WpcomOAuthState = { nonce: payload.nonce, mode: payload.mode };
  if (payload.invite) out.invite = payload.invite;
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

export function isWpcomOAuthConfigured(env: EnvLike = process.env): boolean {
  return Boolean(env.WPCOM_OAUTH_CLIENT_ID && env.WPCOM_OAUTH_CLIENT_SECRET);
}

export interface WpcomUserInfo {
  id: string;
  username: string;
  email: string;
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
  const { access_token } = (await tokenRes.json()) as { access_token?: string };
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
