"use client";

/**
 * Reader onboarding: a three-card practice run that teaches the swipe
 * gestures before the real triage queue loads. Cards 1 and 2 enforce
 * the prompted direction so the user actually performs the gesture;
 * card 3 accepts either direction so they can finish on their own
 * terms. No server actions fire; nothing here touches real items.
 *
 * Visual tone matches FlavorPress's editorial-paper system: practice
 * cards read as a printed onboarding insert with a chapter numeral
 * watermark, a dotted hint rule, and a pulsing edge chevron toward
 * the required swipe direction. Wrong-direction attempts shake the
 * card.
 */

import { useEffect, useRef, useState } from "react";

type Direction = "left" | "right";

interface Prompt {
  numeral: string;
  step: string;
  title: string;
  body: string;
  hint: string;
  required: Direction | null;
}

const PROMPTS: Prompt[] = [
  {
    numeral: "01",
    step: "Step 1 of 3",
    title: "Swipe right to mark a story.",
    body: "Marked stories pile up until five are ready, then group into clusters you can draft from. Try it: drag this card to the right, or press the right arrow.",
    hint: "Swipe right to continue",
    required: "right",
  },
  {
    numeral: "02",
    step: "Step 2 of 3",
    title: "Swipe left to skip.",
    body: "Skipped stories are dismissed and won't return to the deck. Try it: drag this card to the left, or press the left arrow.",
    hint: "Swipe left to continue",
    required: "left",
  },
  {
    numeral: "03",
    step: "Step 3 of 3",
    title: "Press ⌘Z to undo a swipe.",
    body: "Undo brings the last card back so you can re-swipe. You're ready: send this card either way to start triaging real stories.",
    hint: "Swipe either way to finish",
    required: null,
  },
];

const SWIPE_COMMIT_PX = 110;
const FLY_DURATION_MS = 260;
const SHAKE_DURATION_MS = 360;

interface LeavingCard {
  promptIdx: number;
  direction: Direction;
  startX: number;
  startY: number;
  startAngle: number;
  fly: boolean;
}

