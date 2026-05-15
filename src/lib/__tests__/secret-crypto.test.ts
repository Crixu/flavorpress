import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  decryptSecret,
  encryptSecret,
  hasEncryptionKeyConfigured,
  isEncryptedSecret,
  SecretCryptoError,
} from "../secret-crypto";

describe("secret-crypto", () => {
  beforeEach(() => {
    vi.stubEnv("FLAVORPRESS_ENCRYPTION_KEY", Buffer.alloc(32, 7).toString("base64"));
    vi.stubEnv("NODE_ENV", "test");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("encrypts and decrypts AES-GCM envelopes", () => {
    const plaintext = ["wp", "application", "password"].join("-");
    const encrypted = encryptSecret(plaintext);

    expect(isEncryptedSecret(encrypted)).toBe(true);
    expect(encrypted).not.toContain(plaintext);
    expect(decryptSecret(encrypted)).toBe(plaintext);
  });

  it("requires an explicit key in production", () => {
    vi.stubEnv("FLAVORPRESS_ENCRYPTION_KEY", "");
    vi.stubEnv("NODE_ENV", "production");

    expect(hasEncryptionKeyConfigured()).toBe(false);
    expect(() => encryptSecret("value")).toThrow(SecretCryptoError);
  });

  it("keeps the local development fallback stable across copied workspaces", () => {
    vi.stubEnv("FLAVORPRESS_ENCRYPTION_KEY", "");
    vi.stubEnv("NODE_ENV", "development");
    vi.spyOn(process, "cwd").mockReturnValue("/tmp/flavorpress-a");
    const encrypted = encryptSecret("portable-secret");

    vi.spyOn(process, "cwd").mockReturnValue("/tmp/flavorpress-b");
    expect(decryptSecret(encrypted)).toBe("portable-secret");
  });

  it("accepts explicit 32-byte keys in supported formats", () => {
    const key = Buffer.alloc(32, 12);
    const base64Key = key.toString("base64");
    const hexKey = key.toString("hex");

    vi.stubEnv("FLAVORPRESS_ENCRYPTION_KEY", `base64:${base64Key}`);
    const encrypted = encryptSecret("format-secret");

    vi.stubEnv("FLAVORPRESS_ENCRYPTION_KEY", base64Key);
    expect(decryptSecret(encrypted)).toBe("format-secret");

    vi.stubEnv("FLAVORPRESS_ENCRYPTION_KEY", hexKey);
    expect(decryptSecret(encrypted)).toBe("format-secret");

    vi.stubEnv("FLAVORPRESS_ENCRYPTION_KEY", `hex:${hexKey}`);
    expect(decryptSecret(encrypted)).toBe("format-secret");
  });

  it("rejects configured passphrases and wrong-sized keys", () => {
    for (const value of [
      "password",
      "FlavorPress local development key:v2",
      Buffer.alloc(16, 1).toString("base64"),
      Buffer.alloc(24, 1).toString("base64"),
      `base64:${Buffer.alloc(16, 1).toString("base64")}`,
    ]) {
      vi.stubEnv("FLAVORPRESS_ENCRYPTION_KEY", value);
      expect(() => encryptSecret("value"), value).toThrow(SecretCryptoError);
    }

    vi.stubEnv("FLAVORPRESS_ENCRYPTION_KEY", "");
    vi.stubEnv("NODE_ENV", "production");
    expect(() => encryptSecret("value"), "empty production key").toThrow(SecretCryptoError);
  });
});
