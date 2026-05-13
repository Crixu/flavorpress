import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encryptSecret, isEncryptedSecret } from "../../secret-crypto";

const { executeMock, ensureSchemaMock } = vi.hoisted(() => ({
  executeMock: vi.fn(),
  ensureSchemaMock: vi.fn(),
}));

vi.mock("../../db", () => ({
  db: { execute: executeMock },
  ensureSchema: ensureSchemaMock,
}));

import {
  commitOutletCredentials,
  commitOutletWpcomOAuthCredentials,
  getOutletCredentials,
} from "../outlets";

describe("outlet secret storage", () => {
  beforeEach(() => {
    executeMock.mockReset();
    ensureSchemaMock.mockReset();
    vi.stubEnv("FLAVORPRESS_ENCRYPTION_KEY", Buffer.alloc(32, 9).toString("base64"));
    vi.stubEnv("NODE_ENV", "test");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("stores WordPress Application Passwords as encrypted blobs", async () => {
    executeMock.mockResolvedValue({ rows: [] });

    const appPassword = ["wp", "app", "password"].join("-");
    await commitOutletCredentials("outlet-1", "author", appPassword, "wp-org");

    const update = executeMock.mock.calls[0]![0] as { args: unknown[] };
    const stored = Buffer.from(update.args[1] as Uint8Array).toString("utf8");
    expect(isEncryptedSecret(stored)).toBe(true);
    expect(stored).not.toContain("author");
    expect(stored).not.toContain(appPassword);
  });

  it("decrypts encrypted credentials for publish", async () => {
    const appPassword = ["publish", "password"].join("-");
    executeMock.mockResolvedValueOnce({
      rows: [
        {
          base_url: "https://example.com",
          app_password_encrypted: new Uint8Array(
            Buffer.from(encryptSecret(`author:${appPassword}`), "utf8"),
          ),
        },
      ],
    });

    const credentials = await getOutletCredentials("outlet-1");

    expect(credentials).toEqual({
      authType: "application-password",
      baseUrl: "https://example.com",
      username: "author",
      appPassword,
    });
    expect(executeMock).toHaveBeenCalledTimes(1);
  });

  it("migrates legacy plaintext credential blobs on read", async () => {
    const appPassword = ["legacy", "password"].join("-");
    executeMock
      .mockResolvedValueOnce({
        rows: [
          {
            base_url: "https://example.com",
            app_password_encrypted: new Uint8Array(Buffer.from(`author:${appPassword}`, "utf8")),
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] });

    const credentials = await getOutletCredentials("outlet-1");

    expect(credentials?.username).toBe("author");
    expect(credentials?.authType).toBe("application-password");
    if (credentials?.authType !== "wpcom-oauth") {
      expect(credentials?.appPassword).toBe(appPassword);
    }
    const rewrite = executeMock.mock.calls[1]![0] as { args: unknown[] };
    const stored = Buffer.from(rewrite.args[0] as Uint8Array).toString("utf8");
    expect(isEncryptedSecret(stored)).toBe(true);
    expect(stored).not.toContain("author");
    expect(stored).not.toContain(appPassword);
  });

  it("decrypts WordPress.com OAuth credentials for publish", async () => {
    executeMock.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] });

    await commitOutletWpcomOAuthCredentials({
      outletId: "outlet-1",
      accessToken: "tok_123",
      siteId: "123",
      siteUrl: "https://example.wordpress.com",
      siteName: "Example",
      username: "author",
      kind: "wp-com",
    });

    const update = executeMock.mock.calls[0]![0] as { args: unknown[] };
    const stored = Buffer.from(update.args[1] as Uint8Array).toString("utf8");
    expect(isEncryptedSecret(stored)).toBe(true);
    expect(stored).not.toContain("tok_123");

    executeMock.mockReset();
    executeMock.mockResolvedValueOnce({
      rows: [
        {
          base_url: "https://example.wordpress.com",
          app_password_encrypted: update.args[1],
        },
      ],
    });

    await expect(getOutletCredentials("outlet-1")).resolves.toEqual({
      authType: "wpcom-oauth",
      baseUrl: "https://example.wordpress.com",
      accessToken: "tok_123",
      siteId: "123",
      siteUrl: "https://example.wordpress.com",
      username: "author",
    });
  });
});
