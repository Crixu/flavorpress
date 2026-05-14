import "server-only";
import { createHmac, hkdfSync } from "node:crypto";
import { getSessionSecret } from "./auth";

const TOKEN_HASH_PREFIX = "fp_h1_";
let cachedKey: Buffer | null = null;
let cachedSecret: string | null = null;

function deriveKey(): Buffer {
  const secret = getSessionSecret();
  if (!secret) {
    throw new Error("FLAVORPRESS_SESSION_SECRET is not configured; cannot derive token hash key.");
  }
  if (cachedKey && cachedSecret === secret) return cachedKey;
  const derived = hkdfSync(
    "sha256",
    Buffer.from(secret, "utf8"),
    Buffer.alloc(0),
    Buffer.from("tokens", "utf8"),
    32,
  );
  cachedKey = Buffer.from(derived);
  cachedSecret = secret;
  return cachedKey;
}

/**
 * HMAC-SHA256 of a token, base64url-encoded. Used to store invite, email
 * verification, and password reset tokens at rest so a DB read inside the TTL
 * window does not yield directly-usable tokens.
 */
export function hashToken(token: string): string {
  const key = deriveKey();
  const digest = createHmac("sha256", key).update(token, "utf8").digest("base64url");
  return `${TOKEN_HASH_PREFIX}${digest}`;
}

export function isStoredTokenHash(token: string): boolean {
  return token.startsWith(TOKEN_HASH_PREFIX);
}
