"use client";

import { useEffect, useMemo, useState } from "react";
import "./AiThinkingLines.css";

export const AI_THINKING_LINES = [
  "Oh, you could write about this from the reader's first question.",
  "Ah, this might be good if the lead starts with the odd detail.",
  "Let me check what the sources agree on first.",
  "I am looking for the angle your archive would recognize.",
  "This cluster has a quieter story underneath it.",
  "Let me see where the useful tension is.",
  "I am separating facts from flavor before drafting.",
  "The strongest opening may be hiding in the second source.",
  "I am checking which claim can carry the post.",
  "This could work as a sharper follow-up to your last piece.",
  "Let me find the sentence that makes the topic feel immediate.",
  "I am keeping the draft close to the sources.",
  "The useful gap is probably what nobody explained plainly.",
  "I am testing this against your voice profile.",
  "This wants a human-sized opening, not a summary.",
  "Let me line up the quotes before the shape hardens.",
  "I am looking for the part your readers would save.",
  "There is a good blog post in the overlooked consequence.",
  "I am checking whether this should be practical or reflective.",
  "Let me keep the premise narrow enough to finish today.",
  "The angle should earn the WordPress draft, not just fill it.",
  "I am trimming anything that sounds like generic AI prose.",
  "This may land better if the first paragraph does less.",
  "Let me follow the most specific source detail.",
  "I am weighing the fresh take against your usual beat.",
  "The draft needs one clean promise and a few grounded turns.",
  "I am checking what should be attributed, quoted, or ignored.",
  "This could start with the thing the coverage assumes readers know.",
  "Let me keep the rhythm closer to your published posts.",
  "I am turning the reading pile into something you can revise.",
];

export function thinkingLineDurationMs(line: string): number {
  return Math.min(4200, Math.max(2200, 1500 + line.length * 32));
}

interface AiThinkingLinesProps {
  context: "angles" | "draft";
}

export function AiThinkingLines({ context }: AiThinkingLinesProps) {
  const offset = context === "draft" ? 11 : 0;
  const lines = useMemo(
    () =>
      AI_THINKING_LINES.map(
        (_, index) => AI_THINKING_LINES[(index + offset) % AI_THINKING_LINES.length]!,
      ),
    [offset],
  );
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const id = window.setTimeout(() => {
      setIndex((current) => (current + 1) % lines.length);
    }, thinkingLineDurationMs(lines[index]!));

    return () => window.clearTimeout(id);
  }, [index, lines]);

  return (
    <div className="fp-ai-thinking" role="status" aria-live="polite">
      <span className="fp-ai-thinking-dots" aria-hidden>
        <span />
        <span />
        <span />
      </span>
      <span key={lines[index]} className="fp-ai-thinking-line">
        {lines[index]}
      </span>
    </div>
  );
}
