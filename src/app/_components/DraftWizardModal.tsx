"use client";

/**
 * Guided draft wizard.
 *
 * Modal with three rows of progressive disclosure: format → length → angles.
 * Picking a length triggers an angle-suggestion call against the cluster.
 * The user can pick one of the three suggestions or type a custom angle.
 * "Just go" submits with last-used format + length and lets the draft prompt
 * pick its own archive-habit angle (no pre-flight).
 */

import { useEffect, useRef, useState, useTransition } from "react";
import { generateDraftAction, generateDraftAnglesAction } from "@/lib/v1/actions";
import {
  WIZARD_LENGTHS,
  type DraftWizardPrefs,
  type WizardLength,
} from "@/lib/v1/wizard-prefs-shared";
import { DRAFT_FORMATS, type DraftFormat } from "@/lib/v1/draft-format";

// Angle suggestion type — kept local to avoid pulling angle-generator (and
// its DB imports) into the client bundle.
export interface AngleSuggestion {
  kind: "archive" | "gap" | "fresh";
  label: string;
  title: string;
  rationale: string;
}

const FORMAT_LABELS: Record<DraftFormat, string> = {
  narrative: "Narrative",
  listicle: "Listicle",
  "news-brief": "News brief",
  opinion: "Opinion",
  qa: "Q&A",
};

interface Props {
  clusterId: string;
  outletId: string;
  outletDisplayName: string;
  clusterTitle: string;
  prefs: DraftWizardPrefs;
  onClose: () => void;
}

type AnglesState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; angles: AngleSuggestion[] }
  | { kind: "error"; message: string };

