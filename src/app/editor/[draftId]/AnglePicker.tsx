"use client";

import { useState, useTransition } from "react";
import { regenerateDraftAction } from "@/lib/v1/actions";

type AngleKind = "archive" | "gap" | "custom";

interface Props {
  draftId: string;
  archive: string | null;
  gap: string | null;
  currentAngle: string;
  customAngle: string | null;
  /** Word count to keep when regenerating with a different angle. */
  wordCount: number;
}

/**
 * Right-rail angle picker. Renders the two model-proposed angles plus a
 * custom slot the writer types into. Clicking "Regenerate" rebuilds the
 * draft body against the chosen framing without changing length. Length
 * lives in {@link LengthPicker}.
 */
export function AnglePicker({
  draftId,
  archive,
  gap,
  currentAngle,
  customAngle,
  wordCount,
}: Props) {
  const [pending, start] = useTransition();
  const [picked, setPicked] = useState<AngleKind>(() =>
    resolveInitialAngle(currentAngle, archive, gap, customAngle),
  );
  const [custom, setCustom] = useState(customAngle ?? "");

  const canSubmit = !pending && (picked !== "custom" || custom.trim().length > 0);

  function submit() {
    const fd = new FormData();
    fd.set("draftId", draftId);
    fd.set("angleHint", picked);
    if (picked === "custom") fd.set("customAngle", custom.trim().slice(0, 200));
    if (wordCount) fd.set("wordCount", String(wordCount));
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
        <div className="fp-eyebrow">Angle</div>
        <span className="text-[10px]" style={{ color: "var(--fg-subtle)" }}>
          changes the framing, not the facts
        </span>
      </div>

      <div className="mt-3 space-y-1.5">
        {archive ? (
          <AngleOption
            kind="archive"
            label="Archive habit"
            body={archive}
            picked={picked === "archive"}
            onPick={() => setPicked("archive")}
          />
        ) : null}
        {gap ? (
          <AngleOption
            kind="gap"
            label="Cluster gap"
            body={gap}
            picked={picked === "gap"}
            onPick={() => setPicked("gap")}
          />
        ) : null}
        <AngleOption
          kind="custom"
          label="Your own angle"
          body={
            picked === "custom" ? null : customAngle || "Type a one-line framing in your voice."
          }
          picked={picked === "custom"}
          onPick={() => setPicked("custom")}
        >
          {picked === "custom" ? (
            <textarea
              autoFocus
              value={custom}
              onChange={(e) => setCustom(e.target.value.slice(0, 200))}
              placeholder="e.g. read this through the lens of last week's Substack post on…"
              className="mt-2 w-full resize-none rounded-lg p-2 text-[12px] leading-snug"
              style={{
                background: "var(--bg-subtle)",
                color: "var(--fg)",
                border: "1px solid var(--border)",
                fontFamily: "var(--font-serif), Georgia, serif",
                minHeight: 64,
              }}
              rows={3}
              maxLength={200}
            />
          ) : null}
        </AngleOption>
      </div>

      <button
        type="button"
        onClick={submit}
        disabled={!canSubmit}
        className="mt-3 w-full rounded-full px-3 py-2 text-[12px] font-medium transition"
        style={{
          background: canSubmit ? "var(--fg)" : "var(--bg-subtle)",
          color: canSubmit ? "var(--surface)" : "var(--fg-subtle)",
          cursor: pending ? "wait" : canSubmit ? "pointer" : "not-allowed",
        }}
      >
        {pending ? "Regenerating draft…" : "Regenerate with this angle"}
      </button>
      <p className="mt-2 text-[10.5px] leading-snug" style={{ color: "var(--fg-subtle)" }}>
        Replaces the current body. Sources and headline alternates stay; quotes are re-lifted from
        the same cluster.
      </p>
    </div>
  );
}

function AngleOption({
  label,
  body,
  picked,
  onPick,
  children,
}: {
  kind: AngleKind;
  label: string;
  body: string | null;
  picked: boolean;
  onPick: () => void;
  children?: React.ReactNode;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onPick}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onPick();
        }
      }}
      className="cursor-pointer rounded-xl px-3 py-2 transition"
      style={{
        background: picked ? "var(--rose-tint)" : "var(--bg-subtle)",
        color: picked ? "#9C4A22" : "var(--fg-muted)",
        outline: "none",
      }}
      aria-pressed={picked}
    >
      <div className="flex items-center gap-2 text-[12px]">
        <span
          aria-hidden
          className="inline-block h-1.5 w-1.5 rounded-full transition"
          style={{
            background: picked ? "#9C4A22" : "var(--fg-subtle)",
          }}
        />
        <span className="font-semibold">{label}</span>
      </div>
      {body ? <div className="mt-0.5 pl-3.5 text-[11px] leading-snug">{body}</div> : null}
      {children}
    </div>
  );
}

function resolveInitialAngle(
  currentAngle: string,
  archive: string | null,
  gap: string | null,
  customAngle: string | null,
): AngleKind {
  if (currentAngle === "custom" && customAngle) return "custom";
  if (currentAngle === "gap" && gap) return "gap";
  if (currentAngle === "archive" && archive) return "archive";
  if (archive) return "archive";
  if (gap) return "gap";
  return "custom";
}
