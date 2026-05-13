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
import { generateDraftAction, getDraftWizardPrefsAction } from "@/lib/v1/actions";
import { DEFAULT_WIZARD_PREFS, type DraftWizardPrefs } from "@/lib/v1/wizard-prefs-shared";
import { defaultDraftFormatOptions, type DraftFormatOption } from "@/lib/v1/draft-format";
import { DraftWizardSheet } from "./DraftWizardSheet";

interface DraftRef {
  id: string;
  voiceMatch: number;
  wpEditLink: string | null;
}

type Mode = "drafter" | "researcher";

type DraftsByMode = Record<Mode, DraftRef | null>;

interface OutletOption {
  id: string;
  displayName: string;
  formats?: DraftFormatOption[];
}

interface Props {
  clusterId: string;
  clusterTitle: string;
  outlets: OutletOption[];
  defaultOutletId: string | null;
  draftsByOutlet: Record<string, DraftsByMode>;
}

export function ClusterActions({
  clusterId,
  clusterTitle,
  outlets,
  defaultOutletId,
  draftsByOutlet,
}: Props) {
  const [pending, startTransition] = useTransition();
  const [pendingMode, setPendingMode] = useState<Mode | null>(null);
  const initialOutletId =
    defaultOutletId && outlets.some((o) => o.id === defaultOutletId)
      ? defaultOutletId
      : (outlets[0]?.id ?? null);
  const [selectedOutletId, setSelectedOutletId] = useState<string | null>(initialOutletId);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardPrefs, setWizardPrefs] = useState<DraftWizardPrefs>(DEFAULT_WIZARD_PREFS);
  const draftsForOutlet = selectedOutletId ? (draftsByOutlet[selectedOutletId] ?? null) : null;
  const draft = draftsForOutlet?.drafter ?? null;
  const notebook = draftsForOutlet?.researcher ?? null;
  const showPicker = outlets.length >= 2;

  // Pre-load last-used wizard prefs once so the modal mounts already
  // populated. Prefs come from the DB so they survive across page loads.
  useEffect(() => {
    let cancelled = false;
    getDraftWizardPrefsAction()
      .then((prefs) => {
        if (!cancelled) setWizardPrefs(prefs);
      })
      .catch(() => {
        // Fall back to defaults; prefs are nice-to-have, not load-bearing.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function trigger(actionMode: Mode, force: boolean) {
    if (!selectedOutletId) return;
    setPendingMode(actionMode);
    const fd = new FormData();
    fd.set("clusterId", clusterId);
    fd.set("outletId", selectedOutletId);
    fd.set("mode", actionMode);
    if (force) fd.set("force", "1");
    startTransition(async () => {
      try {
        await generateDraftAction(fd);
      } finally {
        setPendingMode(null);
      }
    });
  }

  const selectedOutlet = outlets.find((o) => o.id === selectedOutletId) ?? null;

  if (pending) {
    const mode = pendingMode ?? "researcher";
    return (
      <Drafting
        variant={mode === "researcher" && notebook ? "regenerating" : "drafting"}
        mode={mode}
      />
    );
  }

  const outletPicker = showPicker ? (
    <OutletPicker
      outlets={outlets}
      selectedId={selectedOutletId}
      draftsByOutlet={draftsByOutlet}
      onSelect={setSelectedOutletId}
    />
  ) : null;

  function openDraftWizard() {
    if (!selectedOutletId) return;
    setWizardOpen(true);
  }

  return (
    <div className="flex flex-col gap-3">
      {outletPicker}
      <div className="flex flex-wrap items-center gap-3">
        {draft ? (
          <Link href={`/editor/${draft.id}`} className="fp-btn fp-btn-primary fp-press">
            Open draft →
          </Link>
        ) : (
          <button
            type="button"
            onClick={openDraftWizard}
            disabled={!selectedOutletId}
            className="fp-btn fp-btn-primary fp-press"
          >
            Draft this →
          </button>
        )}
        {notebook ? (
          <Link href={`/editor/${notebook.id}`} className="fp-btn fp-btn-ghost">
            Open notebook →
          </Link>
        ) : (
          <button
            type="button"
            onClick={() => trigger("researcher", false)}
            disabled={!selectedOutletId}
            className="fp-btn fp-btn-ghost"
          >
            Take notes →
          </button>
        )}
        <span className="text-xs" style={{ color: "var(--fg-subtle)" }}>
          Draft opens the format wizard. Notes collects ideas, quotes, leads.
        </span>
      </div>
      {draft ? <DraftMeta draft={draft} /> : null}
      {wizardOpen && selectedOutletId && selectedOutlet ? (
        <DraftWizardSheet
          clusterId={clusterId}
          outletId={selectedOutletId}
          outletDisplayName={selectedOutlet.displayName}
          formats={selectedOutlet.formats ?? defaultDraftFormatOptions()}
          clusterTitle={clusterTitle}
          prefs={wizardPrefs}
          onClose={() => setWizardOpen(false)}
        />
      ) : null}
    </div>
  );
}

function DraftMeta({ draft }: { draft: DraftRef }) {
  const isPublished = Boolean(draft.wpEditLink);
  return (
    <div className="text-xs" style={{ color: "var(--fg-muted)" }}>
      {isPublished ? (
        <a href={draft.wpEditLink!} target="_blank" rel="noreferrer" className="hover:underline">
          in WordPress ↗
        </a>
      ) : (
        <>
          voice-match <span className="font-medium tabular">{draft.voiceMatch}</span>
        </>
      )}
    </div>
  );
}

function OutletPicker({
  outlets,
  selectedId,
  draftsByOutlet,
  onSelect,
}: {
  outlets: OutletOption[];
  selectedId: string | null;
  draftsByOutlet: Record<string, DraftsByMode>;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-[11px] uppercase tracking-wider" style={{ color: "var(--fg-muted)" }}>
        Outlet
      </span>
      <div
        className="inline-flex rounded-lg p-0.5"
        style={{
          background: "var(--bg-subtle)",
          border: "1px solid var(--border)",
        }}
        role="radiogroup"
        aria-label="Outlet"
      >
        {outlets.map((o) => {
          const isSelected = o.id === selectedId;
          const bucket = draftsByOutlet[o.id];
          const hasDraft = Boolean(bucket?.drafter || bucket?.researcher);
          return (
            <button
              key={o.id}
              type="button"
              role="radio"
              aria-checked={isSelected}
              onClick={() => onSelect(o.id)}
              className="rounded-md px-2.5 py-1 text-xs font-medium transition-colors"
              style={{
                background: isSelected ? "var(--surface)" : "transparent",
                color: isSelected ? "var(--fg)" : "var(--fg-muted)",
                boxShadow: isSelected ? "var(--shadow-sm)" : undefined,
              }}
            >
              {o.displayName}
              {hasDraft ? (
                <span
                  className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full align-middle"
                  style={{ background: "var(--emerald)" }}
                  aria-label="has draft"
                />
              ) : null}
            </button>
          );
        })}
      </div>
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

const NOTES_STAGES: Stage[] = [
  {
    label: "Reading sources",
    detail: "Pulling cluster items into a single timeline.",
    ms: 800,
  },
  {
    label: "Pulling angles",
    detail: "3 to 5 distinct framings the post could take.",
    ms: 2500,
  },
  {
    label: "Lifting quotes",
    detail: "Verbatim, attributed, capped at 30 words each.",
    ms: 2500,
  },
  {
    label: "Pulling leads",
    detail: "Claims with source URLs for you to verify.",
    ms: 2500,
  },
  {
    label: "Polishing",
    detail: "Persisting; opening the notebook.",
    ms: 99_999,
  },
];

function Drafting({ variant, mode }: { variant: "drafting" | "regenerating"; mode: Mode }) {
  const stages = mode === "researcher" ? NOTES_STAGES : STAGES;
  const [stageIdx, setStageIdx] = useState(0);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const start = performance.now();
    const tick = window.setInterval(() => {
      const e = performance.now() - start;
      setElapsed(e);
      let cum = 0;
      for (let i = 0; i < stages.length; i++) {
        cum += stages[i]!.ms;
        if (e < cum) {
          setStageIdx(i);
          return;
        }
      }
      setStageIdx(stages.length - 1);
    }, 150);
    return () => window.clearInterval(tick);
  }, [stages]);

  const headline =
    mode === "researcher"
      ? variant === "regenerating"
        ? "Regenerating notes"
        : "Taking notes"
      : variant === "regenerating"
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
            {stages[stageIdx]!.label}: {stages[stageIdx]!.detail}
          </div>
        </div>
        <div className="text-xs tabular shrink-0" style={{ color: "var(--fg-subtle)" }}>
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
            background: "linear-gradient(90deg, var(--indigo) 0%, var(--rose) 100%)",
          }}
        />
      </div>

      <ol className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-3">
        {stages.slice(0, -1).map((s, i) => {
          const isDone = i < stageIdx;
          const isActive = i === stageIdx;
          const color = isDone ? "var(--emerald)" : isActive ? "var(--indigo)" : "var(--fg-subtle)";
          return (
            <li key={s.label} className="flex items-center gap-1.5 text-[11px]" style={{ color }}>
              <StageGlyph state={isDone ? "done" : isActive ? "active" : "pending"} />
              <span className={isActive ? "font-medium" : ""} style={{ letterSpacing: "0.01em" }}>
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
      <svg
        width="11"
        height="11"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
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
