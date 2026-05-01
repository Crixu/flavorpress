"use client";

import type { CSSProperties, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";

interface SubmitButtonProps {
  children: ReactNode;
  pendingLabel: ReactNode;
  className?: string;
  style?: CSSProperties;
  title?: string;
  disabled?: boolean;
}

export function SubmitButton({
  children,
  pendingLabel,
  className,
  style,
  title,
  disabled,
}: SubmitButtonProps) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className={className}
      style={style}
      title={title}
      disabled={disabled || pending}
      aria-disabled={disabled || pending}
    >
      {pending ? <Spinner /> : null}
      {pending ? pendingLabel ? <span>{pendingLabel}</span> : null : <span>{children}</span>}
    </button>
  );
}

export function PendingMessage({ children }: { children: ReactNode }) {
  const { pending } = useFormStatus();
  if (!pending) return null;
  return (
    <div className="fp-pending-message" role="status" aria-live="polite">
      <Spinner />
      <span>{children}</span>
    </div>
  );
}

interface PendingStagesProps {
  title: string;
  stages: string[];
}

export function PendingStages({ title, stages }: PendingStagesProps) {
  const { pending } = useFormStatus();
  const [stageIdx, setStageIdx] = useState(0);

  useEffect(() => {
    if (!pending) {
      setStageIdx(0);
      return;
    }

    const tick = window.setInterval(() => {
      setStageIdx((idx) => Math.min(idx + 1, stages.length - 1));
    }, 1200);

    return () => window.clearInterval(tick);
  }, [pending, stages.length]);

  if (!pending) return null;

  return (
    <div
      className="mt-3 rounded-lg p-3"
      style={{
        background: "var(--bg-subtle)",
        border: "1px solid var(--border)",
      }}
      role="status"
      aria-live="polite"
    >
      <div className="flex items-center gap-2 text-sm font-medium">
        <Spinner />
        <span>{title}</span>
      </div>
      <ol className="mt-2 grid gap-1.5 text-[11px] sm:grid-cols-2">
        {stages.map((stage, i) => {
          const active = i === stageIdx;
          const done = i < stageIdx;
          return (
            <li
              key={stage}
              className="flex items-center gap-1.5"
              style={{
                color: done ? "var(--emerald)" : active ? "var(--indigo)" : "var(--fg-subtle)",
              }}
            >
              <span
                className={active ? "fp-pending-dot fp-pulse-ring" : "fp-pending-dot"}
                aria-hidden
              />
              <span className={active ? "font-medium" : ""}>{stage}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export function DisableFormWhilePending() {
  const { pending } = useFormStatus();
  const markerRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const form = markerRef.current?.closest("form");
    if (!form) return;

    const buttons = Array.from(form.querySelectorAll("button"));
    for (const button of buttons) {
      if (pending) {
        button.dataset.fpWasDisabled = String(button.disabled);
        button.disabled = true;
        button.setAttribute("aria-disabled", "true");
      } else if (button.dataset.fpWasDisabled) {
        button.disabled = button.dataset.fpWasDisabled === "true";
        if (!button.disabled) button.removeAttribute("aria-disabled");
        delete button.dataset.fpWasDisabled;
      }
    }
  }, [pending]);

  return <span ref={markerRef} hidden />;
}

function Spinner() {
  return <span className="fp-spinner" aria-hidden />;
}
