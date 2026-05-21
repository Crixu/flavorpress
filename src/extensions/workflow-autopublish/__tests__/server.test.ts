import { beforeEach, describe, expect, it, vi } from "vitest";
import { db, ensureSchema } from "@/lib/db";
import {
  createTwoUserFixture,
  seedClusterForUser,
  seedFolderForUser,
  seedOutletForUser,
  seedSourceForUser,
} from "@/lib/__tests__/__helpers__/two-user-fixture";
import { setExtensionEnabled } from "@/lib/v1/settings";
import { WORKFLOW_AUTOPUBLISH_ID, WORKFLOW_FOLDER_ALL } from "../types";

const { generateDraftMock, getOutletCredentialsMock, publishToWordPressMock } = vi.hoisted(() => ({
  generateDraftMock: vi.fn(),
  getOutletCredentialsMock: vi.fn(),
  publishToWordPressMock: vi.fn(),
}));

vi.mock("@/lib/v1/draft-generator", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...(actual as object),
    generateDraft: generateDraftMock,
  };
});

vi.mock("@/lib/v1/outlets", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...(actual as object),
    getOutletCredentials: getOutletCredentialsMock,
  };
});

vi.mock("@/lib/wordpress", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...(actual as object),
    publishToWordPress: publishToWordPressMock,
  };
});

import {
  deleteWorkflowAutopublishConfig,
  loadWorkflowAutopublishState,
  runDueAutopublishWorkflows,
  saveWorkflowAutopublishConfig,
} from "../server";

