import { describe, expect, it } from "vitest";
import { buildRerollPrompt } from "../headline-reroll";

describe("buildRerollPrompt", () => {
  it("lists rejected headlines in the user message", () => {
    const { userMessage } = buildRerollPrompt({
      styleSheet: "tone: direct",
      description: null,
      bannedTerms: [],
      signatureTerms: [],
      bodyExcerpt: "Body excerpt.",
      rejected: ["First", "Second", "Third"],
    });
    expect(userMessage).toContain("REJECTED HEADLINES");
    expect(userMessage).toContain("First");
    expect(userMessage).toContain("Second");
    expect(userMessage).toContain("Third");
  });

  it("includes the body excerpt so the headline fits the story", () => {
    const { userMessage } = buildRerollPrompt({
      styleSheet: "tone: direct",
      description: null,
      bannedTerms: [],
      signatureTerms: [],
      bodyExcerpt: "Recipe contest in Austin draws three pitmasters.",
      rejected: ["Old"],
    });
    expect(userMessage).toContain("Recipe contest in Austin draws three pitmasters.");
  });

  it("passes blog identity, banned terms, and signature terms into the system prompt", () => {
    const { systemPrompt } = buildRerollPrompt({
      styleSheet: "tone: direct",
      description: "A blog about regional Texas barbecue.",
      bannedTerms: ["delve", "leverage"],
      signatureTerms: ["pitmaster", "smokehouse"],
      bodyExcerpt: "Body.",
      rejected: ["Old"],
    });
    expect(systemPrompt).toContain("regional Texas barbecue");
    expect(systemPrompt).toContain("delve, leverage");
    expect(systemPrompt).toContain("pitmaster, smokehouse");
  });

  it("uses the default banned-terms set when none are configured", () => {
    const { systemPrompt } = buildRerollPrompt({
      styleSheet: "tone: direct",
      description: null,
      bannedTerms: [],
      signatureTerms: [],
      bodyExcerpt: "Body.",
      rejected: ["Old"],
    });
    expect(systemPrompt).toContain("ostensibly");
  });

  it("forbids em-dashes in headlines via the constraint block", () => {
    const { systemPrompt } = buildRerollPrompt({
      styleSheet: "tone: direct",
      description: null,
      bannedTerms: [],
      signatureTerms: [],
      bodyExcerpt: "Body.",
      rejected: ["Old"],
    });
    expect(systemPrompt).toContain("Em-dashes are forbidden");
  });

  it("requests the JSON envelope and the count of fresh headlines", () => {
    const { userMessage } = buildRerollPrompt({
      styleSheet: "tone: direct",
      description: null,
      bannedTerms: [],
      signatureTerms: [],
      bodyExcerpt: "Body.",
      rejected: ["Old"],
    });
    expect(userMessage).toContain("3 fresh headlines");
    expect(userMessage).toContain('"headlines"');
  });
});
