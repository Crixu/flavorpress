"use client";

/**
 * Guided draft wizard.
 *
 * Modal with three rows of progressive disclosure: format -> length -> angles.
 * Picking both format and length triggers an angle-suggestion call against the cluster.
 * The user can pick one of the three suggestions or type a custom angle.
 */

import { useEffect, useRef, useState, useTransition } from "react";
import { generateDraftAction, generateDraftAnglesAction } from "@/lib/v1/actions";
import { type DraftWizardPrefs, type WizardLength } from "@/lib/v1/wizard-prefs-shared";
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

const FORMAT_LENGTHS: Record<DraftFormat, readonly WizardLength[]> = {
  narrative: [500, 1000, 1500],
  listicle: [1000, 1500, 2000],
  "news-brief": [500, 1000],
  opinion: [500, 1000, 1500],
  qa: [1000, 1500, 2000],
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
  const [format, setFormat] = useState<DraftFormat | null>(null);
  const [length, setLength] = useState<WizardLength | null>(null);
  const [angles, setAngles] = useState<AnglesState>({ kind: "idle" });
  const [pickedKind, setPickedKind] = useState<AngleSuggestion["kind"] | "custom" | null>(null);
  const [customAngle, setCustomAngle] = useState("");
  const [showCustom, setShowCustom] = useState(false);
  const [drafting, startDrafting] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // Bumped each time the user changes format or length; cancels in-flight
  // angle calls so a fast click-through doesn't render stale suggestions.
  const angleRunRef = useRef(0);
  const lengthOptions = format ? FORMAT_LENGTHS[format] : [];

  // Trigger angle generation only after the writer has actively picked both
  // format and length. Last-used prefs remain a memory, not an auto-run.
  useEffect(() => {
    if (!format || !length) {
      angleRunRef.current += 1;
      return;
    }

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
    format !== null &&
    length !== null &&
    (pickedKind === "custom" ? customTrimmed.length > 0 : pickedKind !== null);

  function submit() {
    setError(null);
    if (!format || !length) {
      setError("Pick a format and length first.");
      return;
    }

    const fd = new FormData();
    fd.set("clusterId", clusterId);
    fd.set("outletId", outletId);
    fd.set("mode", "drafter");
    fd.set("format", format);
    fd.set("wordCount", String(length));

    if (pickedKind === "custom") {
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
      setError("Pick an angle first.");
      return;
    }

    startDrafting(async () => {
      try {
        await generateDraftAction(fd);
      } catch (err: unknown) {
        if (isNextRedirect(err)) throw err;
        const message = err instanceof Error ? err.message : "Could not start draft.";
        setError(message);
      }
    });
  }

  function pickGenerated(kind: AngleSuggestion["kind"]) {
    setPickedKind(kind);
    setShowCustom(false);
  }

  function pickFormat(next: DraftFormat) {
    setFormat(next);
    setLength(null);
    setAngles({ kind: "idle" });
    setPickedKind(null);
    setShowCustom(false);
  }

  function pickLength(next: WizardLength) {
    setLength(next);
    setAngles({ kind: "idle" });
    setPickedKind(null);
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
      className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-8"
      style={{ background: "rgba(26, 24, 20, 0.32)", backdropFilter: "blur(2px)" }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !drafting) onClose();
      }}
    >
      <div
        className="flex max-h-[calc(100vh-2rem)] w-full max-w-[640px] flex-col overflow-hidden rounded-lg"
        style={{ background: "var(--surface)", boxShadow: "var(--shadow-lg)" }}
      >
        <header className="shrink-0 px-5 py-4" style={{ borderBottom: "1px solid var(--border)" }}>
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div
                className="font-mono text-[10.5px] uppercase tracking-[0.1em]"
                style={{ color: "var(--fg-subtle)" }}
              >
                Drafting for · {outletDisplayName}
              </div>
              <h2
                className="serif mt-1 truncate text-[22px] leading-tight"
                style={{ fontWeight: 500, letterSpacing: 0 }}
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
          </div>
        </header>

        <div className="flex-1 overflow-y-auto px-5">
          <Row label="Format" picked={format ? FORMAT_LABELS[format] : "Pick one"}>
            <ChipGroup>
              {DRAFT_FORMATS.map((f) => (
                <Chip
                  key={f}
                  selected={format === f}
                  onClick={() => pickFormat(f)}
                  label={FORMAT_LABELS[f]}
                />
              ))}
            </ChipGroup>
            <p className="mt-2 text-[12px]" style={{ color: "var(--fg-subtle)" }}>
              Last used: {FORMAT_LABELS[prefs.format]}
            </p>
          </Row>

          <Row
            label="Length"
            picked={!format ? "Pick format first" : length ? `${length} words` : "Pick length"}
          >
            {format ? (
              <>
                <ChipGroup>
                  {lengthOptions.map((n) => (
                    <Chip
                      key={n}
                      selected={length === n}
                      onClick={() => pickLength(n)}
                      label={lengthLabel(format, n)}
                      meta={`${n}w`}
                    />
                  ))}
                </ChipGroup>
                <p className="mt-2 text-[12px]" style={{ color: "var(--fg-subtle)" }}>
                  Last used: {prefs.length} words
                </p>
              </>
            ) : (
              <p className="text-[13px]" style={{ color: "var(--fg-subtle)" }}>
                Length options change with the format you choose.
              </p>
            )}
          </Row>

          <Row label="Angle" picked={anglePickedLabel(angles, pickedKind, customTrimmed)} last>
            {!format || !length ? (
              <div
                className="rounded-lg px-3 py-3 text-[13px]"
                style={{ background: "var(--bg-subtle)", color: "var(--fg-muted)" }}
              >
                Pick a format and length to generate grounded angle options.
              </div>
            ) : angles.kind === "loading" ? (
              <div className="space-y-2">
                <Skeleton />
                <Skeleton />
                <Skeleton />
              </div>
            ) : angles.kind === "error" ? (
              <div
                className="rounded-lg px-3 py-2 text-[12px]"
                style={{ background: "var(--amber-tint)", color: "var(--amber)" }}
              >
                {angles.message} Write a custom angle to draft anyway.
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

            {format && length ? (
              <button
                type="button"
                onClick={() => (showCustom ? setShowCustom(false) : pickCustom())}
                className="mt-2 inline-flex items-center gap-1.5 px-0 py-1 text-[12.5px]"
                style={{ color: "var(--fg-muted)", background: "transparent", border: "none" }}
              >
                <span className="font-mono text-[11px]">{showCustom ? "−" : "+"}</span>{" "}
                {showCustom ? "Hide custom angle" : "Write your own angle"}
              </button>
            ) : null}

            {showCustom ? (
              <textarea
                autoFocus
                value={customAngle}
                onChange={(e) => {
                  setCustomAngle(e.target.value.slice(0, 200));
                  setPickedKind("custom");
                }}
                placeholder="One line on the angle you actually want…"
                className="serif mt-2 w-full rounded-lg px-3 py-3 text-[14px] leading-snug"
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
          className="flex shrink-0 flex-wrap items-center justify-end gap-3 px-5 py-4"
          style={{ borderTop: "1px solid var(--border)" }}
        >
          <div className="flex items-center gap-3">
            {error ? (
              <span className="text-[12px]" style={{ color: "var(--amber)" }}>
                {error}
              </span>
            ) : null}
            <button
              type="button"
              onClick={submit}
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
  if (state.kind === "idle") return "Waiting";
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
    <div className="py-4" style={{ borderBottom: last ? "none" : "1px dashed var(--border)" }}>
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
        <span className="ml-1.5 font-mono text-[10px]" style={{ opacity: 0.6 }}>
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
      className="relative cursor-pointer rounded-lg px-4 py-3 transition"
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
      style={{ height: 62, borderRadius: "8px" }}
      aria-hidden
    />
  );
}

function lengthLabel(format: DraftFormat, words: WizardLength): string {
  if (format === "news-brief") return words === 500 ? "Brief" : "Full brief";
  if (format === "listicle")
    return words === 1000 ? "3-5 items" : words === 1500 ? "5-7 items" : "Deep list";
  if (format === "qa")
    return words === 1000 ? "3 questions" : words === 1500 ? "5 questions" : "Deep Q&A";
  if (format === "opinion")
    return words === 500 ? "Sharp take" : words === 1000 ? "Column" : "Essay";
  return words === 500 ? "Short" : words === 1000 ? "Standard" : "Long";
}

function isNextRedirect(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "digest" in err &&
    typeof err.digest === "string" &&
    err.digest.startsWith("NEXT_REDIRECT;")
  );
}