export function DraftWizardModal({
  clusterId,
  outletId,
  outletDisplayName,
  clusterTitle,
  prefs,
  onClose,
}: Props) {
  const [format, setFormat] = useState<DraftFormat>(prefs.format);
  const [length, setLength] = useState<WizardLength>(prefs.length);
  const [angles, setAngles] = useState<AnglesState>({ kind: "idle" });
  const [pickedKind, setPickedKind] = useState<AngleSuggestion["kind"] | "custom" | null>(null);
  const [customAngle, setCustomAngle] = useState("");
  const [showCustom, setShowCustom] = useState(false);
  const [drafting, startDrafting] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // Bumped each time the user changes format or length; cancels in-flight
  // angle calls so a fast click-through doesn't render stale suggestions.
  const angleRunRef = useRef(0);

  // Trigger angle generation as soon as the modal mounts with a format +
  // length already chosen (which is true on every open thanks to last-used
  // prefs). The user can still re-pick chips and we'll re-fetch.
  useEffect(() => {
    let cancelled = false;
    const runId = ++angleRunRef.current;
    setAngles({ kind: "loading" });
    setPickedKind(null);

    const fd = new FormData();
    fd.set("clusterId", clusterId);
    fd.set("outletId", outletId);
    fd.set("format", format);
    fd.set("wordCount", String(length));

    generateDraftAnglesAction(fd)
      .then((res) => {
        if (cancelled || runId !== angleRunRef.current) return;
        setAngles({ kind: "ready", angles: res.angles });
      })
      .catch((err: unknown) => {
        if (cancelled || runId !== angleRunRef.current) return;
        const message = err instanceof Error ? err.message : "Could not load angles.";
        setAngles({ kind: "error", message });
      });

    return () => {
      cancelled = true;
    };
  }, [clusterId, outletId, format, length]);

  // Close on Escape.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !drafting) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, drafting]);

  const customTrimmed = customAngle.trim();
  const canDraft =
    !drafting &&
    (pickedKind === "custom" ? customTrimmed.length > 0 : pickedKind !== null);

  function submit({ justGo }: { justGo: boolean }) {
    setError(null);
    const fd = new FormData();
    fd.set("clusterId", clusterId);
    fd.set("outletId", outletId);
    fd.set("mode", "drafter");
    fd.set("format", format);
    fd.set("wordCount", String(length));

    if (justGo) {
      // Skip the angle pre-flight. Let the draft prompt fall back to its
      // archive-habit default. This is the fast path.
    } else if (pickedKind === "custom") {
      if (customTrimmed.length === 0) {
        setError("Type a custom angle or pick one of the cards.");
        return;
      }
      fd.set("customAngle", customTrimmed.slice(0, 200));
    } else if (pickedKind && angles.kind === "ready") {
      const picked = angles.angles.find((a) => a.kind === pickedKind);
      if (!picked) {
        setError("Pick an angle first.");
        return;
      }
      // Pass the picked angle as a custom-angle string so the existing
      // generator follows it verbatim. We could route archive/gap kinds to
      // the angle-hint path instead, but that loses the model-written title
      // and rationale the user just chose.
      fd.set("customAngle", `${picked.title}. ${picked.rationale}`.slice(0, 200));
    } else {
      setError("Pick an angle or click Just go.");
      return;
    }

    startDrafting(async () => {
      try {
        await generateDraftAction(fd);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Could not start draft.";
        setError(message);
      }
    });
  }

  function pickGenerated(kind: AngleSuggestion["kind"]) {
    setPickedKind(kind);
    setShowCustom(false);
  }

  function pickCustom() {
    setPickedKind("custom");
    setShowCustom(true);
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Draft from ${clusterTitle}`}
      className="fixed inset-0 z-50 flex items-start justify-center p-6 sm:p-10"
      style={{ background: "rgba(26, 24, 20, 0.32)", backdropFilter: "blur(2px)" }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !drafting) onClose();
      }}
    >
      <div
        className="w-full max-w-[560px] overflow-hidden rounded-[28px]"
        style={{ background: "var(--surface)", boxShadow: "var(--shadow-lg)" }}
      >
        <header
          className="flex items-start justify-between gap-4 px-6 py-5"
          style={{ borderBottom: "1px solid var(--border)" }}
        >
          <div className="min-w-0">
            <div
              className="font-mono text-[10.5px] uppercase tracking-[0.1em]"
              style={{ color: "var(--fg-subtle)" }}
            >
              Drafting for · {outletDisplayName}
            </div>
            <h2
              className="serif mt-1 truncate text-[22px] leading-tight"
              style={{ fontWeight: 500, letterSpacing: "-0.005em" }}
              title={clusterTitle}
            >
              {clusterTitle}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={drafting}
            aria-label="Close"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-base"
            style={{
              border: "1px solid var(--border)",
              color: "var(--fg-muted)",
              background: "transparent",
            }}
          >
            ×
          </button>
        </header>

        <div className="px-6">
          <Row label="Format" picked={FORMAT_LABELS[format]}>
            <ChipGroup>
              {DRAFT_FORMATS.map((f) => (
                <Chip
                  key={f}
                  selected={format === f}
                  onClick={() => setFormat(f)}
                  label={FORMAT_LABELS[f]}
                />
              ))}
            </ChipGroup>
          </Row>

          <Row label="Length" picked={`${length} words`}>
            <ChipGroup>
              {WIZARD_LENGTHS.map((n) => (
                <Chip
                  key={n}
                  selected={length === n}
                  onClick={() => setLength(n)}
                  label={`${n}`}
                  meta="w"
                />
              ))}
            </ChipGroup>
          </Row>

          <Row label="Angle" picked={anglePickedLabel(angles, pickedKind, customTrimmed)} last>
            {angles.kind === "loading" ? (
              <div className="space-y-2">
                <Skeleton />
                <Skeleton />
                <Skeleton />
              </div>
            ) : angles.kind === "error" ? (
              <div
                className="rounded-xl px-3 py-2 text-[12px]"
                style={{ background: "var(--amber-tint)", color: "var(--amber)" }}
              >
                {angles.message} Use Just go below to draft anyway.
              </div>
            ) : angles.kind === "ready" ? (
              <div className="space-y-2">
                {angles.angles.map((a) => (
                  <AngleCard
                    key={a.kind}
                    angle={a}
                    selected={pickedKind === a.kind}
                    onClick={() => pickGenerated(a.kind)}
                  />
                ))}
              </div>
            ) : null}

            <button
              type="button"
              onClick={() => (showCustom ? setShowCustom(false) : pickCustom())}
              className="mt-2 inline-flex items-center gap-1.5 px-0 py-1 text-[12.5px]"
              style={{ color: "var(--fg-muted)", background: "transparent", border: "none" }}
            >
              <span className="font-mono text-[11px]">{showCustom ? "−" : "+"}</span>{" "}
              {showCustom ? "Hide custom angle" : "Write your own angle"}
            </button>

            {showCustom ? (
              <textarea
                autoFocus
                value={customAngle}
                onChange={(e) => {
                  setCustomAngle(e.target.value.slice(0, 200));
                  setPickedKind("custom");
                }}
                placeholder="One line on the angle you actually want…"
                className="serif mt-2 w-full rounded-xl px-3 py-3 text-[14px] leading-snug"
                style={{
                  fontStyle: "italic",
                  background: "var(--bg-subtle)",
                  color: "var(--fg)",
                  border: `1px solid ${pickedKind === "custom" ? "var(--fg)" : "var(--border)"}`,
                  minHeight: 64,
                  resize: "vertical",
                }}
                rows={3}
                maxLength={200}
              />
            ) : null}
          </Row>
        </div>

        <footer
          className="flex flex-wrap items-center justify-between gap-3 px-6 py-4"
          style={{ borderTop: "1px solid var(--border)" }}
        >
          <button
            type="button"
            onClick={() => submit({ justGo: true })}
            disabled={drafting}
            className="inline-flex items-center gap-1.5 text-[13px] font-medium"
            style={{ background: "transparent", border: "none", color: "var(--fg-muted)" }}
          >
            <span className="font-mono text-[12px]">↳</span> Just go with last-used
          </button>
          <div className="flex items-center gap-3">
            {error ? (
              <span className="text-[12px]" style={{ color: "var(--amber)" }}>
                {error}
              </span>
            ) : null}
            <button
              type="button"
              onClick={() => submit({ justGo: false })}
              disabled={!canDraft}
              className="fp-btn fp-btn-primary fp-press"
            >
              {drafting ? "Drafting…" : "Draft →"}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

function anglePickedLabel(
  state: AnglesState,
  pickedKind: AngleSuggestion["kind"] | "custom" | null,
  customTrimmed: string,
): string {
  if (state.kind === "loading") return "Generating…";
  if (state.kind === "error") return "—";
  if (pickedKind === null) return "Pick one";
  if (pickedKind === "custom") {
    if (!customTrimmed) return "Custom angle";
    return `“${customTrimmed.slice(0, 48)}${customTrimmed.length > 48 ? "…" : ""}”`;
  }
  if (state.kind === "ready") {
    const picked = state.angles.find((a) => a.kind === pickedKind);
    if (picked) return picked.title;
  }
  return "Pick one";
}

function Row({
  label,
  picked,
  children,
  last,
}: {
  label: string;
  picked: string;
  children: React.ReactNode;
  last?: boolean;
}) {
  return (
    <div
      className="py-4"
      style={{ borderBottom: last ? "none" : "1px dashed var(--border)" }}
    >
      <div className="mb-3 flex items-baseline justify-between">
        <span
          className="text-[11px] font-semibold uppercase tracking-[0.08em]"
          style={{ color: "var(--fg-muted)" }}
        >
          {label}
        </span>
        <span className="serif text-[14px]" style={{ fontStyle: "italic", color: "var(--fg)" }}>
          {picked}
        </span>
      </div>
      {children}
    </div>
  );
}

function ChipGroup({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap gap-2">{children}</div>;
}

function Chip({
  selected,
  onClick,
  label,
  meta,
}: {
  selected: boolean;
  onClick: () => void;
  label: string;
  meta?: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onClick}
      className="rounded-full px-3.5 py-2 text-[13px] font-medium transition-colors"
      style={{
        background: selected ? "var(--fg)" : "var(--bg-subtle)",
        color: selected ? "#fbf6ec" : "var(--fg)",
        border: "1px solid transparent",
      }}
    >
      <span className={meta ? "tabular" : undefined}>{label}</span>
      {meta ? (
        <span
          className="ml-1.5 font-mono text-[10px]"
          style={{ opacity: 0.6 }}
        >
          {meta}
        </span>
      ) : null}
    </button>
  );
}

function AngleCard({
  angle,
  selected,
  onClick,
}: {
  angle: AngleSuggestion;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      className="relative cursor-pointer rounded-xl px-4 py-3 transition"
      style={{
        background: selected ? "var(--indigo-tint)" : "var(--surface)",
        border: `1px solid ${selected ? "var(--fg)" : "var(--border)"}`,
      }}
      aria-pressed={selected}
    >
      {selected ? (
        <span
          aria-hidden
          className="absolute right-3 top-3 grid h-[18px] w-[18px] place-items-center rounded-full text-[11px] leading-[18px]"
          style={{ background: "var(--fg)", color: "#fbf6ec" }}
        >
          ✓
        </span>
      ) : null}
      <div
        className="font-mono text-[9.5px] uppercase tracking-[0.12em]"
        style={{ color: selected ? "var(--rose)" : "var(--fg-subtle)" }}
      >
        {angle.label}
      </div>
      <h3
        className="serif mt-1 text-[17px] leading-[1.25]"
        style={{ fontWeight: 500, letterSpacing: "-0.005em" }}
      >
        {angle.title}
      </h3>
      <p className="mt-1 text-[13px] leading-snug" style={{ color: "var(--fg-muted)" }}>
        {angle.rationale}
      </p>
    </div>
  );
}

function Skeleton() {
  return (
    <div
      className="fp-skeleton h-[78px] rounded-xl"
      style={{ borderRadius: "var(--radius-md)" }}
      aria-hidden
    />
  );
}
