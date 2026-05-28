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
    expect(cols.has("plan")).toBe(true);
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

  it("creates user_mcp_tokens table", async () => {
    await ensureSchema();
    const cols = await tableInfo("user_mcp_tokens");
    expect(cols.has("token_hash")).toBe(true);
    expect(cols.has("user_id")).toBe(true);
    expect(cols.has("label")).toBe(true);
    expect(cols.has("created_at")).toBe(true);
    expect(cols.has("last_used_at")).toBe(true);
    expect(cols.has("revoked_at")).toBe(true);
  });

  it("creates user_plans table", async () => {
    await ensureSchema();
    const cols = await tableInfo("user_plans");
    expect(cols.has("user_id")).toBe(true);
    expect(cols.has("plan")).toBe(true);
    expect(cols.has("custom_outlet_limit")).toBe(true);
    expect(cols.has("custom_source_limit")).toBe(true);
    expect(cols.has("custom_folder_limit")).toBe(true);
    expect(cols.has("poll_all_enabled")).toBe(true);
  });

  it("creates user_ai_budget table", async () => {
    await ensureSchema();
    const cols = await tableInfo("user_ai_budget");
    expect(cols.has("user_id")).toBe(true);
    expect(cols.has("day_utc")).toBe(true);
    expect(cols.has("tokens_remaining")).toBe(true);
    expect(cols.has("tokens_limit")).toBe(true);
    expect(cols.has("updated_at")).toBe(true);
  });

  it("creates rate_buckets table", async () => {
    await ensureSchema();
    const cols = await tableInfo("rate_buckets");
    expect(cols.has("scope")).toBe(true);
    expect(cols.has("key")).toBe(true);
    expect(cols.has("tokens")).toBe(true);
    expect(cols.has("refilled_at")).toBe(true);
  });

  it("creates deployment_state table", async () => {
    await ensureSchema();
    const cols = await tableInfo("deployment_state");
    expect(cols.has("key")).toBe(true);
    expect(cols.has("value")).toBe(true);
  });

  it("creates tenant-scoped settings tables", async () => {
    await ensureSchema();
    const userSettings = await tableInfo("user_settings");
    expect(userSettings.has("user_id")).toBe(true);
    expect(userSettings.has("key")).toBe(true);
    expect(userSettings.has("value")).toBe(true);

    const deploymentSettings = await tableInfo("deployment_settings");
    expect(deploymentSettings.has("key")).toBe(true);
    expect(deploymentSettings.has("value")).toBe(true);
    expect(deploymentSettings.has("updated_at")).toBe(true);
  });

  it("creates user extension access table", async () => {
    await ensureSchema();
    const cols = await tableInfo("user_extension_access");
    expect(cols.has("user_id")).toBe(true);
    expect(cols.has("extension_id")).toBe(true);
    expect(cols.has("enabled")).toBe(true);
    expect(cols.has("updated_at")).toBe(true);
  });

  it("creates notification_webhook_deliveries table", async () => {
    await ensureSchema();
    const cols = await tableInfo("notification_webhook_deliveries");
    expect(cols.has("event_key")).toBe(true);
    expect(cols.has("user_id")).toBe(true);
    expect(cols.has("event_type")).toBe(true);
    expect(cols.has("payload")).toBe(true);
    expect(cols.has("status")).toBe(true);
    expect(cols.has("error")).toBe(true);
    expect(cols.has("delivered_at")).toBe(true);
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

  it("creates source folder assignment table", async () => {
    await ensureSchema();
    const cols = await tableInfo("source_folder_assignments");
    expect(cols.has("source_id")).toBe(true);
    expect(cols.has("user_id")).toBe(true);
    expect(cols.has("folder_id")).toBe(true);
    expect(cols.has("created_at")).toBe(true);
  });

  it("creates outlet_formats table", async () => {
    await ensureSchema();
    const cols = await tableInfo("outlet_formats");
    expect(cols.has("outlet_id")).toBe(true);
    expect(cols.has("user_id")).toBe(true);
    expect(cols.has("format_key")).toBe(true);
    expect(cols.has("name")).toBe(true);
    expect(cols.has("instructions")).toBe(true);
    expect(cols.has("preset_id")).toBe(true);
  });

  it("creates workflow autopublish tables", async () => {
    await ensureSchema();
    const configs = await tableInfo("workflow_autopublish_configs");
    expect(configs.has("user_id")).toBe(true);
    expect(configs.has("outlet_id")).toBe(true);
    expect(configs.has("enabled")).toBe(true);
    expect(configs.has("interval_hours")).toBe(true);
    expect(configs.has("auto_update")).toBe(true);
    expect(configs.has("fresh_source_window_hours")).toBe(true);
    expect(configs.has("next_run_at")).toBe(true);

    const logs = await tableInfo("workflow_autopublish_log");
    expect(logs.has("status")).toBe(true);
    expect(logs.has("message")).toBe(true);
    expect(logs.has("draft_id")).toBe(true);
    expect(logs.has("cluster_id")).toBe(true);
  });

  it("creates WordPress.com outlet token rotation columns", async () => {
    await ensureSchema();
    const cols = await tableInfo("outlets");
    expect(cols.has("wpcom_token_expires_at")).toBe(true);
    expect(cols.has("wpcom_refresh_token_encrypted")).toBe(true);
    expect(cols.has("wpcom_token_kid")).toBe(true);
  });

  it("enforces wpcom_id uniqueness via partial index", async () => {
    await ensureSchema();
    const r = await db.execute(
      "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'users_wpcom_id_unique'",
    );
    expect(r.rows.length).toBe(1);
  });
});
