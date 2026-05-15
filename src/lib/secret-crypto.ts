import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

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

let testEncryptionKey: Buffer | undefined;

export function assertEncryptionKeyAtBoot(): void {
  if (process.env.NODE_ENV === "test" && testEncryptionKey) return;
  loadEncryptionKey();
}

export function __setEncryptionKeyForTests(key: Buffer): void {
  if (process.env.NODE_ENV !== "test") {
    throw new SecretCryptoError("Test encryption keys can only be injected under NODE_ENV=test.");
  }
  testEncryptionKey = Buffer.from(requireAesKey(key));
}

export function __resetEncryptionKeyForTests(): void {
  testEncryptionKey = undefined;
}

export function isEncryptedSecret(value: string): boolean {
  return value.startsWith(SECRET_PREFIX);
}

export function encryptSecret(plaintext: string): string {
  const key = loadEncryptionKey();
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

  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      loadEncryptionKey(),
      fromBase64Url(envelope.iv),
    );
    decipher.setAuthTag(fromBase64Url(envelope.tag));
    return Buffer.concat([decipher.update(fromBase64Url(envelope.ct)), decipher.final()]).toString(
      "utf8",
    );
  } catch {
    throw new SecretCryptoError("Secret value could not be decrypted with the configured key.");
  }
}

function loadEncryptionKey(): Buffer {
  if (process.env.NODE_ENV === "test" && testEncryptionKey) return Buffer.from(testEncryptionKey);

  const configured = (process.env[KEY_ENV] ?? "").trim();
  if (configured) return parseConfiguredKey(configured);

  throw new SecretCryptoError(
    "FLAVORPRESS_ENCRYPTION_KEY is required before FlavorPress can boot or store secrets. Generate one with npm run gen-encryption-key.",
  );
}

function parseConfiguredKey(value: string): Buffer {
  if (value.startsWith("base64:")) {
    return requireAesKey(parseBase64Key(value.slice("base64:".length)));
  }

  if (value.startsWith("hex:")) {
    return requireAesKey(parseHexKey(value.slice("hex:".length)));
  }

  if (/^[a-f0-9]{64}$/i.test(value)) {
    return requireAesKey(parseHexKey(value));
  }

  if (isBase64Key(value)) {
    return requireAesKey(parseBase64Key(value));
  }

  throw new SecretCryptoError(
    "FLAVORPRESS_ENCRYPTION_KEY must be one of: base64:<32-byte base64>, hex:<64 hex chars>, unprefixed 64-hex, or unprefixed 32-byte base64. Generate one with scripts/gen-encryption-key.ts.",
  );
}

function requireAesKey(value: Buffer): Buffer {
  if (value.length !== 32) {
    throw new SecretCryptoError("FLAVORPRESS_ENCRYPTION_KEY must decode to exactly 32 bytes.");
  }
  return value;
}

function parseHexKey(value: string): Buffer {
  if (!/^[a-f0-9]{64}$/i.test(value)) {
    throw new SecretCryptoError("FLAVORPRESS_ENCRYPTION_KEY hex values must contain 64 hex chars.");
  }
  return Buffer.from(value, "hex");
}

function parseBase64Key(value: string): Buffer {
  if (!isBase64Key(value)) {
    throw new SecretCryptoError(
      "FLAVORPRESS_ENCRYPTION_KEY base64 values must decode to exactly 32 bytes.",
    );
  }
  return Buffer.from(value, "base64");
}

function isBase64Key(value: string): boolean {
  if (!/^[A-Za-z0-9+/]{43}=$/.test(value)) return false;
  return Buffer.from(value, "base64").length === 32;
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
