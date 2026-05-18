import { beforeEach, describe, expect, it } from "vitest";
import { db, ensureSchema } from "@/lib/db";
import {
  clearAuthFailures,
  consumeRateLimit,
  getClientIp,
  rateLimitKey,
  recordAuthFailure,
} from "@/lib/rate-limit";

const HOUR_MS = 60 * 60 * 1000;

beforeEach(async () => {
  await ensureSchema();
  await db.execute("DELETE FROM rate_buckets");
});

describe("rate limiter", () => {
  it("limits a bucket and refills after the configured window", async () => {
    const key = rateLimitKey("ip", "203.0.113.9");
    expect(
      await consumeRateLimit({ scope: "login", key, limit: 2, windowMs: 1_000, now: 1_000 }),
    ).toMatchObject({ ok: true });
    expect(
      await consumeRateLimit({ scope: "login", key, limit: 2, windowMs: 1_000, now: 1_000 }),
    ).toMatchObject({ ok: true });
    expect(
      await consumeRateLimit({ scope: "login", key, limit: 2, windowMs: 1_000, now: 1_000 }),
    ).toMatchObject({ ok: false, remaining: 0, retryAfterMs: 1_000 });

    expect(
      await consumeRateLimit({ scope: "login", key, limit: 2, windowMs: 1_000, now: 2_000 }),
    ).toMatchObject({ ok: true, remaining: 1, resetAt: 3_000 });
  });

  it("allows only one parallel consume from a capacity-one bucket", async () => {
    const key = rateLimitKey("ip", "203.0.113.10");
    const results = await Promise.all([
      consumeRateLimit({ scope: "login", key, limit: 1, windowMs: 1_000, now: 1_000 }),
      consumeRateLimit({ scope: "login", key, limit: 1, windowMs: 1_000, now: 1_000 }),
    ]);

    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toHaveLength(1);
  });

  it("tracks consecutive auth failures until they are cleared", async () => {
    const key = rateLimitKey("account", "u_123");
    expect(await recordAuthFailure({ scope: "login_failures", key, now: 1_000 })).toBe(1);
    expect(await recordAuthFailure({ scope: "login_failures", key, now: 1_001 })).toBe(2);
    await clearAuthFailures({ scope: "login_failures", key });
    expect(await recordAuthFailure({ scope: "login_failures", key, now: 1_002 })).toBe(1);
  });

  it("prunes stale buckets opportunistically", async () => {
    await db.execute({
      sql: "INSERT INTO rate_buckets (scope, key, tokens, refilled_at) VALUES (?, ?, ?, ?)",
      args: ["old", rateLimitKey("ip", "198.51.100.9"), 0, 0],
    });

    await consumeRateLimit({
      scope: "login",
      key: rateLimitKey("ip", "203.0.113.11"),
      limit: 1,
      windowMs: 1_000,
      now: 25 * HOUR_MS,
    });

    const oldRows = await db.execute("SELECT 1 FROM rate_buckets WHERE scope = 'old'");
    expect(oldRows.rows).toHaveLength(0);
  });

  it("uses the left-most forwarded IP", () => {
    const headers = new Headers({
      "x-forwarded-for": "198.51.100.4, 10.0.0.1",
    });
    expect(getClientIp(headers)).toBe("198.51.100.4");
  });

  it("hashes and normalizes bucket keys", () => {
    const lower = rateLimitKey("account", "writer@example.com");
    const mixed = rateLimitKey("account", " Writer@Example.COM ");

    expect(mixed).toBe(lower);
    expect(lower).toMatch(/^account:[a-f0-9]{64}$/);
    expect(lower).not.toContain("writer@example.com");
  });
});
