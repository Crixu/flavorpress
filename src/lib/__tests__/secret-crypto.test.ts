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
});
