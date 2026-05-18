import { createClient } from "@libsql/client";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("legacy app_settings migration", () => {
  let tempDir: string;
  let dbUrl: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "flavorpress-settings-migration-"));
    dbUrl = `file:${path.join(tempDir, "flavorpress.db")}`;
    vi.resetModules();
    vi.stubEnv("LIBSQL_URL", dbUrl);
    vi.stubEnv("FLAVORPRESS_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("copies legacy global settings to the first admin user and preserves per-user legacy keys", async () => {
    const client = createClient({ url: dbUrl });
    try {
      await client.batch(
        [
          `CREATE TABLE users (
            id TEXT PRIMARY KEY,
            email TEXT UNIQUE NOT NULL,
            is_admin INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL
          )`,
          `CREATE TABLE app_settings (
            key TEXT PRIMARY KEY,
            value TEXT,
            updated_at INTEGER NOT NULL
          )`,
          {
            sql: `INSERT INTO users (id, email, is_admin, created_at) VALUES (?, ?, ?, ?)`,
            args: ["admin-user", "admin@example.com", 1, 1],
          },
          {
            sql: `INSERT INTO users (id, email, is_admin, created_at) VALUES (?, ?, ?, ?)`,
            args: ["writer-user", "writer@example.com", 0, 2],
          },
          {
            sql: `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)`,
            args: ["anthropic_draft_model", "legacy-model", 10],
          },
          {
            sql: `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)`,
            args: ["related_images_license_filter:writer-user", '["cc0"]', 11],
          },
        ],
        "write",
      );
    } finally {
      client.close();
    }

    const { db, ensureSchema } = await import("../db");
    try {
      await ensureSchema();

      const settings = await db.execute({
        sql: `SELECT user_id, key, value FROM user_settings ORDER BY user_id, key`,
      });
      expect(settings.rows.map((row) => [row.user_id, row.key, row.value])).toEqual([
        ["admin-user", "anthropic_draft_model", "legacy-model"],
        ["writer-user", "related_images_license_filter", '["cc0"]'],
      ]);

      const sentinel = await db.execute({
        sql: `SELECT value FROM deployment_settings WHERE key = 'schema_version'`,
      });
      expect(sentinel.rows.length).toBe(1);
    } finally {
      db.close();
    }
  });

  it("marks orphaned legacy rows handled without making them global fallbacks", async () => {
    const client = createClient({ url: dbUrl });
    try {
      await client.batch(
        [
          `CREATE TABLE app_settings (
            key TEXT PRIMARY KEY,
            value TEXT,
            updated_at INTEGER NOT NULL
          )`,
          {
            sql: `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)`,
            args: ["anthropic_draft_model", "legacy-model", 10],
          },
        ],
        "write",
      );
    } finally {
      client.close();
    }

    const { db, ensureSchema } = await import("../db");
    const { getAnthropicDraftModel } = await import("../v1/settings");
    try {
      await ensureSchema();

      const userSettings = await db.execute("SELECT 1 FROM user_settings");
      expect(userSettings.rows.length).toBe(0);
      await expect(getAnthropicDraftModel("future-user")).resolves.toBe(
        "claude-haiku-4-5-20251001",
      );

      const marker = await db.execute({
        sql: `SELECT value FROM deployment_state WHERE key = 'legacy_app_settings_backfilled_at'`,
      });
      expect(String(marker.rows[0]!.value)).toContain("no-user-owner");
    } finally {
      db.close();
    }
  });
});
