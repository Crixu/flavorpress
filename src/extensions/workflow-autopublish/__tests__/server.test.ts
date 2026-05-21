import { beforeEach, describe, expect, it } from "vitest";
import { db, ensureSchema } from "@/lib/db";
import {
  createTwoUserFixture,
  seedOutletForUser,
} from "@/lib/__tests__/__helpers__/two-user-fixture";
import { setExtensionEnabled } from "@/lib/v1/settings";
import { WORKFLOW_AUTOPUBLISH_ID } from "../types";
import {
  loadWorkflowAutopublishState,
  runDueAutopublishWorkflows,
  saveWorkflowAutopublishConfig,
} from "../server";

beforeEach(async () => {
  await ensureSchema();
  await db.execute("DELETE FROM workflow_autopublish_log");
  await db.execute("DELETE FROM workflow_autopublish_configs");
  await db.execute("DELETE FROM user_settings");
  await db.execute("DELETE FROM outlets");
  await db.execute("DELETE FROM users");
});

describe("workflow autopublish config", () => {
  it("is off by default for an outlet", async () => {
    const { userA } = await createTwoUserFixture();
    await seedOutletForUser(userA.id, { displayName: "Main blog" });

    const state = await loadWorkflowAutopublishState(userA.id);

    expect(state.outlets).toHaveLength(1);
    expect(state.outlets[0]!.label).toBe("Main blog");
    expect(state.outlets[0]!.config.enabled).toBe(false);
    expect(state.outlets[0]!.config.intervalHours).toBe(12);
  });

  it("normalizes saved options and schedules the first run", async () => {
    const { userA } = await createTwoUserFixture();
    const outletId = await seedOutletForUser(userA.id);

    await saveWorkflowAutopublishConfig({
      outletId,
      userId: userA.id,
      enabled: true,
      intervalHours: 999,
      autoUpdate: false,
      freshSourceWindowHours: 999,
    });

    const state = await loadWorkflowAutopublishState(userA.id);
    expect(state.outlets[0]!.config.enabled).toBe(true);
    expect(state.outlets[0]!.config.intervalHours).toBe(12);
    expect(state.outlets[0]!.config.autoUpdate).toBe(false);
    expect(state.outlets[0]!.config.freshSourceWindowHours).toBe(24);
    expect(state.outlets[0]!.config.nextRunAt).toBeTypeOf("number");
  });

  it("skips due runs when the extension toggle is disabled", async () => {
    const { userA } = await createTwoUserFixture();
    const outletId = await seedOutletForUser(userA.id);
    await saveWorkflowAutopublishConfig({
      outletId,
      userId: userA.id,
      enabled: true,
      intervalHours: 12,
      autoUpdate: true,
      freshSourceWindowHours: 24,
    });
    await setExtensionEnabled(WORKFLOW_AUTOPUBLISH_ID, false, userA.id);

    const result = await runDueAutopublishWorkflows();

    expect(result).toMatchObject({ due: 1, claimed: 1, skipped: 1 });
    const logs = await db.execute({
      sql: `SELECT status, message FROM workflow_autopublish_log WHERE user_id = ?`,
      args: [userA.id],
    });
    expect(logs.rows).toHaveLength(1);
    expect(String(logs.rows[0]!.status)).toBe("skipped");
    expect(String(logs.rows[0]!.message)).toMatch(/disabled/i);
  });
});
