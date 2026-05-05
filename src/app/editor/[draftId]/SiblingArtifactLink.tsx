"use client";

/**
 * Cross-link between drafter and researcher artifacts for the same
 * cluster + outlet. Drafter and researcher produce different work
 * products, not two views of the same content; this link surfaces the
 * sibling artifact when it exists, or commissions one on demand.
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

interface Props {
  clusterId: string;
  outletId: string;
  /** The mode the user is currently looking at; the link points to the OTHER mode. */
  currentMode: Mode;
  /** If a sibling artifact already exists, its id; otherwise null. */
  siblingDraftId: string | null;
}

export function SiblingArtifactLink({ clusterId, outletId, currentMode, siblingDraftId }: Props) {
  const [pending, startTransition] = useTransition();
  const otherMode: Mode = currentMode === "drafter" ? "researcher" : "drafter";
  const otherLabel = otherMode === "drafter" ? "drafted version" : "research notes";

  // One visual treatment regardless of state: a small text-with-arrow that
  // either jumps to an existing sibling or commissions one. Earlier this
  // rendered as a link in one direction and a styled button in the other,
  // which made the same affordance look like two different things.
  const linkClass = "text-xs underline-offset-2 hover:underline";
  const linkStyle = { color: "var(--fg-muted)" } as const;

  if (siblingDraftId) {
    return (
      <Link href={`/editor/${siblingDraftId}`} className={linkClass} style={linkStyle}>
        Also has {otherLabel} →
      </Link>
    );
  }

  function generate() {
    const fd = new FormData();
    fd.set("clusterId", clusterId);
    fd.set("outletId", outletId);
    fd.set("mode", otherMode);
    if (otherMode === "drafter") fd.set("wordCount", "600");
    startTransition(async () => {
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
      style={{
        ...linkStyle,
        background: "transparent",
        border: "none",
        padding: 0,
        cursor: pending ? "wait" : "pointer",
      }}
      aria-disabled={pending}
    >
      {pending ? `Generating ${otherLabel}…` : `Generate ${otherLabel} →`}
    </button>
  );
}