export function PracticeDeck({
  onComplete,
  onSkip,
}: {
  onComplete: () => void;
  onSkip: () => void;
}) {
  const [index, setIndex] = useState(0);
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);
  const [leaving, setLeaving] = useState<LeavingCard | null>(null);
  const [shaking, setShaking] = useState(false);
  const [wrongHint, setWrongHint] = useState<string | null>(null);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);

  const prompt = PROMPTS[index];
  const finished = !prompt;

  useEffect(() => {
    if (finished) {
      const t = window.setTimeout(onComplete, FLY_DURATION_MS + 80);
      return () => window.clearTimeout(t);
    }
  }, [finished, onComplete]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!prompt || leaving) return;
      if (e.key === "ArrowRight") {
        e.preventDefault();
        attempt("right");
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        attempt("left");
      } else if (e.key === "Escape") {
        e.preventDefault();
        onSkip();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prompt, leaving, drag?.x]);

  function attempt(direction: Direction) {
    if (!prompt || leaving) return;
    if (prompt.required && prompt.required !== direction) {
      setShaking(true);
      setDrag(null);
      setWrongHint(
        direction === "right"
          ? "Other way; swipe left to skip."
          : "Other way; swipe right to mark.",
      );
      window.setTimeout(() => setShaking(false), SHAKE_DURATION_MS);
      window.setTimeout(() => setWrongHint(null), 1600);
      return;
    }
    const startX = drag?.x ?? 0;
    const startY = drag?.y ?? 0;
    const startAngle = drag ? drag.x / 14 : 0;
    const promptIdx = index;
    setLeaving({ promptIdx, direction, startX, startY, startAngle, fly: false });
    setDrag(null);
    setWrongHint(null);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setLeaving((l) => (l && l.promptIdx === promptIdx ? { ...l, fly: true } : l));
      });
    });
    window.setTimeout(() => {
      setLeaving((l) => (l && l.promptIdx === promptIdx ? null : l));
      setIndex((i) => i + 1);
    }, FLY_DURATION_MS + 40);
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (!prompt || leaving || shaking) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragStartRef.current = { x: e.clientX, y: e.clientY };
    setDrag({ x: 0, y: 0 });
  }
  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragStartRef.current) return;
    setDrag({
      x: e.clientX - dragStartRef.current.x,
      y: e.clientY - dragStartRef.current.y,
    });
  }
  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragStartRef.current) return;
    const dx = e.clientX - dragStartRef.current.x;
    dragStartRef.current = null;
    if (Math.abs(dx) >= SWIPE_COMMIT_PX) {
      attempt(dx > 0 ? "right" : "left");
    } else {
      setDrag(null);
    }
  }

  const angle = drag ? drag.x / 14 : 0;
  const dragOpacity = drag ? Math.max(0.6, 1 - Math.abs(drag.x) / 600) : 1;
  const overlayDirection: Direction | null = drag
    ? drag.x > 40
      ? "right"
      : drag.x < -40
        ? "left"
        : null
    : null;

  const topTransform = drag
    ? `translate(${drag.x}px, ${drag.y}px) rotate(${angle}deg)`
    : "translate(0, 0) rotate(0deg)";

  const leavingStyle = (() => {
    if (!leaving) return null;
    if (!leaving.fly) {
      return {
        transform: `translate(${leaving.startX}px, ${leaving.startY}px) rotate(${leaving.startAngle}deg)`,
        opacity: 1,
      };
    }
    const offset = leaving.direction === "right" ? 640 : -640;
    const rot = leaving.direction === "right" ? 24 : -24;
    return {
      transform: `translate(${offset}px, 60px) rotate(${rot}deg)`,
      opacity: 0,
    };
  })();

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="fp-eyebrow" style={{ color: "var(--rose)" }}>
            Quick tutorial
          </span>
          <StepDots total={PROMPTS.length} index={Math.min(index, PROMPTS.length - 1)} />
        </div>
        <button
          type="button"
          onClick={onSkip}
          className="text-xs underline-offset-4 hover:underline"
          style={{ color: "var(--fg-subtle)" }}
        >
          Skip tutorial
        </button>
      </div>

      <div
        aria-live="polite"
        className="flex items-center gap-3 text-[11px] uppercase tracking-[0.16em]"
        style={{
          minHeight: 18,
          color: wrongHint ? "var(--amber)" : "var(--fg-subtle)",
        }}
      >
        <span aria-hidden="true" className="fp-divider flex-1" />
        <span style={{ fontWeight: wrongHint ? 600 : 500 }}>
          {wrongHint ?? prompt?.hint ?? "Tutorial complete"}
        </span>
        <span aria-hidden="true" className="fp-divider flex-1" />
      </div>

      <div className="relative mx-auto" style={{ height: 460, maxWidth: 540, touchAction: "none" }}>
        {prompt ? (
          <div
            className={`absolute inset-0 cursor-grab active:cursor-grabbing ${
              shaking ? "fp-card-shake" : ""
            }`}
            style={{
              transform: shaking ? undefined : topTransform,
              opacity: dragOpacity,
              transition:
                drag || shaking ? "none" : `transform 220ms var(--ease), opacity 220ms var(--ease)`,
              zIndex: 3,
            }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          >
            <PracticeCard prompt={prompt} overlay={overlayDirection} />
          </div>
        ) : null}
        {leaving && leavingStyle ? (
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              transform: leavingStyle.transform,
              opacity: leavingStyle.opacity,
              transition: `transform ${FLY_DURATION_MS}ms ease-in, opacity ${FLY_DURATION_MS}ms ease-in`,
              zIndex: 4,
            }}
          >
            <PracticeCard prompt={PROMPTS[leaving.promptIdx]} overlay={leaving.direction} />
          </div>
        ) : null}
      </div>

      <ActionBar
        canSwipe={Boolean(prompt) && !leaving}
        onLeft={() => attempt("left")}
        onRight={() => attempt("right")}
      />
    </div>
  );
}

