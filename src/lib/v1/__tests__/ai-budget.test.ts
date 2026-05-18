import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { db, ensureSchema } from "@/lib/db";
import { wrapAnthropicClient, type AnthropicLike } from "@/lib/anthropic";
import { AiBudgetExceeded, getRemainingTokens, refundTokens, reserveTokens } from "../ai-budget";

const USER_A = "budget-user-a";
const USER_B = "budget-user-b";

describe("per-user Anthropic budget", () => {
  beforeEach(async () => {
    vi.stubEnv("FLAVORPRESS_DAILY_TOKENS_FREE", "100");
    await ensureSchema();
    await db.execute("DELETE FROM user_ai_budget");
    await db.execute("DELETE FROM user_plans");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("isolates each user's daily token allowance", async () => {
    await reserveTokens(USER_A, 100);

    await expect(reserveTokens(USER_A, 1)).rejects.toBeInstanceOf(AiBudgetExceeded);
    await expect(getRemainingTokens(USER_B)).resolves.toMatchObject({
      userId: USER_B,
      tokensRemaining: 100,
      tokensLimit: 100,
    });
  });

  it("keeps parallel reserves for one user within that user's limit", async () => {
    const results = await Promise.allSettled([
      reserveTokens(USER_A, 60),
      reserveTokens(USER_A, 60),
    ]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
    await expect(getRemainingTokens(USER_A)).resolves.toMatchObject({
      tokensRemaining: 40,
      tokensLimit: 100,
    });
  });

  it("refunds unused reservations without raising remaining above the limit", async () => {
    await reserveTokens(USER_A, 80);
    const snapshot = await refundTokens(USER_A, 200);

    expect(snapshot.tokensRemaining).toBe(100);
    expect(snapshot.tokensLimit).toBe(100);
  });

  it("rejects an exhausted user's call before the Anthropic client is called", async () => {
    const create = vi.fn<() => Promise<Anthropic.Messages.Message>>();
    const client: AnthropicLike = {
      messages: {
        create,
        stream: vi.fn() as never,
      },
    };
    const wrapped = wrapAnthropicClient(client, USER_A);

    await expect(
      wrapped.messages.create({
        model: "claude-test",
        max_tokens: 200,
        messages: [{ role: "user", content: "draft this" }],
      } as Anthropic.Messages.MessageCreateParamsNonStreaming),
    ).rejects.toBeInstanceOf(AiBudgetExceeded);
    expect(create).not.toHaveBeenCalled();
  });
});
