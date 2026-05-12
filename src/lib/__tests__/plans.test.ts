import { beforeEach, describe, expect, it } from "vitest";
import { db, ensureSchema } from "@/lib/db";
import {
  assertCanCreateFolders,
  assertCanCreateOutlets,
  assertCanCreateSources,
  getUserPlan,
  PlanLimitError,
  setUserPlan,
} from "@/lib/plans";

beforeEach(async () => {
  await ensureSchema();
  await db.execute("DELETE FROM user_plans");
  await db.execute("DELETE FROM outlets");
  await db.execute("DELETE FROM sources");
  await db.execute("DELETE FROM source_folders");
});

describe("plans", () => {
  it("defaults users to Trial limits", async () => {
    const plan = await getUserPlan("u_test");
    expect(plan.plan).toBe("trial");
    expect(plan.limits).toEqual({ outlets: 1, sources: 10, folders: 1 });
  });

  it("stores Pro limits", async () => {
    await setUserPlan("u_test", "pro");
    const plan = await getUserPlan("u_test");
    expect(plan.plan).toBe("pro");
    expect(plan.limits).toEqual({ outlets: 5, sources: 100, folders: 5 });
  });

  it("stores Custom limits", async () => {
    await setUserPlan("u_test", "custom", { outlets: 7, sources: 150, folders: 12 });
    const plan = await getUserPlan("u_test");
    expect(plan.plan).toBe("custom");
    expect(plan.limits).toEqual({ outlets: 7, sources: 150, folders: 12 });
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
