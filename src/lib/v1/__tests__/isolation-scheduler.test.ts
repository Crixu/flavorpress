import { describe, it, expect, beforeEach, vi } from "vitest";
import { db, ensureSchema } from "@/lib/db";
import {
  createTwoUserFixture,
  seedSourceForUser,
} from "@/lib/__tests__/__helpers__/two-user-fixture";
import { _setPollQueueForTests, RunQueue } from "@/lib/v1/run-queue";

const invocations: { sourceId: string; userId: string }[] = [];
vi.mock("@/lib/v1/capability-registry", async () => {
  const actual = await vi.importActual<typeof import("@/lib/v1/capability-registry")>(
    "@/lib/v1/capability-registry",
  );
  return {
    ...actual,
    getRegistry: () => ({
      // Match the production registry's invoke signature loosely; record the
      // ctx.userId paired with the input.sourceId.
      invoke: async (
        _cap: string,
        _ver: string | undefined,
        input: unknown,
        ctx: { userId: string },
      ) => {
        const i = input as { sourceId: string };
        invocations.push({ sourceId: i.sourceId, userId: ctx.userId });
      },
    }),
  };
});

beforeEach(async () => {
  await ensureSchema();
  await db.execute("DELETE FROM sources");
  await db.execute("DELETE FROM users");
  invocations.length = 0;
  // Reset the poll queue so activeIds don't bleed between tests.
  _setPollQueueForTests(new RunQueue(4));
});

describe("runDuePolls", () => {
  it("invokes the capability with each source's owning user_id", async () => {
    const { userA, userB } = await createTwoUserFixture();
    const sourceA = await seedSourceForUser(userA.id);
    const sourceB = await seedSourceForUser(userB.id);
    const { runDuePolls } = await import("@/lib/v1/scheduler");
    await runDuePolls({ wait: true });
    const calls = new Map(invocations.map((i) => [i.sourceId, i.userId]));
    expect(calls.get(sourceA)).toBe(userA.id);
    expect(calls.get(sourceB)).toBe(userB.id);
  });
});
