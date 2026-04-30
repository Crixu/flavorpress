"use client";

/**
 * Action row for a cluster card on /. Wraps generateDraftAction in a
 * useTransition so we can replace the row with a synthesized progress
 * indicator while the server is reading sources, loading the voice
 * profile, streaming Sonnet, and scoring Burrows' Delta. Stages and
 * timings are estimates; they're shown so the user knows real work is
 * happening, not because we're polling actual progress.
 */

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { generateDraftAction } from "@/lib/v1/actions";

interface DraftRef {
  id: string;
  voiceMatch: number;
  wpEditLink: string | null;
}

interface Props {
  clusterId: string;
  draft: DraftRef | null;
}

const PRESET_LENGTHS = [200, 400, 600] as const;
type LengthChoice = (typeof PRESET_LENGTHS)[number] | "custom";
const MIN_WORDS = 100;
const MAX_WORDS = 1500;

export function ClusterActions({ clusterId, draft }: Props) {
  const [pending, startTransition] = useTransition();
  const [lengthChoice, setLengthChoice] = useState<LengthChoice>(600);
  const [customWords, setCustomWords] = useState<string>("800");

  function resolveWordCount(): number | null {
    if (lengthChoice !== "custom") return lengthChoice;
    const n = Number(customWords);
    if (!Number.isFinite(n) || n < MIN_WORDS || n > MAX_WORDS) return null;
    return Math.round(n);
  }

  function trigger(force: boolean) {
    const wordCount = resolveWordCount();
    if (wordCount === null) return;
    const fd = new FormData();
    fd.set("clusterId", clusterId);
    fd.set("wordCount", String(wordCount));
    if (force) fd.set("force", "1");
    startTransition(async () => {
      await generateDraftAction(fd);
    });
  }

  if (pending) {
    return <Drafting variant={draft ? "regenerating" : "drafting"} />;
  }

  const customInvalid =
    lengthChoice === "custom" && resolveWordCount() === null;

  const picker = (
    <LengthPicker
      choice={lengthChoice}
      onChoose={setLengthChoice}
      customWords={customWords}
      onCustomWordsChange={setCustomWords}
      invalid={customInvalid}
    />
  );

  if (draft) {
    return (
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <Link
            href={`/editor/${draft.id}`}
            className="fp-btn fp-btn-primary fp-press"
          >
            Open draft →
          </Link>
          <span className="text-xs" style={{ color: "var(--fg-muted)" }}>
            voice-match{" "}
            <span className="font-medium tabular">{draft.voiceMatch}</span>
            {draft.wpEditLink ? (
              <>
                {" · "}
                <a
                  href={draft.wpEditLink}
                  target="_blank"
                  rel="noreferrer"
                  className="hover:underline"
                >
                  in WordPress ↗
                </a>
              </>
            ) : null}
          </span>
          <button
            type="button"
            onClick={() => trigger(true)}
            disabled={customInvalid}
            className="fp-btn fp-btn-ghost"
          >
            Regenerate
          </button>
        </div>
        {picker}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => trigger(false)}
          disabled={customInvalid}
          className="fp-btn fp-btn-primary fp-press"
        >
          Draft this →
        </button>
        <span className="text-xs" style={{ color: "var(--fg-subtle)" }}>
          voice-matched {resolveWordCount() ?? "?"}-word draft
        </span>
      </div>
      {picker}
    </div>
  );
}

interface LengthPickerProps {
  choice: LengthChoice;
  onChoose: (choice: LengthChoice) => void;
  customWords: string;
  onCustomWordsChange: (value: string) => void;
  invalid: boolean;
}

function LengthPicker({
  choice,
  onChoose,
  customWords,
  onCustomWordsChange,
  invalid,
}: LengthPickerProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span
        className="text-[11px] uppercase tracking-wide"
        style={{ color: "var(--fg-subtle)" }}
      >
        Length
      </span>
      <div
        role="radiogroup"
        aria-label="Draft length"
        className="inline-flex overflow-hidden rounded-md"
        style={{ border: "1px solid var(--border)" }}
      >
        {PRESET_LENGTHS.map((n) => {
          const active = choice === n;
          return (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onChoose(n)}
              className="px-2.5 py-1 text-xs tabular"
              style={{
                background: active ? "var(--bg-subtle)" : "transparent",
                color: active ? "var(--fg)" : "var(--fg-muted)",
                fontWeight: active ? 600 : 400,
              }}
            >
              {n}
            </button>
          );
        })}
        <button
          type="button"
          role="radio"
          aria-checked={choice === "custom"}
          onClick={() => onChoose("custom")}
          className="px-2.5 py-1 text-xs"
          style={{
            background: choice === "custom" ? "var(--bg-subtle)" : "transparent",
            color: choice === "custom" ? "var(--fg)" : "var(--fg-muted)",
            fontWeight: choice === "custom" ? 600 : 400,
            borderLeft: "1px solid var(--border)",
          }}
        >
          Custom
        </button>
      </div>
      {choice === "custom" ? (
        <label className="flex items-center gap-1.5 text-xs">
          <input
            type="number"
            min={MIN_WORDS}
            max={MAX_WORDS}
            step={50}
            value={customWords}
            onChange={(e) => onCustomWordsChange(e.target.value)}
            aria-invalid={invalid}
            className="w-20 rounded-md px-2 py-1 text-xs tabular"
            style={{
              border: `1px solid ${invalid ? "var(--rose)" : "var(--border)"}`,
              background: "var(--bg)",
              color: "var(--fg)",
            }}
          />
          <span style={{ color: "var(--fg-subtle)" }}>words</span>
          {invalid ? (
            <span style={{ color: "var(--rose)" }}>
              {MIN_WORDS}–{MAX_WORDS}
            </span>
          ) : null}
        </label>
      ) : null}
    </div>
  );
}

