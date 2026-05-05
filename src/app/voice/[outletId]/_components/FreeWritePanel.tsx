"use client";
import { useState } from "react";
import { PendingMessage, SubmitButton } from "@/app/_components/SubmitButton";
import { seedVoiceFromSamplesAction } from "@/lib/v1/actions";

const PROMPTS = [
  "Describe what you'd put on the homepage.",
  "Write the post you wish someone else had written.",
  "Pitch the blog to a stranger in three sentences, then keep going.",
  "Tell me about something you read this week and what you thought of it.",
];

export function FreeWritePanel({
  outletId,
  hasProfile,
}: {
  outletId: string;
  hasProfile: boolean;
}) {
  const [text, setText] = useState("");
  const [showPrompts, setShowPrompts] = useState(false);
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  const target = 500;
  const meetsMin = wordCount >= 200;

  return (
    <form action={seedVoiceFromSamplesAction} className="space-y-3">
      <input type="hidden" name="outletId" value={outletId} />
      <input type="hidden" name="method" value="freewrite" />
      <p className="text-[13px] leading-relaxed" style={{ color: "var(--fg-muted)" }}>
        Write for ~10 minutes about anything. Aim for {target}+ words. We extract the same
        fingerprint we would build from your archive.
      </p>
      <textarea
        name="samples"
        required
        rows={14}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Start typing. The more you write, the better the fingerprint."
        className="fp-input w-full"
        style={{ fontSize: "14px", lineHeight: "1.6" }}
      />
      <div
        className="flex items-center justify-between text-[12px]"
        style={{ color: "var(--fg-muted)" }}
      >
        <span>
          {wordCount} {wordCount === 1 ? "word" : "words"}
          {meetsMin ? " ✓" : ` (need 200, target ${target})`}
        </span>
        <button
          type="button"
          onClick={() => setShowPrompts((v) => !v)}
          className="underline"
          style={{ color: "var(--fg-muted)" }}
        >
          {showPrompts ? "Hide prompts" : "Stuck? Show prompts"}
        </button>
      </div>
      {showPrompts ? (
        <ul
          className="rounded-md border p-3 text-[13px] leading-relaxed"
          style={{ borderColor: "var(--border)", color: "var(--fg-muted)" }}
        >
          {PROMPTS.map((p) => (
            <li key={p} className="list-disc list-inside">
              {p}
            </li>
          ))}
        </ul>
      ) : null}
      <SubmitButton
        className="fp-btn fp-btn-primary"
        pendingLabel={hasProfile ? "Reseeding voice" : "Seeding voice"}
      >
        {hasProfile ? "Reseed voice from this writing" : "Seed voice from this writing"}
      </SubmitButton>
      <PendingMessage>Extracting a voice fingerprint from what you wrote.</PendingMessage>
    </form>
  );
}
