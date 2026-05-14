export const SESSION_COOKIE_NAME = "__Host-flavorpress_session";
export const LEGACY_SESSION_COOKIE_NAME = "flavorpress_session";
export const SESSION_TTL_SECONDS_DEV = 60 * 60 * 24 * 7;
export const SESSION_TTL_SECONDS_PROD = 60 * 60 * 24;

const encoder = new TextEncoder();

type Env = Record<string, string | undefined>;

export interface SessionCookie {
  value: string;
  expiresAt: number;
}

export interface VerifiedSessionPayload {
  userId: string;
  sessionVersion: number;
  issuedAt: number;
  expiresAt: number;
}

interface SessionPayload {
  sub: string;
  v: number;
  iat: number;
  exp: number;
}

interface HeaderLike {
  get(name: string): string | null;
}

export function getSessionTtlSeconds(env: Env = process.env): number {
  return env.NODE_ENV === "production" ? SESSION_TTL_SECONDS_PROD : SESSION_TTL_SECONDS_DEV;
}

export function getSessionSecret(env: Env = process.env): string | null {
  const secret = env.FLAVORPRESS_SESSION_SECRET;
  if (secret && secret.length >= 32) return secret;
  return null;
}

// The session cookie is signed (HMAC-SHA-256) but not encrypted. The payload
// holds only userId, sessionVersion, issuedAt, expiresAt; none are sensitive.
// If SessionPayload grows to include email, roles, or other confidential
// fields, switch to AEAD and rotate the secret.
export async function createSessionCookie(opts: {
  userId: string;
  sessionVersion: number;
  secret?: string;
  now?: number;
  ttlSeconds?: number;
}): Promise<SessionCookie> {
  const secret = opts.secret ?? getSessionSecret();
  if (!secret) throw new Error("FLAVORPRESS_SESSION_SECRET is not configured.");
  const now = opts.now ?? Date.now();
  const ttl = opts.ttlSeconds ?? getSessionTtlSeconds();
  const expiresAt = now + ttl * 1000;
  const payload: SessionPayload = {
    sub: opts.userId,
    v: opts.sessionVersion,
    iat: Math.floor(now / 1000),
    exp: Math.floor(expiresAt / 1000),
  };
  const payloadPart = base64UrlEncode(encoder.encode(JSON.stringify(payload)));
  const signature = await hmac(payloadPart, secret);
  return {
    value: `v2.${payloadPart}.${base64UrlEncode(signature)}`,
    expiresAt,
  };
}

export async function verifySessionCookie(
  cookieValue: string | undefined | null,
  secret?: string,
  now = Date.now(),
): Promise<VerifiedSessionPayload | null> {
  if (!cookieValue) return null;
  const effectiveSecret = secret ?? getSessionSecret();
  if (!effectiveSecret) return null;

  const parts = cookieValue.split(".");
  if (parts.length !== 3 || parts[0] !== "v2") return null;
  const [, payloadPart, signaturePart] = parts;
  if (!payloadPart || !signaturePart) return null;

  const expected = await hmac(payloadPart, effectiveSecret);
  const actual = base64UrlDecode(signaturePart);
  if (actual.length !== expected.length) return null;
  if (!constantTimeEqualBytes(actual, expected)) return null;

  const payload = parsePayload(payloadPart);
  if (!payload) return null;
  if (payload.exp * 1000 <= now) return null;
  return {
    userId: payload.sub,
    sessionVersion: payload.v,
    issuedAt: payload.iat * 1000,
    expiresAt: payload.exp * 1000,
  };
}

export function isMutationMethod(method: string): boolean {
  return ["POST", "PUT", "PATCH", "DELETE"].includes(method.toUpperCase());
}

export function isAllowedMutationOrigin(
  headers: HeaderLike,
  requestOrigin: string | null,
  env: Env = process.env,
): boolean {
  const origin = headers.get("origin");
  if (origin) return isAllowedOrigin(origin, requestOrigin, env);

  const referer = headers.get("referer");
  if (referer) return isAllowedOrigin(referer, requestOrigin, env);

  const fetchSite = headers.get("sec-fetch-site")?.toLowerCase();
  if (!fetchSite) return false;
  return fetchSite === "same-origin" || fetchSite === "none";
}

export function isAllowedOrigin(
  value: string,
  requestOrigin: string | null,
  env: Env = process.env,
): boolean {
  const normalized = normalizeOrigin(value);
  if (!normalized) return false;
  const allowed = new Set<string>();
  if (requestOrigin) {
    const normalizedRequestOrigin = normalizeOrigin(requestOrigin);
    if (normalizedRequestOrigin) allowed.add(normalizedRequestOrigin);
  }
  for (const candidate of (env.FLAVORPRESS_ALLOWED_ORIGINS ?? "").split(",")) {
    const normalizedCandidate = normalizeOrigin(candidate.trim());
    if (normalizedCandidate) allowed.add(normalizedCandidate);
  }
  return allowed.has(normalized);
}

export function safeRedirectPath(value: FormDataEntryValue | string | null | undefined): string {
  const raw = typeof value === "string" ? value : "";
  let decoded: string | null = null;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    decoded = null;
  }
  if (hasRedirectBackslash(raw) || (decoded !== null && hasRedirectBackslash(decoded))) return "/";
  if (!raw.startsWith("/") || raw.startsWith("//")) return "/";
  try {
    const parsed = new URL(raw, "http://flavorpress.local");
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return "/";
  }
}

export function requestOriginFromHeaders(headers: HeaderLike): string | null {
  const origin = headers.get("origin");
  const normalizedOrigin = origin ? normalizeOrigin(origin) : null;
  if (normalizedOrigin) return normalizedOrigin;

  const referer = headers.get("referer");
  const normalizedReferer = referer ? normalizeOrigin(referer) : null;
  if (normalizedReferer) return normalizedReferer;

  const host = headers.get("x-forwarded-host") ?? headers.get("host");
  if (!host) return null;
  const normalizedHost = host.split(",")[0]?.trim() ?? "";
  const isLocalHost =
    normalizedHost.startsWith("localhost") ||
    normalizedHost.startsWith("127.0.0.1") ||
    normalizedHost.startsWith("[::1]");
  const fallbackProto = isLocalHost ? "http" : "https";
  const proto =
    (headers.get("x-forwarded-proto") ?? fallbackProto).split(",")[0]?.trim() || fallbackProto;
  return `${proto}://${host.split(",")[0]?.trim()}`;
}

function hasRedirectBackslash(value: string): boolean {
  return /[\\﹨＼]/.test(value);
}

function parsePayload(payloadPart: string): SessionPayload | null {
  try {
    const payload = JSON.parse(
      new TextDecoder().decode(base64UrlDecode(payloadPart)),
    ) as Partial<SessionPayload>;
    if (typeof payload.sub !== "string") return null;
    if (typeof payload.v !== "number") return null;
    if (typeof payload.iat !== "number") return null;
    if (typeof payload.exp !== "number") return null;
    return payload as SessionPayload;
  } catch {
    return null;
  }
}

async function hmac(message: string, secret: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return new Uint8Array(signature);
}

function normalizeOrigin(value: string): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function base64UrlDecode(value: string): Uint8Array {
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function constantTimeEqualBytes(a: Uint8Array, b: Uint8Array): boolean {
  const maxLength = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < maxLength; i += 1) {
    diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  }
  return diff === 0;
}
