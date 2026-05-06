import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/anthropic", () => ({
  createAnthropicClient: vi.fn(),
  extractText: (m: { content: { type: string; text?: string }[] }) =>
    m.content
      .filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join(""),
  extractJson: (text: string) => {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("no json");
    return JSON.parse(match[0]);
  },
  MODEL: "claude-sonnet-4-6",
}));

import { createAnthropicClient } from "@/lib/anthropic";
import { extractItemTags, normalizeTag } from "@/lib/v1/tagger";

describe("normalizeTag", () => {
  it("lowercases and trims", () => {
    expect(normalizeTag("  Espresso  ")).toBe("espresso");
  });

  it("strips trailing punctuation", () => {
    expect(normalizeTag("ai!")).toBe("ai");
  });

  it("collapses whitespace to single hyphen", () => {
    expect(normalizeTag("Slow Espresso")).toBe("slow-espresso");
  });

  it("returns null for empty after normalization", () => {
    expect(normalizeTag("   !!  ")).toBeNull();
  });

  it("returns null for tags longer than 32 chars", () => {
    expect(normalizeTag("a".repeat(40))).toBeNull();
  });
});

describe("extractItemTags", () => {
  it("returns tags from a successful LLM response", async () => {
    const fakeClient = {
      messages: {
        create: vi.fn().mockResolvedValue({
          content: [
            {
              type: "text",
              text: JSON.stringify({ tags: ["espresso", "roasting", "lisbon", "extraction"] }),
            },
          ],
        }),
      },
    };
    vi.mocked(createAnthropicClient).mockResolvedValue({
      client: fakeClient as never,
      mode: "api" as const,
    });

    const tags = await extractItemTags({ title: "Slow espresso", body: "..." });
    expect(tags).toEqual(["espresso", "roasting", "lisbon", "extraction"]);
  });

  it("returns empty array when client is null", async () => {
    vi.mocked(createAnthropicClient).mockResolvedValue({
      client: null,
      mode: "none" as const,
    });
    const tags = await extractItemTags({ title: "x", body: "y" });
    expect(tags).toEqual([]);
  });

  it("returns empty array on parse failure", async () => {
    const fakeClient = {
      messages: {
        create: vi.fn().mockResolvedValue({
          content: [{ type: "text", text: "not json" }],
        }),
      },
    };
    vi.mocked(createAnthropicClient).mockResolvedValue({
      client: fakeClient as never,
      mode: "api" as const,
    });
    const tags = await extractItemTags({ title: "x", body: "y" });
    expect(tags).toEqual([]);
  });

  it("normalizes and deduplicates tags", async () => {
    const fakeClient = {
      messages: {
        create: vi.fn().mockResolvedValue({
          content: [
            {
              type: "text",
              text: JSON.stringify({ tags: ["Espresso", "espresso", "Slow Espresso"] }),
            },
          ],
        }),
      },
    };
    vi.mocked(createAnthropicClient).mockResolvedValue({
      client: fakeClient as never,
      mode: "api" as const,
    });
    const tags = await extractItemTags({ title: "x", body: "y" });
    expect(tags).toEqual(["espresso", "slow-espresso"]);
  });

  it("caps at 8 tags", async () => {
    const tooMany = Array.from({ length: 12 }, (_, i) => `tag${i}`);
    const fakeClient = {
      messages: {
        create: vi.fn().mockResolvedValue({
          content: [{ type: "text", text: JSON.stringify({ tags: tooMany }) }],
        }),
      },
    };
    vi.mocked(createAnthropicClient).mockResolvedValue({
      client: fakeClient as never,
      mode: "api" as const,
    });
    const tags = await extractItemTags({ title: "x", body: "y" });
    expect(tags).toHaveLength(8);
  });
});
