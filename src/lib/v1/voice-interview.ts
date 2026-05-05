import { MODEL, createAnthropicClient, extractText } from "@/lib/anthropic";

export const VOICE_INTERVIEW_QUESTIONS: readonly string[] = [
  "What's the blog about, in one sentence you'd actually say out loud?",
  "Who reads it; describe one specific person you picture.",
  "What's the boring truth in your space that you wish more people said?",
  "A recent post you were proud of, in three sentences.",
  "A post that flopped or felt wrong, in three sentences.",
  "Three words you reach for; three words you'd never use.",
  'If a stranger asked "why should I read you instead of $bigger_blogger," what\'s the honest answer?',
];

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
    const message = await client.messages.create({
      model: MODEL,
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