interface Stage {
  label: string;
  detail: string;
  ms: number;
}

const STAGES: Stage[] = [
  {
    label: "Reading sources",
    detail: "Pulling cluster items into a single timeline.",
    ms: 800,
  },
  {
    label: "Loading voice profile",
    detail: "Function-word distribution, sentence rhythm, signature terms.",
    ms: 900,
  },
  {
    label: "Matching archive",
    detail: "Finding posts you've already written on adjacent topics.",
    ms: 1200,
  },
  {
    label: "Drafting in your voice",
    detail: "Streaming from Sonnet; ~600 words, with verbatim quotes.",
    ms: 7000,
  },
  {
    label: "Checking voice match",
    detail: "Burrows' Delta on the first 200 tokens.",
    ms: 1800,
  },
  {
    label: "Polishing",
    detail: "Persisting; opening the editor.",
    ms: 99_999,
  },
];

function Drafting({ variant }: { variant: "drafting" | "regenerating" }) {
  const [stageIdx, setStageIdx] = useState(0);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const start = performance.now();
    const tick = window.setInterval(() => {
      const e = performance.now() - start;
      setElapsed(e);
      let cum = 0;
      for (let i = 0; i < STAGES.length; i++) {
        cum += STAGES[i]!.ms;
        if (e < cum) {
          setStageIdx(i);
          return;
        }
      }
      setStageIdx(STAGES.length - 1);
    }, 150);
    return () => window.clearInterval(tick);
  }, []);

  const headline =
    variant === "regenerating"
      ? "Regenerating draft"
      : "Drafting your story";

  return (
    <div
      className="w-full rounded-xl p-4"
      style={{
        background: "var(--bg-subtle)",
        border: "1px solid var(--border)",
      }}
      role="status"
      aria-live="polite"
    >
      <div className="flex items-center gap-3">
        <PulsingDot />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium leading-tight">{headline}</div>
          <div
            className="mt-0.5 text-xs leading-tight truncate"
            style={{ color: "var(--fg-muted)" }}
          >
            {STAGES[stageIdx]!.label}: {STAGES[stageIdx]!.detail}
          </div>
        </div>
        <div
          className="text-xs tabular shrink-0"
          style={{ color: "var(--fg-subtle)" }}
        >
          {(elapsed / 1000).toFixed(1)}s
        </div>
      </div>

      <div
        className="mt-3 relative h-1 overflow-hidden rounded-full"
        style={{ background: "var(--border)" }}
      >
        <div
          className="absolute inset-y-0 fp-bar-indeterminate rounded-full"
          style={{
            width: "38%",
            background:
              "linear-gradient(90deg, var(--indigo) 0%, var(--rose) 100%)",
          }}
        />
      </div>

      <ol className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-3">
        {STAGES.slice(0, -1).map((s, i) => {
          const isDone = i < stageIdx;
          const isActive = i === stageIdx;
          const color = isDone
            ? "var(--emerald)"
            : isActive
            ? "var(--indigo)"
            : "var(--fg-subtle)";
          return (
            <li
              key={s.label}
              className="flex items-center gap-1.5 text-[11px]"
              style={{ color }}
            >
              <StageGlyph state={isDone ? "done" : isActive ? "active" : "pending"} />
              <span
                className={isActive ? "font-medium" : ""}
                style={{ letterSpacing: "0.01em" }}
              >
                {s.label}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function PulsingDot() {
  return (
    <span className="relative inline-flex h-2.5 w-2.5 shrink-0">
      <span
        className="absolute inline-flex h-full w-full rounded-full fp-pulse-ring"
        style={{ background: "var(--indigo)" }}
        aria-hidden
      />
      <span
        className="relative inline-flex h-2.5 w-2.5 rounded-full"
        style={{ background: "var(--indigo)" }}
      />
    </span>
  );
}

function StageGlyph({ state }: { state: "done" | "active" | "pending" }) {
  if (state === "done") {
    return (
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <polyline points="20 6 9 17 4 12" />
      </svg>
    );
  }
  if (state === "active") {
    return (
      <span
        className="inline-block h-1.5 w-1.5 rounded-full fp-pulse-ring"
        style={{ background: "currentColor" }}
        aria-hidden
      />
    );
  }
  return (
    <span
      className="inline-block h-1.5 w-1.5 rounded-full"
      style={{ border: "1px solid currentColor", opacity: 0.6 }}
      aria-hidden
    />
  );
}
