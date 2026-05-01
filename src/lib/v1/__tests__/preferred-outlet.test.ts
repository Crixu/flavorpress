import { describe, expect, it } from "vitest";
import { pickPreferredOutletForCluster } from "../ranker";

const tech = new Set(["llm", "anthropic", "react", "typescript"]);
const food = new Set(["sourdough", "fermentation", "miso", "kimchi"]);

describe("pickPreferredOutletForCluster", () => {
  it("returns null with fewer than two outlets", () => {
    const sig = new Map([["tech", tech]]);
    const r = pickPreferredOutletForCluster(["llm", "anthropic"], ["tech"], sig);
    expect(r).toBeNull();
  });

  it("returns null when the cluster has no entities", () => {
    const sig = new Map([
      ["tech", tech],
      ["food", food],
    ]);
    const r = pickPreferredOutletForCluster([], ["tech", "food"], sig);
    expect(r).toBeNull();
  });

  it("picks the outlet whose signature terms overlap the cluster", () => {
    const sig = new Map([
      ["tech", tech],
      ["food", food],
    ]);
    const r = pickPreferredOutletForCluster(["LLM", "Anthropic", "Claude"], ["tech", "food"], sig);
    expect(r).toBe("tech");
  });

  it("returns null when neither outlet matches anything", () => {
    const sig = new Map([
      ["tech", tech],
      ["food", food],
    ]);
    const r = pickPreferredOutletForCluster(["volleyball", "tournament"], ["tech", "food"], sig);
    expect(r).toBeNull();
  });

  it("returns null when the lead is within the tie epsilon", () => {
    const sig = new Map([
      ["a", new Set(["alpha"])],
      ["b", new Set(["beta"])],
    ]);
    // Both outlets get 1/2 hits; tie exactly.
    const r = pickPreferredOutletForCluster(["alpha", "beta"], ["a", "b"], sig);
    expect(r).toBeNull();
  });

  it("does substring matching on entities", () => {
    const sig = new Map([
      ["tech", new Set(["anthropic"])],
      ["food", food],
    ]);
    const r = pickPreferredOutletForCluster(
      ["anthropic claude announcement"],
      ["tech", "food"],
      sig,
    );
    expect(r).toBe("tech");
  });
});