function StepDots({ total, index }: { total: number; index: number }) {
  return (
    <div className="flex items-center gap-1.5" aria-label={`Step ${index + 1} of ${total}`}>
      {Array.from({ length: total }).map((_, i) => {
        const done = i < index;
        const current = i === index;
        return (
          <span
            key={i}
            aria-hidden="true"
            style={{
              display: "inline-block",
              height: 6,
              width: current ? 22 : 6,
              borderRadius: 999,
              background: done ? "var(--fg-subtle)" : current ? "var(--rose)" : "var(--border)",
              transition: "all 240ms var(--ease)",
            }}
          />
        );
      })}
    </div>
  );
}

function PracticeCard({ prompt, overlay }: { prompt: Prompt; overlay?: Direction | null }) {
  return (
    <article
      className="relative flex h-full flex-col overflow-hidden p-8"
      style={{
        background:
          "radial-gradient(120% 80% at 0% 0%, rgba(255, 227, 201, 0.55), transparent 55%), var(--surface)",
        border: "1.5px dashed var(--border-strong)",
        borderRadius: "var(--radius-xl)",
        boxShadow: "var(--shadow-sm)",
        userSelect: "none",
      }}
    >
      <div
        aria-hidden="true"
        className="fp-h1-serif pointer-events-none absolute select-none"
        style={{
          right: 24,
          top: 8,
          fontSize: 168,
          lineHeight: 1,
          color: "var(--rose)",
          opacity: 0.16,
          letterSpacing: "-0.04em",
          fontWeight: 500,
        }}
      >
        {prompt.numeral}
      </div>

      <div className="flex items-center gap-2" style={{ color: "var(--fg-subtle)" }}>
        <span className="fp-eyebrow" style={{ color: "var(--rose)" }}>
          Practice
        </span>
        <span aria-hidden="true">·</span>
        <span className="text-xs">{prompt.step}</span>
      </div>

      <h2
        className="fp-h1-serif relative mt-5"
        style={{ fontSize: 30, lineHeight: 1.15, letterSpacing: "-0.01em" }}
      >
        {prompt.title}
      </h2>

      <p
        className="relative mt-4 max-w-[34ch] text-sm leading-relaxed"
        style={{ color: "var(--fg-muted)" }}
      >
        {prompt.body}
      </p>

      <div className="flex-1" />

      {prompt.required ? <EdgeChevron direction={prompt.required} /> : <BothEdgesChevron />}

      <div
        className="relative mt-4 flex items-center justify-between text-[11px] uppercase tracking-[0.16em]"
        style={{ color: "var(--fg-subtle)" }}
      >
        <DirectionTag direction="left" highlight={prompt.required === "left"} />
        <span>Drag · click · arrow keys</span>
        <DirectionTag direction="right" highlight={prompt.required === "right"} />
      </div>

      {overlay ? <SwipeOverlay direction={overlay} /> : null}
    </article>
  );
}

function EdgeChevron({ direction }: { direction: Direction }) {
  const isRight = direction === "right";
  const tone = isRight ? "var(--emerald)" : "var(--rose)";
  return (
    <div
      aria-hidden="true"
      className={isRight ? "fp-edge-pulse-right" : "fp-edge-pulse-left"}
      style={{
        position: "absolute",
        top: "50%",
        [isRight ? "right" : "left"]: 14,
        color: tone,
      }}
    >
      <svg
        width="36"
        height="36"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {isRight ? (
          <>
            <polyline points="9 6 15 12 9 18" />
            <polyline points="4 6 10 12 4 18" opacity="0.45" />
          </>
        ) : (
          <>
            <polyline points="15 6 9 12 15 18" />
            <polyline points="20 6 14 12 20 18" opacity="0.45" />
          </>
        )}
      </svg>
    </div>
  );
}

