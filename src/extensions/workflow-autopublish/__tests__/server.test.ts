import { beforeEach, describe, expect, it } from "vitest";
import { db, ensureSchema } from "@/lib/db";
import {
  createTwoUserFixture,
  seedFolderForUser,
  seedOutletForUser,
} from "@/lib/__tests__/__helpers__/two-user-fixture";
import { setExtensionEnabled } from "@/lib/v1/settings";
import { WORKFLOW_AUTOPUBLISH_ID, WORKFLOW_FOLDER_ALL } from "../types";
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
    expect(state.workflows).toHaveLength(0);
    expect(state.folderOptions[0]).toEqual({ scope: WORKFLOW_FOLDER_ALL, label: "All folders" });
  });

  it("normalizes saved options and schedules the first folder-scoped run", async () => {
    const { userA } = await createTwoUserFixture();
    const outletId = await seedOutletForUser(userA.id);
    const folderId = await seedFolderForUser(userA.id, { name: "Coffee" });

    await saveWorkflowAutopublishConfig({
      outletId,
      userId: userA.id,
      folderScope: folderId,
      enabled: true,
      intervalHours: 999,
      autoUpdate: false,
      freshSourceWindowHours: 999,
    });

    const state = await loadWorkflowAutopublishState(userA.id);
    expect(state.workflows).toHaveLength(1);
    expect(state.workflows[0]!.folderScope).toBe(folderId);
    expect(state.workflows[0]!.folderLabel).toBe("Coffee");
    expect(state.workflows[0]!.config.enabled).toBe(true);
    expect(state.workflows[0]!.config.intervalHours).toBe(48);
    expect(state.workflows[0]!.config.autoUpdate).toBe(false);
    expect(state.workflows[0]!.config.freshSourceWindowHours).toBe(24);
    expect(state.workflows[0]!.config.nextRunAt).toBeTypeOf("number");
  });

  it("clamps the cadence between one and forty-eight hours", async () => {
    const { userA } = await createTwoUserFixture();
    const outletId = await seedOutletForUser(userA.id);

    await saveWorkflowAutopublishConfig({
      outletId,
      userId: userA.id,
      folderScope: WORKFLOW_FOLDER_ALL,
      enabled: true,
      intervalHours: 0,
      autoUpdate: true,
      freshSourceWindowHours: 24,
    });

    let state = await loadWorkflowAutopublishState(userA.id);
    expect(state.workflows[0]!.config.intervalHours).toBe(1);

    await saveWorkflowAutopublishConfig({
      outletId,
      userId: userA.id,
      folderScope: WORKFLOW_FOLDER_ALL,
      enabled: true,
      intervalHours: 99,
      autoUpdate: true,
      freshSourceWindowHours: 24,
    });

    state = await loadWorkflowAutopublishState(userA.id);
    expect(state.workflows[0]!.config.intervalHours).toBe(48);
  });

  it("preserves an existing deleted folder scope when saving unchanged settings", async () => {
    const { userA } = await createTwoUserFixture();
    const outletId = await seedOutletForUser(userA.id);
    const folderId = await seedFolderForUser(userA.id, { name: "Coffee" });

    await saveWorkflowAutopublishConfig({
      outletId,
      userId: userA.id,
      folderScope: folderId,
      enabled: true,
      intervalHours: 12,
      autoUpdate: true,
      freshSourceWindowHours: 24,
    });
    await db.execute({
      sql: `DELETE FROM source_folders WHERE id = ? AND user_id = ?`,
      args: [folderId, userA.id],
    });

    await saveWorkflowAutopublishConfig({
      outletId,
      userId: userA.id,
      folderScope: folderId,
      previousFolderScope: folderId,
      enabled: true,
      intervalHours: 24,
      autoUpdate: false,
      freshSourceWindowHours: 48,
    });

    const state = await loadWorkflowAutopublishState(userA.id);
    expect(state.workflows).toHaveLength(1);
    expect(state.workflows[0]!.folderScope).toBe(folderId);
    expect(state.workflows[0]!.folderLabel).toBe("Deleted folder");
    expect(state.workflows[0]!.config.intervalHours).toBe(24);
  });

  it("skips due runs when the extension toggle is disabled", async () => {
    const { userA } = await createTwoUserFixture();
    const outletId = await seedOutletForUser(userA.id);
    await saveWorkflowAutopublishConfig({
      outletId,
      userId: userA.id,
      folderScope: WORKFLOW_FOLDER_ALL,
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
