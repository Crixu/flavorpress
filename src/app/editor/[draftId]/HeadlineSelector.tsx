"use client";

import { selectDraftHeadlineAction } from "@/lib/v1/actions";

interface Props {
  draftId: string;
  headline: string;
  alternates: string[];
  locked?: boolean;
}

export function HeadlineSelector({
  draftId,
  headline,
  alternates,
  locked = false,
}: Props) {
  const total = alternates.length + 1;
  const canPickAlternate = alternates.length > 0 && !locked;

  return (
    <div>
      <div className="fp-eyebrow">
        Draft · 1 of {total}
      </div>
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
      {canPickAlternate ? (
        <div className="mt-4">
          <div className="fp-eyebrow mb-1.5">
            Pick a different headline
          </div>
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
        </div>
      ) : null}
    </div>
  );
}
