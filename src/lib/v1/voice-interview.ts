import { createAnthropicClient, extractText } from "@/lib/anthropic";

import { getAnthropicDraftModel } from "./settings";
import { VOICE_INTERVIEW_QUESTIONS } from "./voice-interview-questions";
export { VOICE_INTERVIEW_QUESTIONS } from "./voice-interview-questions";

const SYNTHESIS_SYSTEM = `You are extracting a writer's voice from a short interview. The user has answered up to seven questions about the blog they write. Produce a 600-800 word essay in the user's voice, drawing only on material in the answers. The essay should read like a representative blog post by this person: opinions, sentence rhythm, vocabulary, tics. Do not invent facts. Do not add meta-commentary, headers, lists, or hedges. No em-dashes; use semicolons or new sentences. Lead with the fact, not setup. If an answer is blank, skip it; do not pad. Output only the essay prose.`;

export interface SynthesisPrompt {
  system: string;
  user: string;
}

export function sanitizeAnswers(input: readonly string[]): string[] {
  const trimmed = input.map((a) => (typeof a === "string" ? a.trim() : ""));
  if (trimmed.length >= 7) return trimmed.slice(0, 7);
  return [...trimmed, ...Array(7 - trimmed.length).fill("")];
}

export function buildSynthesisPrompt(answers: string[]): SynthesisPrompt {
  const lines: string[] = [];
  for (let i = 0; i < VOICE_INTERVIEW_QUESTIONS.length; i++) {
    const a = answers[i] ?? "";
    if (!a) continue;
    lines.push(`Q${i + 1}. ${VOICE_INTERVIEW_QUESTIONS[i]}`);
    lines.push(`A. ${a}`);
    lines.push("");
  }
  lines.push("Write the 600-800 word essay now. Output only the essay.");
  return { system: SYNTHESIS_SYSTEM, user: lines.join("\n") };
}

/**
 * Convert a 7-answer transcript into a 600-800 word essay in the user's
 * voice. The essay is the input to the existing fingerprint extractor;
 * not shown to the user. Returns null if the LLM is unavailable or fails;
 * the caller decides whether to surface the error.
 */
export async function synthesizeVoiceEssay(answers: string[]): Promise<string | null> {
  const sanitized = sanitizeAnswers(answers);
  if (sanitized.every((a) => !a)) return null;

  try {
    const { client } = await createAnthropicClient();
    if (!client) return null;
    const { system, user } = buildSynthesisPrompt(sanitized);
    const model = await getAnthropicDraftModel();
    const message = await client.messages.create({
      model,
      max_tokens: 2000,
      system,
      messages: [{ role: "user", content: user }],
    });
    const text = extractText(message).trim();
    return text || null;
  } catch {
    return null;
  }
}
