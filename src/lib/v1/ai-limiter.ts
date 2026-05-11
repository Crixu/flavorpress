/**
 * Process-wide rate limit for Anthropic API calls.
 *
 * Anthropic enforces a 50 req/min organization cap on
 * claude-sonnet-4-6 by default. A "poll all" can ingest dozens of
 * items in seconds, each firing a per-item entity extraction plus a
 * fire-and-forget tagger call. Without throttling, the burst rolls
 * straight into HTTP 429.
 *
 * The limiter is a token bucket sized to stay comfortably under the
 * org cap (45 req/min steady, burst of 10). It's wrapped around the
 * non-streaming `messages.create` method at the factory level so
 * every call site (entity-extractor, tagger, headline-reroll,
 * researcher, ...) picks it up for free.
 *
 * Streaming is left alone: it's user-initiated drafting and the
 * connection holds for the whole stream; one stream is one request.
 * Limiting streaming would just add latency to the only AI flow the
 * user is actively watching.
 *
 * In-memory, one bucket per process. The bucket survives only as
 * long as the Node process; the limit is per-process by design.
 */

const REQUESTS_PER_MINUTE = 45;
const CAPACITY = 10;
const RATE_PER_SEC = REQUESTS_PER_MINUTE / 60;

interface Bucket {
  tokens: number;
  lastRefillMs: number;
}

const bucket: Bucket = {
  tokens: CAPACITY,
  lastRefillMs: Date.now(),
};

async function takeToken(): Promise<void> {
  while (true) {
    const now = Date.now();
    const elapsedSec = (now - bucket.lastRefillMs) / 1000;
    if (elapsedSec > 0) {
      bucket.tokens = Math.min(CAPACITY, bucket.tokens + elapsedSec * RATE_PER_SEC);
      bucket.lastRefillMs = now;
    }
    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return;
    }
    const waitMs = Math.ceil(((1 - bucket.tokens) / RATE_PER_SEC) * 1000);
    const jittered = waitMs + Math.floor(waitMs * (Math.random() * 0.4 - 0.2));
    await new Promise((r) => setTimeout(r, Math.max(50, jittered)));
  }
}

export async function withAnthropicLimit<T>(fn: () => Promise<T>): Promise<T> {
  await takeToken();
  return fn();
}

/** Tests only: reset the bucket between cases so order doesn't matter. */
export function _resetAnthropicLimiterForTests(): void {
  bucket.tokens = CAPACITY;
  bucket.lastRefillMs = Date.now();
}
