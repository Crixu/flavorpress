"use client";
import { useState } from "react";
import { PendingMessage, SubmitButton } from "@/app/_components/SubmitButton";
import { seedVoiceFromInterviewAction } from "@/lib/v1/actions";
import { VOICE_INTERVIEW_QUESTIONS } from "@/lib/v1/voice-interview";

export function InterviewPanel({
  outletId,
  hasProfile,
}: {
  outletId: string;
  hasProfile: boolean;
}) {
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<string[]>(() =>
    Array(VOICE_INTERVIEW_QUESTIONS.length).fill(""),
  );
  const total = VOICE_INTERVIEW_QUESTIONS.length;
  const isLast = index === total - 1;
  const filled = answers.filter((a) => a.trim().length > 0).length;
  const canSubmit = filled >= 3;

  function setAnswer(value: string) {
    setAnswers((prev) => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
  }

  return (
    <form action={seedVoiceFromInterviewAction} className="space-y-4">
      <input type="hidden" name="outletId" value={outletId} />
      {answers.map((a, i) => (
        <input key={i} type="hidden" name={`q${i + 1}`} value={a} />
      ))}
      <div
        className="flex items-center justify-between text-[12px]"
        style={{ color: "var(--fg-muted)" }}
      >
        <span>
          Question {index + 1} of {total}
        </span>
        <span>{filled} answered</span>
      </div>
      <div
        className="rounded-md p-4"
        style={{ background: "var(--bg-subtle)", border: "1px solid var(--border)" }}
      >
        <p className="text-[15px] font-medium leading-relaxed">
          {VOICE_INTERVIEW_QUESTIONS[index]}
        </p>
        <textarea
          rows={6}
          value={answers[index]}
          onChange={(e) => setAnswer(e.target.value)}
          placeholder="Type your answer. Skip if you'd rather not."
          className="fp-input mt-3 w-full"
          style={{ fontSize: "14px", lineHeight: "1.6" }}
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setIndex((i) => Math.max(0, i - 1))}
          disabled={index === 0}
          className="fp-btn fp-btn-ghost"
        >
          ← Back
        </button>
        {!isLast ? (
          <>
            <button
              type="button"
              onClick={() => {
                setAnswer("");
                setIndex((i) => Math.min(total - 1, i + 1));
              }}
              className="fp-btn fp-btn-ghost"
            >
              Skip
            </button>
            <button
              type="button"
              onClick={() => setIndex((i) => Math.min(total - 1, i + 1))}
              className="fp-btn fp-btn-primary"
            >
              Next →
            </button>
          </>
        ) : (
          <SubmitButton
            className="fp-btn fp-btn-primary"
            pendingLabel="Synthesizing voice"
            disabled={!canSubmit}
          >
            {hasProfile ? "Reseed voice from interview" : "Seed voice from interview"}
          </SubmitButton>
        )}
      </div>
      {!canSubmit && isLast ? (
        <p className="text-[12px]" style={{ color: "var(--fg-muted)" }}>
          Answer at least three questions to continue.
        </p>
      ) : null}
      <PendingMessage>
        Synthesizing a representative essay from your answers and fingerprinting it.
      </PendingMessage>
    </form>
  );
}
