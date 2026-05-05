"use client";

import { useState, useTransition } from "react";
import { regenerateDraftAction } from "@/lib/v1/actions";

interface Props {
  draftId: string;
  /** Current word count of the rendered body, used as the default target. */
  currentWordCount: number;
}

const PRESETS: Array<{ label: string; words: number; hint: string }> = [
  { label: "Short", words: 300, hint: "tight take" },
  { label: "Standard", words: 600, hint: "default" },
  { label: "Long", words: 1000, hint: "deep cut" },
];

/**
 * Length remix. Three preset lengths plus a custom integer field. Submitting
 * regenerates the draft body at the new target. The server preserves the
 * previous angle when this action omits angleHint.
 */
export function LengthPicker({ draftId, currentWordCount }: Props) {
  const [pending, start] = useTransition();
  const [picked, setPicked] = useState<number>(closestPreset(currentWordCount));
  const [customMode, setCustomMode] = useState(false);
  const [customValue, setCustomValue] = useState<string>(String(currentWordCount));

  function submit(words: number) {
    if (!Number.isFinite(words) || words < 100 || words > 1500) return;
    const fd = new FormData();
    fd.set("draftId", draftId);
    fd.set("wordCount", String(Math.round(words)));
    start(async () => {
      await regenerateDraftAction(fd);
    });
  }

  return (
    <div
      className="rounded-2xl p-4"
      style={{ background: "var(--surface)", boxShadow: "var(--shadow-xs)" }}
    >
      <div className="flex items-baseline justify-between">
        <div className="fp-eyebrow">Length</div>
        <span className="font-mono text-[10px] tabular" style={{ color: "var(--fg-subtle)" }}>
          {currentWordCount} words now
        </span>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-1.5">
        {PRESETS.map((p) => {
          const active = !customMode && picked === p.words;
          return (
            <button
              key={p.words}
              type="button"
              onClick={() => {
                setCustomMode(false);
                setPicked(p.words);
              }}
              className="rounded-xl px-2 py-2 text-left transition"
              style={{
                background: active ? "var(--rose-tint)" : "var(--bg-subtle)",
                color: active ? "#9C4A22" : "var(--fg-muted)",
              }}
              aria-pressed={active}
            >
              <div className="text-[12px] font-semibold">{p.label}</div>
              <div className="font-mono text-[10px] tabular opacity-80">
                {p.words}w · {p.hint}
              </div>
            </button>
          );
        })}
      </div>

      <div className="mt-2">
        <button
          type="button"
          onClick={() => setCustomMode((m) => !m)}
          className="text-[11px] underline-offset-2 hover:underline"
          style={{ color: "var(--fg-subtle)" }}
        >
          {customMode ? "Use a preset" : "Custom word count →"}
        </button>
        {customMode ? (
          <div className="mt-2 flex items-center gap-2">
            <input
              type="number"
              min={100}
              max={1500}
              step={50}
              value={customValue}
              onChange={(e) => setCustomValue(e.target.value)}
              className="w-24 rounded-lg px-2 py-1.5 text-[12px]"
              style={{
                background: "var(--bg-subtle)",
                color: "var(--fg)",
                border: "1px solid var(--border)",
              }}
            />
            <span className="text-[11px]" style={{ color: "var(--fg-subtle)" }}>
              words (100–1500)
            </span>
          </div>
        ) : null}
      </div>

      <button
        type="button"
        onClick={() => submit(customMode ? Number(customValue) : picked)}
        disabled={pending}
        className="mt-3 w-full rounded-full px-3 py-2 text-[12px] font-medium transition"
        style={{
          background: pending ? "var(--bg-subtle)" : "var(--fg)",
          color: pending ? "var(--fg-subtle)" : "var(--surface)",
          cursor: pending ? "wait" : "pointer",
        }}
      >
        {pending ? "Regenerating…" : "Remix at this length"}
      </button>
    </div>
  );
}

function closestPreset(current: number): number {
  let best = PRESETS[0]!.words;
  let bestGap = Math.abs(best - current);
  for (const p of PRESETS) {
    const gap = Math.abs(p.words - current);
    if (gap < bestGap) {
      best = p.words;
      bestGap = gap;
    }
  }
  return best;
}