beforeEach(async () => {
  await ensureSchema();
  await db.execute("DELETE FROM workflow_autopublish_log");
  await db.execute("DELETE FROM workflow_autopublish_configs");
  await db.execute("DELETE FROM user_settings");
  await db.execute("DELETE FROM drafts");
  await db.execute("DELETE FROM items");
  await db.execute("DELETE FROM clusters");
  await db.execute("DELETE FROM source_folders");
  await db.execute("DELETE FROM sources");
  await db.execute("DELETE FROM outlets");
  await db.execute("DELETE FROM users");
  generateDraftMock.mockReset();
  getOutletCredentialsMock.mockReset();
  publishToWordPressMock.mockReset();
  getOutletCredentialsMock.mockResolvedValue(null);
  publishToWordPressMock.mockResolvedValue({
    wpPostId: 123,
    editLink: "https://example.com/wp-admin/post.php?post=123&action=edit",
    modifiedAt: Date.now(),
  });
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

  it("reschedules next_run_at when cadence changes after a prior run", async () => {
    const { userA } = await createTwoUserFixture();
    const outletId = await seedOutletForUser(userA.id);

    await saveWorkflowAutopublishConfig({
      outletId,
      userId: userA.id,
      folderScope: WORKFLOW_FOLDER_ALL,
      enabled: true,
      intervalHours: 24,
      autoUpdate: true,
      freshSourceWindowHours: 24,
    });

    const fakeLastRunAt = Date.now() - 5 * 60 * 1000;
    await db.execute({
      sql: `UPDATE workflow_autopublish_configs SET last_run_at = ?, next_run_at = ?
            WHERE user_id = ? AND outlet_id = ?`,
      args: [fakeLastRunAt, fakeLastRunAt + 24 * 60 * 60 * 1000, userA.id, outletId],
    });

    await saveWorkflowAutopublishConfig({
      outletId,
      userId: userA.id,
      folderScope: WORKFLOW_FOLDER_ALL,
      previousFolderScope: WORKFLOW_FOLDER_ALL,
      enabled: true,
      intervalHours: 1,
      autoUpdate: true,
      freshSourceWindowHours: 24,
    });

    const state = await loadWorkflowAutopublishState(userA.id);
    const workflow = state.workflows[0]!;
    expect(workflow.config.intervalHours).toBe(1);
    expect(workflow.config.nextRunAt).toBe(fakeLastRunAt + 60 * 60 * 1000);
  });

  it("schedules next_run_at to now when re-enabling a workflow with no prior run", async () => {
    const { userA } = await createTwoUserFixture();
    const outletId = await seedOutletForUser(userA.id);

    await saveWorkflowAutopublishConfig({
      outletId,
      userId: userA.id,
      folderScope: WORKFLOW_FOLDER_ALL,
      enabled: false,
      intervalHours: 6,
      autoUpdate: true,
      freshSourceWindowHours: 24,
    });

    const before = Date.now();
    await saveWorkflowAutopublishConfig({
      outletId,
      userId: userA.id,
      folderScope: WORKFLOW_FOLDER_ALL,
      previousFolderScope: WORKFLOW_FOLDER_ALL,
      enabled: true,
      intervalHours: 6,
      autoUpdate: true,
      freshSourceWindowHours: 24,
    });
    const after = Date.now();

    const state = await loadWorkflowAutopublishState(userA.id);
    const nextRunAt = state.workflows[0]!.config.nextRunAt;
    expect(nextRunAt).not.toBeNull();
    expect(nextRunAt!).toBeGreaterThanOrEqual(before);
    expect(nextRunAt!).toBeLessThanOrEqual(after);
  });

  it("deletes a workflow by (user, outlet, folder) and is idempotent on a missing row", async () => {
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

    await deleteWorkflowAutopublishConfig({
      userId: userA.id,
      outletId,
      folderScope: WORKFLOW_FOLDER_ALL,
    });

    let state = await loadWorkflowAutopublishState(userA.id);
    expect(state.workflows).toHaveLength(0);

    await deleteWorkflowAutopublishConfig({
      userId: userA.id,
      outletId,
      folderScope: WORKFLOW_FOLDER_ALL,
    });

    state = await loadWorkflowAutopublishState(userA.id);
    expect(state.workflows).toHaveLength(0);
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

  it("publishes a freshly generated auto-update draft after generation marks the cluster drafted", async () => {
    const { userA } = await createTwoUserFixture();
    const outletId = await seedOutletForUser(userA.id);
    const sourceId = await seedSourceForUser(userA.id);
    const clusterId = await seedClusterForUser(userA.id, { state: "fired" });
    await db.execute({
      sql: `INSERT INTO items
              (id, source_id, user_id, canonical_url, content_hash, title, lede, body,
               published_at, fetched_at, cluster_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        "item-workflow-auto",
        sourceId,
        userA.id,
        "https://source.example.com/story",
        "hash-workflow-auto",
        "Fresh story",
        "A useful lead",
        "A useful body",
        Date.now(),
        Date.now(),
        clusterId,
      ],
    });
    await saveWorkflowAutopublishConfig({
      outletId,
      userId: userA.id,
      folderScope: WORKFLOW_FOLDER_ALL,
      enabled: true,
      intervalHours: 12,
      autoUpdate: true,
      freshSourceWindowHours: 24,
    });
    getOutletCredentialsMock.mockResolvedValue({
      baseUrl: "https://wp.example.com",
      username: "lucas",
      appPassword: "secret",
    });
    generateDraftMock.mockImplementation(async () => {
      const draftId = "draft-workflow-auto";
      const quotes = [{ sourceId, text: "Quote from the source.", citation: "Fresh story" }];
      await db.execute({
        sql: `INSERT INTO drafts (
                id, cluster_id, user_id, outlet_id, capability_version_pin, mode,
                headline, body, quotes, voice_match_score, trace_id, created_at, state
              ) VALUES (?, ?, ?, ?, 'v1', 'drafter', ?, ?, ?, 0.9, ?, ?, 'pre-rendered')`,
        args: [
          draftId,
          clusterId,
          userA.id,
          outletId,
          "Workflow headline",
          "<p>Workflow body with source support.</p>",
          JSON.stringify(quotes),
          "trace-workflow-auto",
          Date.now(),
        ],
      });
      await db.execute({
        sql: `UPDATE clusters SET state = 'drafted' WHERE id = ? AND user_id = ?`,
        args: [clusterId, userA.id],
      });
      return {
        draftId,
        headline: "Workflow headline",
        headlineAlternates: [],
        body: "<p>Workflow body with source support.</p>",
        quotes,
        voiceMatchScore: 90,
        angleArchive: null,
        angleGap: null,
        angleHint: "archive",
        customAngle: null,
        format: "standard",
        traceId: "trace-workflow-auto",
        regenerated: false,
      };
    });

    const result = await runDueAutopublishWorkflows();

    expect(result).toMatchObject({ due: 1, claimed: 1, published: 1, skipped: 0, failed: 0 });
    expect(publishToWordPressMock).toHaveBeenCalledTimes(1);
    const cluster = await db.execute({
      sql: `SELECT state FROM clusters WHERE id = ? AND user_id = ?`,
      args: [clusterId, userA.id],
    });
    expect(String(cluster.rows[0]!.state)).toBe("published");
    const draft = await db.execute({
      sql: `SELECT wp_post_id, state FROM drafts WHERE id = ? AND user_id = ?`,
      args: ["draft-workflow-auto", userA.id],
    });
    expect(Number(draft.rows[0]!.wp_post_id)).toBe(123);
    expect(String(draft.rows[0]!.state)).toBe("published");
  });
});
