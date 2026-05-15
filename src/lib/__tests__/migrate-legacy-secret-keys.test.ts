import { createCipheriv, createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createClient } from "@libsql/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decryptSecret, encryptSecret } from "../secret-crypto";
import { migrateLegacySecretKeys } from "../../../scripts/migrate-legacy-secret-keys";

describe("migrateLegacySecretKeys", () => {
  let tempDir: string;
  const currentKey = Buffer.alloc(32, 22).toString("base64");

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(tmpdir(), "flavorpress-legacy-secrets-"));
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("FLAVORPRESS_ENCRYPTION_KEY", currentKey);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("re-encrypts legacy outlet and settings secrets under the configured key", async () => {
    const dbPath = path.join(tempDir, "flavorpress.db");
    const oldCwd = path.join(tempDir, "old-cwd");
    const legacyKey = legacyLocalDevelopmentKey(oldCwd);
    const client = createClient({ url: `file:${dbPath}` });

    try {
      await client.batch(
        [
          `CREATE TABLE outlets (
            id TEXT PRIMARY KEY,
            app_password_encrypted BLOB,
            wpcom_refresh_token_encrypted BLOB
          )`,
          `CREATE TABLE app_settings (
            key TEXT PRIMARY KEY,
            value TEXT,
            updated_at INTEGER NOT NULL
          )`,
          {
            sql: `INSERT INTO outlets (id, app_password_encrypted)
                  VALUES (?, ?)`,
            args: ["outlet_1", Buffer.from(encryptWithRawKey("author:legacy", legacyKey), "utf8")],
          },
          {
            sql: `INSERT INTO app_settings (key, value, updated_at)
                  VALUES (?, ?, ?)`,
            args: ["anthropic_api_key", encryptWithRawKey("sk-legacy", legacyKey), 1],
          },
          {
            sql: `INSERT INTO app_settings (key, value, updated_at)
                  VALUES (?, ?, ?)`,
            args: ["already_current", encryptSecret("already-current"), 1],
          },
        ],
        "write",
      );

      const firstRun = await migrateLegacySecretKeys({ dbPath, fromCwds: [oldCwd] });
      expect(firstRun).toEqual({ scanned: 4, migrated: 2, skipped: 2 });

      const secondRun = await migrateLegacySecretKeys({ dbPath, fromCwds: [oldCwd] });
      expect(secondRun).toEqual({ scanned: 4, migrated: 0, skipped: 4 });

      const outlet = await client.execute(
        "SELECT app_password_encrypted FROM outlets WHERE id = 'outlet_1'",
      );
      expect(decryptSecret(valueToString(outlet.rows[0]!.app_password_encrypted))).toBe(
        "author:legacy",
      );

      const settings = await client.execute("SELECT key, value FROM app_settings");
      const values = new Map(settings.rows.map((row) => [String(row.key), String(row.value)]));
      expect(decryptSecret(values.get("anthropic_api_key")!)).toBe("sk-legacy");
      expect(decryptSecret(values.get("already_current")!)).toBe("already-current");
    } finally {
      client.close();
    }
  });

  it("refuses to run in production", async () => {
    vi.stubEnv("NODE_ENV", "production");

    await expect(
      migrateLegacySecretKeys({ dbPath: path.join(tempDir, "missing.db"), fromCwds: [tempDir] }),
    ).rejects.toThrow("production");
  });
});

function legacyLocalDevelopmentKey(cwd: string): Buffer {
  return createHash("sha256").update(`FlavorPress local development key:${cwd}`).digest();
}

function encryptWithRawKey(plaintext: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return (
    "fpsec:v1:" +
    toBase64Url(
      Buffer.from(
        JSON.stringify({
          alg: "aes-256-gcm",
          iv: toBase64Url(iv),
          tag: toBase64Url(cipher.getAuthTag()),
          ct: toBase64Url(ciphertext),
        }),
        "utf8",
      ),
    )
  );
}

function toBase64Url(value: Buffer): string {
  return value.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function valueToString(value: unknown): string {
  if (typeof value === "string") return value;
  if (Buffer.isBuffer(value)) return value.toString("utf8");
  if (value instanceof ArrayBuffer) return Buffer.from(value).toString("utf8");
  if (ArrayBuffer.isView(value)) {
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength).toString("utf8");
  }
  if (isArrayBufferLike(value)) return Buffer.from(value).toString("utf8");
  throw new Error("Expected string-like value.");
}

function isArrayBufferLike(value: unknown): value is ArrayBuffer {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { byteLength?: unknown; slice?: unknown };
  return typeof candidate.byteLength === "number" && typeof candidate.slice === "function";
}
