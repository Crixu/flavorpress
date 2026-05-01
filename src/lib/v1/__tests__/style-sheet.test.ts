import { describe, expect, it } from "vitest";
import {
  burrowsDelta,
  extractStyleSheet,
  fingerprintText,
  voiceMatchScore,
  type PostInput,
} from "../style-sheet";

const day = 86_400_000;

function post(overrides: Partial<PostInput> = {}): PostInput {
  return {
    title: "Sample post",
    body: "The quick brown fox jumps over the lazy dog. The fox is quick. The dog is lazy.",
    publishedAt: Date.now() - 5 * day,
    ...overrides,
  };
}

describe("extractStyleSheet", () => {
  it("returns an empty fingerprint when no posts are supplied", () => {
    const sheet = extractStyleSheet([]);
    expect(sheet.archiveSize).toBe(0);
    expect(sheet.sentenceLengthMean).toBe(0);
    expect(sheet.sentenceLengthVariance).toBe(0);
    expect(sheet.functionWordDistribution.length).toBeGreaterThan(0);
    for (const v of sheet.functionWordDistribution) expect(v).toBe(0);
  });

  it("normalizes the function-word distribution to a fraction <= 1 of total tokens", () => {
    const sheet = extractStyleSheet([post(), post(), post()]);
    const sum = Array.from(sheet.functionWordDistribution).reduce((a, b) => a + b, 0);
    expect(sum).toBeGreaterThan(0);
    expect(sum).toBeLessThanOrEqual(1.000001);
  });

  it("produces signature terms drawn from non-function-word vocabulary", () => {
    const sheet = extractStyleSheet([
      post({
        title: "Espresso roasters guide",
        body: "Espresso roasters favor lighter roasts; specialty roasters publish weekly. Espresso espresso espresso.",
      }),
    ]);
    expect(sheet.signatureTerms.length).toBeGreaterThan(0);
    expect(sheet.signatureTerms).toContain("espresso");
    for (const term of sheet.signatureTerms) {
      expect(term.length).toBeGreaterThanOrEqual(4);
    }
  });

  it("counts em-dashes and reports a non-zero density when present", () => {
    const sheet = extractStyleSheet([
      post({
        body: "Roasters — the small ones — carry the beat. The trade — chaotic — keeps moving.",
      }),
    ]);
    expect(sheet.emDashDensity).toBeGreaterThan(0);
  });

  it("ignores zero-weight (very old) posts when newer posts dominate", () => {
    const olderPosts: PostInput[] = [
      post({
        body: "Quantum entanglement particles particles particles.",
        publishedAt: Date.now() - 3000 * day,
      }),
    ];
    const recentPosts: PostInput[] = [
      post({
        body: "Coffee coffee coffee espresso espresso espresso.",
        publishedAt: Date.now() - 1 * day,
      }),
    ];
    const mixed = extractStyleSheet([...olderPosts, ...recentPosts]);
    expect(mixed.signatureTerms[0]).toMatch(/coffee|espresso/);
  });
});

describe("burrowsDelta", () => {
  it("is 0 for identical distributions", () => {
    const a = new Float32Array([0.1, 0.2, 0.3, 0.4]);
    const b = new Float32Array([0.1, 0.2, 0.3, 0.4]);
    expect(burrowsDelta(a, b)).toBe(0);
  });

  it("is symmetric in its arguments", () => {
    const a = new Float32Array([0.1, 0.4, 0.2, 0.3]);
    const b = new Float32Array([0.4, 0.1, 0.3, 0.2]);
    expect(burrowsDelta(a, b)).toBeCloseTo(burrowsDelta(b, a), 6);
  });

  it("returns 1 when both vectors are empty", () => {
    expect(burrowsDelta(new Float32Array(0), new Float32Array(0))).toBe(1);
  });

  it("is bounded between 0 and 1", () => {
    const a = new Float32Array([0.9, 0.1, 0, 0]);
    const b = new Float32Array([0, 0, 0.5, 0.5]);
    const d = burrowsDelta(a, b);
    expect(d).toBeGreaterThanOrEqual(0);
    expect(d).toBeLessThanOrEqual(1);
  });
});

describe("voiceMatchScore", () => {
  it("returns 100 for identical fingerprints", () => {
    const a = new Float32Array([0.1, 0.2, 0.3]);
    const b = new Float32Array([0.1, 0.2, 0.3]);
    expect(voiceMatchScore(a, b)).toBe(100);
  });

  it("returns a value between 0 and 100 for divergent fingerprints", () => {
    const a = new Float32Array([0.9, 0.05, 0.05]);
    const b = new Float32Array([0.05, 0.05, 0.9]);
    const score = voiceMatchScore(a, b);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThan(100);
  });
});

describe("fingerprintText", () => {
  it("returns a zero distribution for empty text", () => {
    const dist = fingerprintText("");
    expect(dist.length).toBeGreaterThan(0);
    for (const v of dist) expect(v).toBe(0);
  });

  it("normalizes counts so the distribution sums to ~1 on common-word text", () => {
    const dist = fingerprintText(
      "the quick brown fox and the lazy dog are in the yard with the cat",
    );
    const sum = Array.from(dist).reduce((a, b) => a + b, 0);
    expect(sum).toBeGreaterThan(0);
    expect(sum).toBeLessThanOrEqual(1.000001);
  });
});
