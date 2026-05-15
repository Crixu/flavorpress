import { describe, expect, it } from "vitest";
import {
  MAX_IMAGE_URL,
  normalizeResearchBoardState,
  parseResearchBoardState,
  renderResearchBoardPrompt,
} from "../research-board";

describe("research board prompt context", () => {
  it("renders cards and labeled connections for draft generation", () => {
    const board = normalizeResearchBoardState({
      cards: [
        {
          id: "source-1",
          kind: "source",
          title: "Original report",
          body: "The primary source.",
          meta: "example.com",
          sourceUrl: "https://example.com/story",
          x: 10,
          y: 20,
        },
        {
          id: "angle-1",
          kind: "angle",
          title: "Accountability angle",
          body: "Frame this around the cost of weak review.",
          meta: "angle",
          x: 220,
          y: 20,
        },
      ],
      connections: [
        {
          id: "connection-1",
          from: "source-1",
          to: "angle-1",
          label: "supports",
        },
      ],
    });

    const prompt = renderResearchBoardPrompt(board);

    expect(prompt).toContain("RESEARCH BOARD");
    expect(prompt).toContain("[source-1] SOURCE: Original report");
    expect(prompt).toContain("Source: https://example.com/story");
    expect(prompt).toContain(
      "supports: [source-1] Original report -> [angle-1] Accountability angle",
    );
  });

  it("keeps pasted image data out of the prompt", () => {
    const board = normalizeResearchBoardState({
      cards: [
        {
          id: "image-1",
          kind: "image",
          title: "Pasted chart",
          body: "Visual note.",
          meta: "visual note",
          imageUrl: "data:image/png;base64,abc123",
          x: 0,
          y: 0,
        },
      ],
      connections: [],
    });

    const prompt = renderResearchBoardPrompt(board);

    expect(prompt).toContain("Treat as visual reference only.");
    expect(prompt).not.toContain("data:image/png");
    expect(prompt).not.toContain("abc123");
  });

  it("preserves long verbatim quote bodies through normalization", () => {
    const longQuote = "x".repeat(4000);
    const board = normalizeResearchBoardState({
      cards: [
        {
          id: "quote-long",
          kind: "quote",
          title: "Quote",
          body: longQuote,
          meta: "speaker",
          x: 0,
          y: 0,
        },
      ],
      connections: [],
    });
    expect(board.cards[0]!.body).toBe(longQuote);
  });

  it("drops oversized image data instead of truncating it", () => {
    const oversized = "data:image/png;base64," + "a".repeat(MAX_IMAGE_URL);
    const board = normalizeResearchBoardState({
      cards: [
        {
          id: "image-big",
          kind: "image",
          title: "Huge",
          body: "",
          meta: "",
          imageUrl: oversized,
          x: 0,
          y: 0,
        },
      ],
      connections: [],
    });
    expect(board.cards[0]!.imageUrl).toBeUndefined();
  });

  it("returns null when the saved payload is not valid JSON", () => {
    expect(parseResearchBoardState("not json {{{")).toBeNull();
  });

  it("round-trips seenIds and deduplicates them", () => {
    const board = normalizeResearchBoardState({
      cards: [
        {
          id: "quote-keep",
          kind: "quote",
          title: "Quote",
          body: "kept",
          meta: "",
          x: 0,
          y: 0,
        },
      ],
      connections: [],
      seenIds: ["quote-keep", "quote-deleted", "quote-deleted", "  "],
    });
    expect(board.seenIds).toEqual(["quote-keep", "quote-deleted"]);
  });

  it("omits seenIds entirely when none are provided", () => {
    const board = normalizeResearchBoardState({ cards: [], connections: [] });
    expect(board.seenIds).toBeUndefined();
  });
});
