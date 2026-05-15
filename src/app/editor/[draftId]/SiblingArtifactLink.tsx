"use client";

/**
 * Cross-link between drafter and notes artifacts for the same cluster
 * + outlet. Drafter and notes produce different work products, not two
 * views of the same content; this link surfaces the sibling artifact
 * when it exists, or commissions one on demand.
 *
 * Two states:
 *   1. Sibling exists -> link to /editor/[siblingDraftId]
 *   2. Sibling doesn't exist -> button that fires generateDraftAction
 *      with the opposite mode. Same flow as the cluster card on Today,
 *      kept explicit so the LLM call is never silent.
 */

import { useTransition } from "react";
import Link from "next/link";
import { generateDraftAction } from "@/lib/v1/actions";

type Mode = "drafter" | "researcher";

declare global {
  interface Window {
    __flavorpressSaveResearchBoard?: (draftId: string) => Promise<void>;
  }
}

interface Props {
  clusterId: string;
  outletId: string;
  /** The mode the user is currently looking at; the link points to the OTHER mode. */
  currentMode: Mode;
  /** If a sibling artifact already exists, its id; otherwise null. */
  siblingDraftId: string | null;
  /** Current draft id. Used as a seed when commissioning the OTHER mode
   *  from this view, so the drafter inherits the writer's curated quotes
   *  and angles instead of re-scanning the cluster fresh. */
  currentDraftId: string;
}

export function SiblingArtifactLink({
  clusterId,
  outletId,
  currentMode,
  siblingDraftId,
  currentDraftId,
}: Props) {
  const [pending, startTransition] = useTransition();
  const otherMode: Mode = currentMode === "drafter" ? "researcher" : "drafter";
  const otherLabel = otherMode === "drafter" ? "draft" : "notes";
  const primaryDraftAction = currentMode === "researcher" && otherMode === "drafter";

  const linkClass = primaryDraftAction
    ? "fp-btn fp-btn-secondary"
    : "text-xs underline-offset-2 hover:underline";
  const linkStyle = primaryDraftAction ? undefined : ({ color: "var(--fg-muted)" } as const);

  if (siblingDraftId) {
    return (
      <Link href={`/editor/${siblingDraftId}`} className={linkClass} style={linkStyle}>
        {primaryDraftAction ? "Open draft" : `Open ${otherLabel} ->`}
      </Link>
    );
  }

  function generate() {
    const fd = new FormData();
    fd.set("clusterId", clusterId);
    fd.set("outletId", outletId);
    fd.set("mode", otherMode);
    if (otherMode === "drafter") {
      fd.set("wordCount", "600");
      // Coming from a notebook view: seed the drafter with the writer's
      // curated angles + verbatim quotes so they survive the handoff.
      if (currentMode === "researcher") fd.set("seedFromDraftId", currentDraftId);
    }
    startTransition(async () => {
      if (currentMode === "researcher" && window.__flavorpressSaveResearchBoard) {
        await window.__flavorpressSaveResearchBoard(currentDraftId);
      }
      // generateDraftAction redirects to /editor/[id] on success.
      await generateDraftAction(fd);
    });
  }

  return (
    <button
      type="button"
      onClick={generate}
      disabled={pending}
      className={linkClass}
      style={
        primaryDraftAction
          ? { cursor: pending ? "wait" : "pointer" }
          : {
              ...linkStyle,
              background: "transparent",
              border: "none",
              padding: 0,
              cursor: pending ? "wait" : "pointer",
            }
      }
      aria-disabled={pending}
    >
      {pending ? `Generating ${otherLabel}...` : `Generate ${otherLabel}`}
    </button>
  );
}
