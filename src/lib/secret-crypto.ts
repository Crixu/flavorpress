import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { homedir } from "node:os";
import path from "node:path";

const SECRET_PREFIX = "fpsec:v1:";
const KEY_ENV = "FLAVORPRESS_ENCRYPTION_KEY";

interface SecretEnvelope {
  alg: "aes-256-gcm";
  iv: string;
  tag: string;
  ct: string;
}

export class SecretCryptoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecretCryptoError";
  }
}

export function hasEncryptionKeyConfigured(): boolean {
  return (process.env[KEY_ENV] ?? "").trim().length > 0;
}

export function isProductionRuntime(): boolean {
  return process.env.NODE_ENV === "production";
}

export function assertProductionEncryptionKey(hasStoredSecrets: boolean): void {
  if (!hasStoredSecrets || !isProductionRuntime() || hasEncryptionKeyConfigured()) return;
  throw new SecretCryptoError(
    "FlavorPress encryption key is required in production because stored secrets exist. Set FLAVORPRESS_ENCRYPTION_KEY to a 32-byte base64 value.",
  );
}

export function isEncryptedSecret(value: string): boolean {
  return value.startsWith(SECRET_PREFIX);
}

export function encryptSecret(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const envelope: SecretEnvelope = {
    alg: "aes-256-gcm",
    iv: toBase64Url(iv),
    tag: toBase64Url(cipher.getAuthTag()),
    ct: toBase64Url(ciphertext),
  };
  return SECRET_PREFIX + toBase64Url(Buffer.from(JSON.stringify(envelope), "utf8"));
}

export function decryptSecret(encrypted: string): string {
  if (!isEncryptedSecret(encrypted)) {
    throw new SecretCryptoError("Secret value is not a FlavorPress encrypted secret.");
  }

  let envelope: SecretEnvelope;
  try {
    envelope = JSON.parse(
      Buffer.from(fromBase64Url(encrypted.slice(SECRET_PREFIX.length))).toString("utf8"),
    ) as SecretEnvelope;
  } catch {
    throw new SecretCryptoError("Secret value has an invalid encrypted envelope.");
  }

  if (envelope.alg !== "aes-256-gcm") {
    throw new SecretCryptoError("Secret value uses an unsupported encryption algorithm.");
  }

  for (const key of getDecryptionKeys()) {
    try {
      const decipher = createDecipheriv("aes-256-gcm", key, fromBase64Url(envelope.iv));
      decipher.setAuthTag(fromBase64Url(envelope.tag));
      return Buffer.concat([
        decipher.update(fromBase64Url(envelope.ct)),
        decipher.final(),
      ]).toString("utf8");
    } catch {
      // Try the next local-dev compatibility key below.
    }
  }
  throw new SecretCryptoError("Secret value could not be decrypted with the configured key.");
}

function getEncryptionKey(): Buffer {
  const configured = (process.env[KEY_ENV] ?? "").trim();
  if (configured) return parseConfiguredKey(configured);
  if (isProductionRuntime()) {
    throw new SecretCryptoError(
      "FLAVORPRESS_ENCRYPTION_KEY is required before storing or reading secrets in production.",
    );
  }
  return localDevelopmentKey("v2");
}

function getDecryptionKeys(): Buffer[] {
  const configured = (process.env[KEY_ENV] ?? "").trim();
  if (configured) return [parseConfiguredKey(configured)];
  if (isProductionRuntime()) return [getEncryptionKey()];

  const keys = [
    localDevelopmentKey("v2"),
    legacyLocalDevelopmentKey(process.cwd()),
    legacyLocalDevelopmentKey(path.join(homedir(), "Studio", "FlavorPress-app")),
  ];
  return dedupeKeys(keys);
}

function localDevelopmentKey(version: "v2"): Buffer {
  return createHash("sha256").update(`FlavorPress local development key:${version}`).digest();
}

function legacyLocalDevelopmentKey(cwd: string): Buffer {
  return createHash("sha256").update(`FlavorPress local development key:${cwd}`).digest();
}

function dedupeKeys(keys: Buffer[]): Buffer[] {
  const seen = new Set<string>();
  return keys.filter((key) => {
    const id = key.toString("hex");
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function parseConfiguredKey(value: string): Buffer {
  if (value.startsWith("base64:")) {
    const decoded = Buffer.from(value.slice("base64:".length), "base64");
    return requireAesKey(decoded);
  }

  if (/^[a-f0-9]{64}$/i.test(value)) {
    return Buffer.from(value, "hex");
  }

  const base64Decoded = Buffer.from(value, "base64");
  if (base64Decoded.length === 32) return base64Decoded;

  return createHash("sha256").update(value).digest();
}

function requireAesKey(value: Buffer): Buffer {
  if (value.length !== 32) {
    throw new SecretCryptoError("FLAVORPRESS_ENCRYPTION_KEY must decode to exactly 32 bytes.");
  }
  return value;
}

function toBase64Url(value: Buffer): string {
  return value.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value: string): Buffer {
  const padded = value
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Buffer.from(padded, "base64");
}
