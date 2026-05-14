import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decryptSecret, encryptSecret, isEncryptedSecret } from "../../secret-crypto";

const { executeMock, ensureSchemaMock, refreshWpcomAccessTokenMock, revokeWpcomTokenMock } =
  vi.hoisted(() => ({
    executeMock: vi.fn(),
    ensureSchemaMock: vi.fn(),
    refreshWpcomAccessTokenMock: vi.fn(),
    revokeWpcomTokenMock: vi.fn(),
  }));

vi.mock("../../db", () => ({
  db: { execute: executeMock },
  ensureSchema: ensureSchemaMock,
}));

vi.mock("../../wpcom-oauth", () => ({
  refreshWpcomAccessToken: refreshWpcomAccessTokenMock,
  revokeWpcomToken: revokeWpcomTokenMock,
}));

import {
  commitOutletCredentials,
  commitOutletWpcomOAuthCredentials,
  disconnectOutlet,
  getOutletCredentials,
  setOutletWpcomExpectedBlogId,
} from "../outlets";

describe("outlet secret storage", () => {
  beforeEach(() => {
    executeMock.mockReset();
    ensureSchemaMock.mockReset();
    refreshWpcomAccessTokenMock.mockReset();
    revokeWpcomTokenMock.mockReset();
    revokeWpcomTokenMock.mockResolvedValue(undefined);
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

    const update = executeMock.mock.calls[0]![0] as { sql: string; args: unknown[] };
    const stored = Buffer.from(update.args[1] as Uint8Array).toString("utf8");
    expect(isEncryptedSecret(stored)).toBe(true);
    expect(stored).not.toContain("author");
    expect(stored).not.toContain(appPassword);
    expect(update.sql).toContain("wpcom_token_expires_at = NULL");
    expect(update.sql).toContain("wpcom_refresh_token_encrypted = NULL");
    expect(update.sql).toContain("wpcom_token_kid = NULL");
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
      expiresAt: 1_900_000_000_000,
      refreshToken: "refresh_123",
    });

    const update = executeMock.mock.calls[0]![0] as { args: unknown[] };
    const stored = Buffer.from(update.args[1] as Uint8Array).toString("utf8");
    const refreshStored = Buffer.from(update.args[7] as Uint8Array).toString("utf8");
    expect(isEncryptedSecret(stored)).toBe(true);
    expect(isEncryptedSecret(refreshStored)).toBe(true);
    expect(stored).not.toContain("tok_123");
    expect(refreshStored).not.toContain("refresh_123");
    expect(update.args[6]).toBe(1_900_000_000_000);
    expect(update.args[8]).toBe("v1");

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

  it("refreshes expiring WordPress.com OAuth credentials on read", async () => {
    const oldPayload = JSON.stringify({
      type: "wpcom-oauth",
      kid: "v1",
      accessToken: "tok_old",
      siteId: "123",
      siteUrl: "https://example.wordpress.com",
      username: "author",
    });
    refreshWpcomAccessTokenMock.mockResolvedValue({
      accessToken: "tok_new",
      expiresAt: 1_900_000_000_000,
      refreshToken: "refresh_new",
    });
    executeMock
      .mockResolvedValueOnce({
        rows: [
          {
            base_url: "https://example.wordpress.com",
            app_password_encrypted: new Uint8Array(
              Buffer.from(encryptSecret(`wpcom-oauth:${oldPayload}`), "utf8"),
            ),
            wpcom_token_expires_at: Date.now() + 10_000,
            wpcom_refresh_token_encrypted: new Uint8Array(
              Buffer.from(encryptSecret("refresh_old"), "utf8"),
            ),
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] });

    await expect(getOutletCredentials("outlet-1")).resolves.toEqual({
      authType: "wpcom-oauth",
      baseUrl: "https://example.wordpress.com",
      accessToken: "tok_new",
      siteId: "123",
      siteUrl: "https://example.wordpress.com",
      username: "author",
    });

    expect(refreshWpcomAccessTokenMock).toHaveBeenCalledWith("refresh_old");
    const refreshUpdate = executeMock.mock.calls[1]![0] as { args: unknown[] };
    const storedAccess = Buffer.from(refreshUpdate.args[0] as Uint8Array).toString("utf8");
    const storedRefresh = Buffer.from(refreshUpdate.args[2] as Uint8Array).toString("utf8");
    expect(decryptSecret(storedAccess)).toContain("tok_new");
    expect(decryptSecret(storedRefresh)).toBe("refresh_new");
    expect(refreshUpdate.args[1]).toBe(1_900_000_000_000);
    expect(refreshUpdate.args[3]).toBe("v1");
  });

  it("revokes WordPress.com OAuth tokens before disconnecting", async () => {
    const payload = JSON.stringify({
      type: "wpcom-oauth",
      kid: "v1",
      accessToken: "tok_disconnect",
      siteId: "123",
      siteUrl: "https://example.wordpress.com",
      username: "author",
    });
    executeMock
      .mockResolvedValueOnce({
        rows: [
          {
            is_default: 0,
            app_password_encrypted: new Uint8Array(
              Buffer.from(encryptSecret(`wpcom-oauth:${payload}`), "utf8"),
            ),
            wpcom_refresh_token_encrypted: new Uint8Array(
              Buffer.from(encryptSecret("refresh_disconnect"), "utf8"),
            ),
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] });

    await disconnectOutlet("outlet-1", {}, "user-1");

    expect(revokeWpcomTokenMock).toHaveBeenNthCalledWith(1, "tok_disconnect");
    expect(revokeWpcomTokenMock).toHaveBeenNthCalledWith(2, "refresh_disconnect");
    expect(executeMock).toHaveBeenLastCalledWith({
      sql: `UPDATE outlets
          SET app_password_encrypted = NULL,
              wpcom_token_expires_at = NULL,
              wpcom_refresh_token_encrypted = NULL,
              wpcom_token_kid = NULL,
              username = NULL,
              connected_at = NULL,
              last_error = NULL
          WHERE id = ? AND user_id = ?`,
      args: ["outlet-1", "user-1"],
    });
  });

  it("pins the expected WordPress.com blog id on the user's outlet", async () => {
    executeMock.mockResolvedValue({ rows: [] });

    await setOutletWpcomExpectedBlogId("outlet-1", "user-1", "123");

    expect(executeMock).toHaveBeenCalledWith({
      sql: `UPDATE outlets
          SET wpcom_expected_blog_id = ?
          WHERE id = ? AND user_id = ?`,
      args: ["123", "outlet-1", "user-1"],
    });
  });
});
