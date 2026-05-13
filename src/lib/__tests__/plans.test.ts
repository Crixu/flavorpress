import { beforeEach, describe, expect, it } from "vitest";
import { db, ensureSchema } from "@/lib/db";
import {
  assertCanCreateFolders,
  assertCanCreateOutlets,
  assertCanCreateSources,
  canPollAllSources,
  getUserPlan,
  mapUserPlanRow,
  normalizePlanKey,
  PlanLimitError,
  setUserPlan,
} from "@/lib/plans";

beforeEach(async () => {
  await ensureSchema();
  await db.execute("DELETE FROM user_plans");
  await db.execute("DELETE FROM outlets");
  await db.execute("DELETE FROM sources");
  await db.execute("DELETE FROM source_folders");
  delete process.env.FLAVORPRESS_AUTH;
});

describe("plans", () => {
  it("defaults users to Trial limits", async () => {
    const plan = await getUserPlan("u_test");
    expect(plan.plan).toBe("trial");
    expect(plan.limits).toEqual({ outlets: 1, sources: 10, folders: 1 });
    expect(plan.source).toBe("default");
  });

  it("stores Pro limits", async () => {
    await setUserPlan("u_test", "pro");
    const plan = await getUserPlan("u_test");
    expect(plan.plan).toBe("pro");
    expect(plan.limits).toEqual({ outlets: 5, sources: 100, folders: 5 });
    expect(plan.source).toBe("stored");
  });

  it("stores Custom limits", async () => {
    await setUserPlan("u_test", "custom", {
      outlets: 7,
      sources: 150,
      folders: 12,
      pollAllEnabled: true,
    });
    const plan = await getUserPlan("u_test");
    expect(plan.plan).toBe("custom");
    expect(plan.limits).toEqual({ outlets: 7, sources: 150, folders: 12 });
    expect(plan.pollAllEnabled).toBe(true);
    expect(plan.source).toBe("stored");
  });

  it("normalizes persisted plan keys defensively", async () => {
    expect(normalizePlanKey(" Custom ")).toBe("custom");
    expect(normalizePlanKey("PRO")).toBe("pro");
    expect(normalizePlanKey("unknown")).toBe("trial");

    await db.execute({
      sql: `INSERT INTO user_plans (
              user_id, plan, custom_outlet_limit, custom_source_limit,
              custom_folder_limit, poll_all_enabled, updated_at
            ) VALUES ('u_test', ' Custom ', 5, 25, 3, 1, ?)`,
      args: [Date.now()],
    });
    const plan = await getUserPlan("u_test");
    expect(plan.plan).toBe("custom");
    expect(plan.limits.outlets).toBe(5);
    expect(plan.pollAllEnabled).toBe(true);
  });

  it("reads plan rows with uppercase column names defensively", () => {
    const plan = mapUserPlanRow(
      {
        user_id: "u_test",
        PLAN: "custom",
        custom_outlet_limit: 10,
        custom_source_limit: 200,
        custom_folder_limit: 5,
        poll_all_enabled: 0,
        updated_at: Date.now(),
      },
      "u_test",
    );
    expect(plan.plan).toBe("custom");
    expect(plan.limits).toEqual({ outlets: 10, sources: 200, folders: 5 });
  });

  it("allows Poll all for admins and custom users with the toggle enabled", async () => {
    expect(await canPollAllSources("u_test", false)).toBe(false);
    expect(await canPollAllSources("u_test", true)).toBe(true);

    await setUserPlan("u_test", "pro");
    expect(await canPollAllSources("u_test", false)).toBe(false);

    await setUserPlan("u_test", "custom");
    expect(await canPollAllSources("u_test", false)).toBe(false);

    await setUserPlan("u_test", "custom", { pollAllEnabled: true });
    expect(await canPollAllSources("u_test", false)).toBe(true);
  });

  it("does not apply plan caps in local auth mode", async () => {
    process.env.FLAVORPRESS_AUTH = "local";
    await setUserPlan("u_test", "trial");
    await db.execute({
      sql: `INSERT INTO outlets (id, user_id, base_url, created_at) VALUES ('o1', 'u_test', 'https://example.com', ?)`,
      args: [Date.now()],
    });

    const plan = await getUserPlan("u_test");
    expect(plan.plan).toBe("custom");
    expect(plan.limits.outlets).toBe(Number.MAX_SAFE_INTEGER);
    expect(plan.pollAllEnabled).toBe(true);
    expect(plan.source).toBe("local");
    await expect(assertCanCreateOutlets("u_test")).resolves.toBeUndefined();
    await expect(assertCanCreateSources("u_test", 999)).resolves.toBeUndefined();
    await expect(assertCanCreateFolders("u_test", 999)).resolves.toBeUndefined();
    await expect(canPollAllSources("u_test", false)).resolves.toBe(true);
  });

  it("blocks creates past the assigned caps", async () => {
    await setUserPlan("u_test", "custom", { outlets: 1, sources: 1, folders: 1 });
    await db.execute({
      sql: `INSERT INTO outlets (id, user_id, base_url, created_at) VALUES ('o1', 'u_test', 'https://example.com', ?)`,
      args: [Date.now()],
    });
    await db.execute({
      sql: `INSERT INTO sources (id, user_id, kind, url, created_at) VALUES ('s1', 'u_test', 'rss', 'https://example.com/feed', ?)`,
      args: [Date.now()],
    });
    await db.execute({
      sql: `INSERT INTO source_folders (id, user_id, name, created_at) VALUES ('f1', 'u_test', 'Main', ?)`,
      args: [Date.now()],
    });

    await expect(assertCanCreateOutlets("u_test")).rejects.toBeInstanceOf(PlanLimitError);
    await expect(assertCanCreateSources("u_test")).rejects.toBeInstanceOf(PlanLimitError);
    await expect(assertCanCreateFolders("u_test")).rejects.toBeInstanceOf(PlanLimitError);
  });
});
