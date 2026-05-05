import { describe, expect, it } from "vitest";
import {
  VOICE_INTERVIEW_QUESTIONS,
  buildSynthesisPrompt,
  sanitizeAnswers,
} from "../voice-interview";

describe("voice-interview", () => {
  it("exports exactly seven Kemp-style questions", () => {
    expect(VOICE_INTERVIEW_QUESTIONS).toHaveLength(7);
    for (const q of VOICE_INTERVIEW_QUESTIONS) {
      expect(typeof q).toBe("string");
      expect(q.length).toBeGreaterThan(20);
    }
  });

  it("sanitizeAnswers pads or truncates to seven and trims each entry", () => {
    expect(sanitizeAnswers(["  one  ", "two"])).toEqual([
      "one",
      "two",
      "",
      "",
      "",
      "",
      "",
    ]);
    const ten = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"];
    expect(sanitizeAnswers(ten)).toHaveLength(7);
    expect(sanitizeAnswers(ten)).toEqual(["a", "b", "c", "d", "e", "f", "g"]);
  });

  it("buildSynthesisPrompt formats question/answer pairs and skips blanks", () => {
    const answers = sanitizeAnswers(["A blog about distributed systems.", "", "Yes."]);
    const { system, user } = buildSynthesisPrompt(answers);
    expect(system).toMatch(/600-800 word/);
    expect(system).toMatch(/no em.?dashes/i);
    expect(user).toMatch(/Q1\./);
    expect(user).toMatch(/A blog about distributed systems\./);
    expect(user).not.toMatch(/Q2\./); // blank answers omitted
    expect(user).toMatch(/Q3\./);
  });
});