function BothEdgesChevron() {
  return (
    <>
      <EdgeChevron direction="left" />
      <EdgeChevron direction="right" />
    </>
  );
}

function DirectionTag({ direction, highlight }: { direction: Direction; highlight: boolean }) {
  const arrow = direction === "left" ? "←" : "→";
  const label = direction === "left" ? "Skip" : "Mark";
  const tone = direction === "left" ? "var(--rose)" : "var(--emerald)";
  return (
    <span
      className="inline-flex items-center gap-1.5"
      style={{
        color: highlight ? tone : "var(--fg-subtle)",
        fontWeight: highlight ? 600 : 500,
      }}
    >
      <kbd
        className="tabular"
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          minWidth: 18,
          height: 18,
          padding: "0 5px",
          border: `1px solid ${highlight ? tone : "var(--border)"}`,
          borderRadius: 6,
          fontSize: 11,
          background: highlight
            ? direction === "left"
              ? "var(--rose-tint)"
              : "var(--emerald-tint)"
            : "var(--surface)",
        }}
      >
        {arrow}
      </kbd>
      <span>{label}</span>
    </span>
  );
}

function SwipeOverlay({ direction }: { direction: Direction }) {
  const isRight = direction === "right";
  return (
    <div
      className="pointer-events-none absolute inset-0 flex items-start justify-end p-5"
      style={{
        background: isRight
          ? "linear-gradient(135deg, transparent 60%, color-mix(in srgb, var(--emerald) 25%, transparent))"
          : "linear-gradient(225deg, transparent 60%, color-mix(in srgb, var(--rose) 25%, transparent))",
      }}
    >
      <div
        className="rounded-md px-3 py-1 text-xs font-semibold uppercase tracking-wider"
        style={{
          background: isRight ? "var(--emerald)" : "var(--rose)",
          color: "#fff",
          marginLeft: isRight ? "auto" : 0,
          marginRight: isRight ? 0 : "auto",
        }}
      >
        {isRight ? "Mark" : "Skip"}
      </div>
    </div>
  );
}

function ActionBar({
  canSwipe,
  onLeft,
  onRight,
}: {
  canSwipe: boolean;
  onLeft: () => void;
  onRight: () => void;
}) {
  return (
    <div className="flex items-center justify-center gap-6">
      <ActionButton keyboard="←" label="Skip" onClick={onLeft} disabled={!canSwipe} tone="rose">
        <svg
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <line x1="6" y1="6" x2="18" y2="18" />
          <line x1="6" y1="18" x2="18" y2="6" />
        </svg>
      </ActionButton>
      <ActionButton keyboard="→" label="Mark" onClick={onRight} disabled={!canSwipe} tone="emerald">
        <svg
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </ActionButton>
    </div>
  );
}

function ActionButton({
  children,
  keyboard,
  label,
  onClick,
  disabled,
  tone,
}: {
  children: React.ReactNode;
  keyboard: string;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  tone: "rose" | "emerald";
}) {
  const colorVar = tone === "rose" ? "var(--rose)" : "var(--emerald)";
  const bgVar = tone === "rose" ? "var(--rose-tint)" : "var(--emerald-tint)";
  return (
    <div className="flex flex-col items-center gap-2">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-label={`${label} (${keyboard})`}
        title={`${label} (${keyboard})`}
        className="inline-flex items-center justify-center rounded-full transition disabled:opacity-40"
        style={{
          width: 56,
          height: 56,
          background: bgVar,
          color: colorVar,
          border: `1px solid ${colorVar}`,
        }}
      >
        {children}
      </button>
      <span
        className="text-[11px] uppercase tracking-[0.16em]"
        style={{ color: "var(--fg-subtle)" }}
      >
        <span style={{ color: colorVar, fontWeight: 600 }}>{keyboard}</span> {label}
      </span>
    </div>
  );
}
