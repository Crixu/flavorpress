"use client";

/**
 * Step-wise draft wizard rendered as a right-side sheet.
 *
 * Step 1: Format
 * Step 2: Length
 * Step 3: Angle (angles are fetched only on entering this step)
 *
 * Angle results are cached per (format, length) key so going Back+Next
 * does not re-fetch.
 */

import { useEffect, useRef, useState, useTransition } from "react";
import { generateDraftAction, generateDraftAnglesAction } from "@/lib/v1/actions";
import { DRAFT_FORMATS, type DraftFormat } from "@/lib/v1/draft-format";
import {
  WIZARD_LENGTHS,
  type DraftWizardPrefs,
  type WizardLength,
} from "@/lib/v1/wizard-prefs-shared";
import { SideSheet } from "@/components/wpds/SideSheet";
import { Button } from "@/components/wpds/Button";
import "./DraftWizardSheet.css";

type Step = 1 | 2 | 3;

export interface AngleSuggestion {
  kind: "archive" | "gap" | "fresh";
  label: string;
  title: string;
  rationale: string;
}

interface Props {
  clusterId: string;
  outletId: string;
  outletDisplayName: string;
  clusterTitle: string;
  prefs: DraftWizardPrefs;
  onClose: () => void;
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

export function DraftWizardSheet({
  clusterId,
  outletId,
  outletDisplayName,
  clusterTitle,
  prefs,
  onClose,
}: Props) {
  const [step, setStep] = useState<Step>(1);
  const [format, setFormat] = useState<DraftFormat>(prefs.format);
  const [length, setLength] = useState<WizardLength>(prefs.length);
  const [angles, setAngles] = useState<AngleSuggestion[] | null>(null);
  const [angleError, setAngleError] = useState<string | null>(null);
  const [pickedKind, setPickedKind] = useState<AngleSuggestion["kind"] | "custom" | null>(null);
  const [customAngle, setCustomAngle] = useState("");
  const [drafting, startDrafting] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const cacheRef = useRef<Map<string, AngleSuggestion[]>>(new Map());

  // Pre-flight angles when entering step 3.
  useEffect(() => {
    if (step !== 3) return;
    const key = `${format}-${length}`;
    const cached = cacheRef.current.get(key);
    if (cached) {
      setAngles(cached);
      return;
    }
    setAngles(null);
    setAngleError(null);
    let cancelled = false;
    const fd = new FormData();
    fd.set("clusterId", clusterId);
    fd.set("outletId", outletId);
    fd.set("format", format);
    fd.set("wordCount", String(length));
    generateDraftAnglesAction(fd)
      .then((res) => {
        if (cancelled) return;
        cacheRef.current.set(key, res.angles);
        setAngles(res.angles);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setAngleError(err instanceof Error ? err.message : "Could not load angles");
      });
    return () => {
      cancelled = true;
    };
  }, [step, format, length, clusterId, outletId]);

  const customTrimmed = customAngle.trim();
  const canDraft =
    !drafting && (pickedKind === "custom" ? customTrimmed.length > 0 : pickedKind !== null);

  function submit({ justGo }: { justGo: boolean }) {
    setError(null);
    const fd = new FormData();
    fd.set("clusterId", clusterId);
    fd.set("outletId", outletId);
    fd.set("format", format);
    fd.set("wordCount", String(length));
    if (!justGo) {
      if (pickedKind === "custom") {
        fd.set("customAngle", customTrimmed.slice(0, 200));
      } else if (pickedKind && angles) {
        const picked = angles.find((a) => a.kind === pickedKind);
        if (picked) {
          fd.set("customAngle", `${picked.title}. ${picked.rationale}`.slice(0, 200));
        }
      }
    }
    startDrafting(async () => {
      try {
        await generateDraftAction(fd);
        onClose();
      } catch (err: unknown) {
        if (isNextRedirect(err)) throw err;
        setError(err instanceof Error ? err.message : "Could not start draft");
      }
    });
  }

  const stepLabel = step === 1 ? "1 / 3 · Format" : step === 2 ? "2 / 3 · Length" : "3 / 3 · Angle";

  const footer = (
    <>
      {step > 1 && (
        <Button variant="secondary" onClick={() => setStep((step - 1) as Step)} disabled={drafting}>
          ← Back
        </Button>
      )}
      <span style={{ flex: 1 }} />
      <Button variant="secondary" onClick={() => submit({ justGo: true })} disabled={drafting}>
        Just go
      </Button>
      {step < 3 ? (
        <Button onClick={() => setStep((step + 1) as Step)} disabled={drafting}>
          Next →
        </Button>
      ) : (
        <Button onClick={() => submit({ justGo: false })} disabled={!canDraft || drafting}>
          {drafting ? "Drafting…" : `Draft ${length} words →`}
        </Button>
      )}
    </>
  );

  return (
    <SideSheet open onClose={onClose} title={`Draft "${clusterTitle}"`} footer={footer}>
      <div className="wpds-wiz-stepbar">
        <span className="wpds-wiz-step-label">Step {stepLabel}</span>
        <span className={`wpds-wiz-step ${step >= 1 ? "on" : ""}`} />
        <span className={`wpds-wiz-step ${step >= 2 ? "on" : ""}`} />
        <span className={`wpds-wiz-step ${step >= 3 ? "on" : ""}`} />
      </div>

      <div className="wpds-wiz-cluster">
        <div className="wpds-wiz-cluster-h">{clusterTitle}</div>
        <div className="wpds-wiz-cluster-meta">
          {step === 1 && `Drafting for ${outletDisplayName}`}
          {step === 2 && `Format: ${format} · ${outletDisplayName}`}
          {step === 3 && `Format: ${format} · ${length} words · ${outletDisplayName}`}
        </div>
      </div>

      {error && <div className="wpds-wiz-error">{error}</div>}

      {step === 1 && (
        <div>
          <div className="wpds-wiz-label">Pick the format</div>
          <div className="wpds-wiz-pills">
            {DRAFT_FORMATS.map((f) => (
              <button
                key={f}
                type="button"
                className={`wpds-wiz-pill ${format === f ? "on" : ""}`}
                onClick={() => setFormat(f)}
              >
                {f}
              </button>
            ))}
          </div>
        </div>
      )}

      {step === 2 && (
        <div>
          <div className="wpds-wiz-label">Pick the length</div>
          <div className="wpds-wiz-pills">
            {WIZARD_LENGTHS.map((l) => (
              <button
                key={l}
                type="button"
                className={`wpds-wiz-pill ${length === l ? "on" : ""}`}
                onClick={() => setLength(l)}
              >
                {l}
              </button>
            ))}
          </div>
        </div>
      )}

      {step === 3 && (
        <div>
          <div className="wpds-wiz-label">Pick the angle</div>
          {!angles && !angleError && <div className="wpds-wiz-loading">Loading angles…</div>}
          {angleError && <div className="wpds-wiz-error">{angleError}</div>}
          {angles?.map((a) => (
            <div
              key={a.kind}
              role="button"
              tabIndex={0}
              className={`wpds-wiz-angle ${pickedKind === a.kind ? "on" : ""}`}
              onClick={() => setPickedKind(a.kind)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setPickedKind(a.kind);
                }
              }}
              aria-pressed={pickedKind === a.kind}
            >
              <div className="wpds-wiz-angle-k">{a.label}</div>
              <div className="wpds-wiz-angle-t">{a.title}</div>
              <div className="wpds-wiz-angle-w">{a.rationale}</div>
            </div>
          ))}
          <div
            role="button"
            tabIndex={0}
            className={`wpds-wiz-angle wpds-wiz-angle-custom ${pickedKind === "custom" ? "on" : ""}`}
            onClick={() => setPickedKind("custom")}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setPickedKind("custom");
              }
            }}
            aria-pressed={pickedKind === "custom"}
          >
            <div className="wpds-wiz-angle-k">Custom angle</div>
            <textarea
              placeholder="Write your own angle…"
              value={customAngle}
              onChange={(e) => {
                setCustomAngle(e.target.value.slice(0, 200));
                setPickedKind("custom");
              }}
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        </div>
      )}
    </SideSheet>
  );
}
