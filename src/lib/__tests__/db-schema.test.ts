import { describe, it, expect } from "vitest";
import { db, ensureSchema } from "@/lib/db";

async function tableInfo(table: string): Promise<Set<string>> {
  const r = await db.execute(`PRAGMA table_info(${table})`);
  return new Set(r.rows.map((row) => String(row.name)));
}

describe("auth-foundation schema", () => {
  it("adds new user columns", async () => {
    await ensureSchema();
    const cols = await tableInfo("users");
    expect(cols.has("password_hash")).toBe(true);
    expect(cols.has("wpcom_id")).toBe(true);
    expect(cols.has("wpcom_username")).toBe(true);
    expect(cols.has("email_verified_at")).toBe(true);
    expect(cols.has("status")).toBe(true);
    expect(cols.has("is_admin")).toBe(true);
    expect(cols.has("session_version")).toBe(true);
  });

  it("creates invites table", async () => {
    await ensureSchema();
    const cols = await tableInfo("invites");
    expect(cols.size).toBeGreaterThan(0);
    expect(cols.has("token")).toBe(true);
    expect(cols.has("expires_at")).toBe(true);
    expect(cols.has("used_at")).toBe(true);
    expect(cols.has("used_by_user_id")).toBe(true);
    expect(cols.has("revoked_at")).toBe(true);
  });

  it("creates email_verification_tokens table", async () => {
    await ensureSchema();
    const cols = await tableInfo("email_verification_tokens");
    expect(cols.has("token")).toBe(true);
    expect(cols.has("user_id")).toBe(true);
  });

  it("creates password_reset_tokens table", async () => {
    await ensureSchema();
    const cols = await tableInfo("password_reset_tokens");
    expect(cols.has("token")).toBe(true);
    expect(cols.has("user_id")).toBe(true);
  });

  it("creates user_plans table", async () => {
    await ensureSchema();
    const cols = await tableInfo("user_plans");
    expect(cols.has("user_id")).toBe(true);
    expect(cols.has("plan")).toBe(true);
    expect(cols.has("custom_outlet_limit")).toBe(true);
    expect(cols.has("custom_source_limit")).toBe(true);
    expect(cols.has("custom_folder_limit")).toBe(true);
  });

  it("creates view_cache table", async () => {
    await ensureSchema();
    const cols = await tableInfo("view_cache");
    expect(cols.has("user_id")).toBe(true);
    expect(cols.has("view_key")).toBe(true);
    expect(cols.has("payload")).toBe(true);
    expect(cols.has("input_hash")).toBe(true);
    expect(cols.has("computed_at")).toBe(true);
    expect(cols.has("refresh_started_at")).toBe(true);
  });

  it("creates user_cache_versions table", async () => {
    await ensureSchema();
    const cols = await tableInfo("user_cache_versions");
    expect(cols.has("user_id")).toBe(true);
    expect(cols.has("today_version")).toBe(true);
    expect(cols.has("updated_at")).toBe(true);
  });

  it("enforces wpcom_id uniqueness via partial index", async () => {
    await ensureSchema();
    const r = await db.execute(
      "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'users_wpcom_id_unique'",
    );
    expect(r.rows.length).toBe(1);
  });
});
