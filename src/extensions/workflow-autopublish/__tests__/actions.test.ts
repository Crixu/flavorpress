import { beforeEach, describe, expect, it, vi } from "vitest";
import { SESSION_COOKIE_NAME, createSessionCookie } from "@/lib/auth";
import { db, ensureSchema } from "@/lib/db";
import {
  createTwoUserFixture,
  seedFolderForUser,
  seedOutletForUser,
} from "@/lib/__tests__/__helpers__/two-user-fixture";
import { loadWorkflowAutopublishState, saveWorkflowAutopublishConfig } from "../server";

let cookieJar: Map<string, string>;

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (n: string) => {
      const v = cookieJar.get(n);
      return v ? { value: v } : undefined;
    },
    set: (n: string, v: string) => {
      cookieJar.set(n, v);
    },
  }),
}));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`__REDIRECT__:${url}`);
  },
}));

vi.mock("next/cache", () => ({
  revalidatePath: () => {},
}));

const SECRET = "test-secret-that-is-at-least-32-bytes-long!!";

async function loginAs(userId: string): Promise<void> {
  const cookie = await createSessionCookie({ userId, sessionVersion: 0, secret: SECRET });
  cookieJar.set(SESSION_COOKIE_NAME, cookie.value);
}

async function expectRedirect(promise: Promise<void>): Promise<string> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("__REDIRECT__:")) {
      return err.message.slice("__REDIRECT__:".length);
    }
    throw err;
  }
  return "";
}

beforeEach(async () => {
  await ensureSchema();
  await db.execute("DELETE FROM workflow_autopublish_log");
  await db.execute("DELETE FROM workflow_autopublish_configs");
  await db.execute("DELETE FROM user_settings");
  await db.execute("DELETE FROM source_folders");
  await db.execute("DELETE FROM outlets");
  await db.execute("DELETE FROM users");
  cookieJar = new Map();
  process.env.FLAVORPRESS_SESSION_SECRET = SECRET;
});

describe("workflow autopublish actions", () => {
  it("deletes the original workflow when the editable folder field is omitted", async () => {
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
    await loginAs(userA.id);

    const formData = new FormData();
    formData.set("outletId", outletId);
    formData.set("previousFolderScope", folderId);

    const { deleteWorkflowAutopublishAction } = await import("../actions");
    const redirectTo = await expectRedirect(deleteWorkflowAutopublishAction(formData));

    expect(redirectTo).toBe("/workflows?saved=workflow_deleted");
    const state = await loadWorkflowAutopublishState(userA.id);
    expect(state.workflows).toHaveLength(0);
  });
});
