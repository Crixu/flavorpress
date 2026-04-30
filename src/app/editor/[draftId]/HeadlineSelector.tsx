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
      <div className="mb-2 text-xs text-stone-500">
        Headline · 1 of {total}
      </div>
      <h1 className="mb-2 text-2xl font-semibold leading-tight">{headline}</h1>
      {canPickAlternate ? (
        <div className="mb-6">
          <div className="mb-1.5 text-[10px] uppercase tracking-wider text-stone-400">
            Pick a different headline
          </div>
          <div className="flex flex-wrap gap-2 text-[11px]">
            {alternates.map((alt) => (
              <form key={alt} action={selectDraftHeadlineAction}>
                <input type="hidden" name="draftId" value={draftId} />
                <input type="hidden" name="headline" value={alt} />
                <button
                  type="submit"
                  className="rounded border border-stone-200 px-2 py-0.5 text-left text-stone-600 hover:bg-stone-50 hover:border-stone-300"
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
