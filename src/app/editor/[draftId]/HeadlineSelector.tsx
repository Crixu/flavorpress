"use client";

import { rerollDraftHeadlinesAction, selectDraftHeadlineAction } from "@/lib/v1/actions";
import { SubmitButton } from "@/app/_components/SubmitButton";

interface Props {
  draftId: string;
  headline: string;
  alternates: string[];
}

export function HeadlineSelector({ draftId, headline, alternates }: Props) {
  const total = alternates.length + 1;
  const headlineLabel = total > 1 ? `Headline · 1 of ${total}` : "Headline";

  return (
    <div>
      <div className="fp-eyebrow">{headlineLabel}</div>
      <h1
        className="mt-3 fp-h1-serif"
        style={{
          fontSize: "clamp(28px, 3vw, 40px)",
          lineHeight: 1.06,
          letterSpacing: "-0.02em",
        }}
      >
        {headline}
      </h1>
      <div className="mt-4">
        <div className="mb-1.5 flex items-center gap-3">
          <span className="fp-eyebrow">Pick a different headline</span>
          <form action={rerollDraftHeadlinesAction}>
            <input type="hidden" name="draftId" value={draftId} />
            <SubmitButton
              className="rounded-full px-3 py-1 text-[11px]"
              style={{
                background: "var(--bg-subtle)",
                color: "var(--fg-muted)",
              }}
              title="Generate three new headline angles in your voice"
              pendingLabel="Rerolling…"
            >
              Reroll
            </SubmitButton>
          </form>
        </div>
        {alternates.length > 0 ? (
          <div className="flex flex-wrap gap-2 text-[11px]">
            {alternates.map((alt) => (
              <form key={alt} action={selectDraftHeadlineAction}>
                <input type="hidden" name="draftId" value={draftId} />
                <input type="hidden" name="headline" value={alt} />
                <button
                  type="submit"
                  className="rounded-full px-3 py-1 text-left"
                  style={{
                    background: "var(--bg-subtle)",
                    color: "var(--fg-muted)",
                  }}
                  title="Use this headline"
                >
                  {alt}
                </button>
              </form>
            ))}
          </div>
        ) : (
          <p className="text-[11px]" style={{ color: "var(--fg-subtle)" }}>
            No alternates yet. Reroll to generate three angles in your voice.
          </p>
        )}
      </div>
    </div>
  );
}
