/**
 * Bounded concurrency queue with per-key serialization.
 *
 * Used to spread source polls across time instead of fanning out with
 * Promise.all. Two limits stack: a global cap on in-flight tasks and a
 * per-key cap (always 1) so two polls against the same host never run
 * simultaneously. Hosts get queued behind their busy peer rather than
 * piling up inside polite-fetch's token bucket.
 *
 * In-memory. One bucket per process. Survives only as long as the
 * Node process; the scheduler refills it on the next tick.
 */

interface PendingTask {
  id: string | null;
  key: string;
  fn: () => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
}

export class RunQueue {
  private readonly pending: PendingTask[] = [];
  private readonly inflightKeys = new Set<string>();
  private readonly activeIds = new Set<string>();
  private inflight = 0;

  constructor(private readonly concurrency: number) {
    if (concurrency < 1) throw new Error("concurrency must be >= 1");
  }

  add<T>(key: string, fn: () => Promise<T>): Promise<T> {
    return this.enqueue(null, key, fn);
  }

  addUnique<T>(id: string, key: string, fn: () => Promise<T>): Promise<T> | null {
    if (this.activeIds.has(id)) return null;
    this.activeIds.add(id);
    return this.enqueue(id, key, fn);
  }

  private enqueue<T>(id: string | null, key: string, fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.pending.push({
        id,
        key,
        fn: fn as () => Promise<unknown>,
        resolve: resolve as (value: unknown) => void,
        reject,
      });
      this.tick();
    });
  }

  /**
   * Wait for every currently-queued task to settle. Tasks added after
   * the call won't be awaited; this is intended for tests.
   */
  async drain(): Promise<void> {
    while (this.inflight > 0 || this.pending.length > 0) {
      await new Promise((r) => setTimeout(r, 5));
    }
  }

  get depth(): number {
    return this.pending.length + this.inflight;
  }

  private tick(): void {
    while (this.inflight < this.concurrency) {
      const idx = this.pending.findIndex((t) => !this.inflightKeys.has(t.key));
      if (idx === -1) return;
      const task = this.pending.splice(idx, 1)[0]!;
      this.inflight += 1;
      this.inflightKeys.add(task.key);
      void Promise.resolve()
        .then(() => task.fn())
        .then(
          (value) => {
            this.finish(task);
            task.resolve(value);
          },
          (error) => {
            this.finish(task);
            task.reject(error);
          },
        );
    }
  }

  private finish(task: PendingTask): void {
    this.inflight -= 1;
    this.inflightKeys.delete(task.key);
    if (task.id) this.activeIds.delete(task.id);
    this.tick();
  }
}

/**
 * Process-wide queue for source polls. Global cap of 4 so a "poll all"
 * across 50 feeds doesn't stampede outbound bandwidth or the AI rate
 * cap; per-host cap of 1 so two reddit subs never poll in parallel.
 */
let pollQueueSingleton: RunQueue | null = null;

export function getPollQueue(): RunQueue {
  if (!pollQueueSingleton) pollQueueSingleton = new RunQueue(4);
  return pollQueueSingleton;
}

/** Tests only: replace the global queue for isolation. */
export function _setPollQueueForTests(queue: RunQueue | null): void {
  pollQueueSingleton = queue;
}
