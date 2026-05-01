import type Anthropic from "@anthropic-ai/sdk";

export const MODEL = "claude-sonnet-4-6";

export function extractText(message: Anthropic.Messages.Message): string {
  return message.content
    .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}

export function extractJson<T>(text: string): T {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`Model did not return JSON. Got: ${text.slice(0, 200)}`);
  return JSON.parse(match[0]) as T;
}
