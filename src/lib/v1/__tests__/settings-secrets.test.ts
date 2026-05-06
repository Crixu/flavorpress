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

import { getSetting, SETTING_KEYS, setSetting } from "../settings";

describe("settings secret storage", () => {
  beforeEach(() => {
    executeMock.mockReset();
    ensureSchemaMock.mockReset();
    vi.stubEnv("FLAVORPRESS_ENCRYPTION_KEY", Buffer.alloc(32, 11).toString("base64"));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("encrypts sensitive app settings on write", async () => {
    executeMock.mockResolvedValue({ rows: [] });
    const apiKey = ["sk", "ant", "testvalue"].join("-");

    await setSetting(SETTING_KEYS.anthropicApiKey, apiKey);

    const insert = executeMock.mock.calls[0]![0] as { args: unknown[] };
    const stored = String(insert.args[1]);
    expect(isEncryptedSecret(stored)).toBe(true);
    expect(stored).not.toContain(apiKey);
  });

  it("decrypts encrypted app settings on read", async () => {
    const apiKey = ["sk", "ant", "stored"].join("-");
    executeMock.mockResolvedValueOnce({
      rows: [{ value: encryptSecret(apiKey) }],
    });

    await expect(getSetting(SETTING_KEYS.anthropicApiKey)).resolves.toBe(apiKey);
    expect(executeMock).toHaveBeenCalledTimes(1);
  });

  it("migrates legacy plaintext app settings on read", async () => {
    const apiKey = ["sk", "ant", "legacy"].join("-");
    executeMock.mockResolvedValueOnce({ rows: [{ value: apiKey }] }).mockResolvedValueOnce({
      rows: [],
    });

    await expect(getSetting(SETTING_KEYS.anthropicApiKey)).resolves.toBe(apiKey);

    const rewrite = executeMock.mock.calls[1]![0] as { args: unknown[] };
    const stored = String(rewrite.args[0]);
    expect(isEncryptedSecret(stored)).toBe(true);
    expect(stored).not.toContain(apiKey);
  });

  it("leaves non-sensitive settings readable without encryption", async () => {
    executeMock.mockResolvedValue({ rows: [] });

    await setSetting(SETTING_KEYS.anthropicDraftModel, "claude-model");

    const insert = executeMock.mock.calls[0]![0] as { args: unknown[] };
    expect(insert.args[1]).toBe("claude-model");
  });
});
