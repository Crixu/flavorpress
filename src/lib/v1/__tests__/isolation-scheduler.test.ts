import { describe, it, expect, beforeEach, vi } from "vitest";
import { db, ensureSchema } from "@/lib/db";
import {
  createTwoUserFixture,
  seedSourceForUser,
} from "@/lib/__tests__/__helpers__/two-user-fixture";
import { _setPollQueueForTests, RunQueue } from "@/lib/v1/run-queue";

const invocations: { sourceId: string; userId: string }[] = [];
let invocationGate: Promise<void> | null = null;
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
        if (invocationGate) await invocationGate;
      },
    }),
  };
});

beforeEach(async () => {
  await ensureSchema();
  await db.execute("DELETE FROM sources");
  await db.execute("DELETE FROM users");
  invocations.length = 0;
  invocationGate = null;
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

  it("claims a due source before queueing so overlapping cron passes cannot poll it twice", async () => {
    const { userA } = await createTwoUserFixture();
    const sourceId = await seedSourceForUser(userA.id);
    const gate = deferred();
    invocationGate = gate.promise;

    const { runDuePolls } = await import("@/lib/v1/scheduler");
    const first = runDuePolls({ wait: true });
    await waitFor(() => invocations.length === 1);

    const second = await runDuePolls({ wait: true });
    gate.resolve();
    await first;

    expect(invocations).toEqual([{ sourceId, userId: userA.id }]);
    expect(second).toMatchObject({ queued: 0 });
  });

  it("stops claiming sources when the cron time budget is exhausted", async () => {
    const { userA } = await createTwoUserFixture();
    await seedSourceForUser(userA.id);
    const unclaimedSourceId = await seedSourceForUser(userA.id);
    await db.execute({
      sql: "UPDATE sources SET last_polled_at = 1 WHERE id = ?",
      args: [unclaimedSourceId],
    });
    const gate = deferred();
    invocationGate = gate.promise;
    const deferredTasks: Promise<void>[] = [];

    const { runDuePolls } = await import("@/lib/v1/scheduler");
    const result = await runDuePolls({
      wait: true,
      maxBatch: 2,
      timeBudgetMs: 30,
      returnBufferMs: 1,
      deferTimedOutTask: (task) => deferredTasks.push(task),
    });

    const unclaimed = await db.execute({
      sql: "SELECT last_polled_at FROM sources WHERE id = ?",
      args: [unclaimedSourceId],
    });
    expect(deferredTasks).toHaveLength(1);
    gate.resolve();
    await deferredTasks[0];
    await waitFor(() => invocationGate !== null && invocations.length === 1);

    expect(result).toMatchObject({
      queued: 1,
      timedOut: 1,
      budgetExhausted: true,
      pending: 1,
    });
    expect(Number(unclaimed.rows[0]?.last_polled_at)).toBe(1);
  });
});

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 1000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for predicate");
    await new Promise((r) => setTimeout(r, 5));
  }
}
