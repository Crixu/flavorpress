import { describe, expect, it } from "vitest";
import { RunQueue } from "../run-queue";

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

describe("RunQueue", () => {
  it("respects global concurrency", async () => {
    const q = new RunQueue(2);
    const gates = Array.from({ length: 4 }, () => deferred<void>());
    let active = 0;
    let peak = 0;

    const tasks = gates.map((g, i) =>
      q.add(`k${i}`, async () => {
        active += 1;
        peak = Math.max(peak, active);
        await g.promise;
        active -= 1;
      }),
    );

    await Promise.resolve();
    await Promise.resolve();
    expect(peak).toBe(2);

    gates.forEach((g) => g.resolve());
    await Promise.all(tasks);
    expect(peak).toBe(2);
  });

  it("serializes tasks sharing a key", async () => {
    const q = new RunQueue(8);
    const order: string[] = [];
    const g1 = deferred<void>();
    const g2 = deferred<void>();

    const t1 = q.add("host-a", async () => {
      order.push("a1-start");
      await g1.promise;
      order.push("a1-end");
    });
    const t2 = q.add("host-a", async () => {
      order.push("a2-start");
      await g2.promise;
      order.push("a2-end");
    });

    await Promise.resolve();
    await Promise.resolve();
    expect(order).toEqual(["a1-start"]);

    g1.resolve();
    await t1;
    await new Promise((r) => setTimeout(r, 0));
    expect(order).toEqual(["a1-start", "a1-end", "a2-start"]);

    g2.resolve();
    await t2;
    expect(order).toEqual(["a1-start", "a1-end", "a2-start", "a2-end"]);
  });

  it("releases the slot when a task throws", async () => {
    const q = new RunQueue(1);
    await expect(
      q.add("k", async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    const after = await q.add("k", async () => "ok");
    expect(after).toBe("ok");
  });

  it("lets a blocked key fall to the back while other keys progress", async () => {
    const q = new RunQueue(2);
    const order: string[] = [];
    const aHold = deferred<void>();

    const a1 = q.add("a", async () => {
      order.push("a1");
      await aHold.promise;
    });
    const a2 = q.add("a", async () => {
      order.push("a2");
    });
    const b1 = q.add("b", async () => {
      order.push("b1");
    });

    await Promise.resolve();
    await Promise.resolve();
    await b1;
    expect(order).toEqual(["a1", "b1"]);

    aHold.resolve();
    await Promise.all([a1, a2]);
    expect(order).toEqual(["a1", "b1", "a2"]);
  });

  it("dedupes active tasks by id while preserving host serialization", async () => {
    const q = new RunQueue(1);
    const gate = deferred<void>();
    let runs = 0;

    const first = q.addUnique("source-a", "host-a", async () => {
      runs += 1;
      await gate.promise;
    });
    const duplicate = q.addUnique("source-a", "host-a", async () => {
      runs += 1;
    });

    expect(first).not.toBeNull();
    expect(duplicate).toBeNull();
    if (!first) throw new Error("first task should have been queued");
    await Promise.resolve();
    expect(runs).toBe(1);

    gate.resolve();
    await first;

    const after = q.addUnique("source-a", "host-a", async () => {
      runs += 1;
      return "ok";
    });
    if (!after) throw new Error("task should queue after the first settles");
    await expect(after).resolves.toBe("ok");
    expect(runs).toBe(2);
  });
});
