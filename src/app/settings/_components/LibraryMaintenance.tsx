"use client";

/**
 * Library maintenance card on /settings.
 *
 * Two long-running jobs the user might run after pulling new releases:
 *   - Re-tag entities: re-runs the LLM extractor over every item.
 *     Idempotent (cached by content_hash). Recommended after the LLM
 *     extractor or its prompt is upgraded.
 *   - Rebuild clusters: wipes existing clusters and re-runs the
 *     three-layer cluster engine over every item in chronological
 *     order, with the latest entity tags + Layer 3 merge oracle. Run
 *     after the re-tag pass for the cleanest result.
 *
 * Each button kicks off the matching server action and shows a
 * determinate progress toast driven by job_progress (real progress,
 * not a CSS animation). Buttons disable while a job of that kind is
 * already running so a user can't double-fire.
 */

import { useState, useTransition } from "react";
import { useToast } from "@/app/_components/Toast";
import {
  cleanupLibraryAction,
  getJobProgressAction,
  runReclusterAction,
  runReextractEntitiesAction,
} from "@/lib/v1/actions";

type JobKind = "reextract" | "recluster";

const JOB_LABELS: Record<JobKind, { title: string; running: string; done: string }> = {
  reextract: {
    title: "Re-tag entities",
    running: "Re-tagging entities",
    done: "Re-tagged",
  },
  recluster: {
    title: "Rebuild clusters",
    running: "Rebuilding clusters",
    done: "Clusters rebuilt",
  },
};

export function LibraryMaintenance({ draftCount = 0 }: { draftCount?: number }) {
  const { show } = useToast();
  const [pendingKind, setPendingKind] = useState<JobKind | null>(null);
  const [, startTransition] = useTransition();
  const reclusterBlocked = draftCount > 0;

  const runJob = (kind: JobKind) => {
    if (pendingKind !== null) return;
    if (kind === "recluster" && reclusterBlocked) {
      show({
        title: "Rebuild blocked",
        body: `${draftCount} existing ${
          draftCount === 1 ? "draft depends" : "drafts depend"
        } on current clusters. Rebuild is only available before drafts exist.`,
        durationMs: 7000,
      });
      return;
    }
    setPendingKind(kind);
    startTransition(async () => {
      try {
        const start =
          kind === "reextract" ? await runReextractEntitiesAction() : await runReclusterAction();
        const labels = JOB_LABELS[kind];
        let completionToast: { title: string; body?: string; durationMs: number } | null = null;

        if (start.total === 0) {
          show({
            title: "Library is empty",
            body: "Add some sources, poll, then come back.",
            durationMs: 4000,
          });
          setPendingKind(null);
          return;
        }

        if (start.alreadyRunning) {
          show({
            title: `${labels.running} (in progress)`,
            body: "Hooked into the existing job",
            durationMs: 3000,
          });
        }

        // Determinate toast driven by job_progress polling. The toast
        // dismisses itself when the job completes or errors; the
        // pending-kind flag is cleared via the same polling loop.
        show({
          title: labels.running,
          body: `${start.total} ${start.total === 1 ? "item" : "items"} queued`,
          durationMs: 30 * 60 * 1000, // 30 min watchdog
          pollIntervalMs: 1500,
          pollProgress: async () => {
            const j = await getJobProgressAction(start.jobId);
            if (!j) {
              setPendingKind(null);
              return { progress: 1, complete: true };
            }
            const progress = j.total > 0 ? Math.min(1, j.completed / j.total) : 1;
            const complete = j.completedAt !== null || j.error !== null;
            if (complete) {
              setPendingKind(null);
              if (j.error) {
                completionToast = {
                  title: `${labels.title} failed`,
                  body: j.error.slice(0, 240),
                  durationMs: 8000,
                };
              } else {
                completionToast = {
                  title: `${labels.done} (${j.completed}/${j.total})`,
                  durationMs: 4000,
                };
              }
            }
            return { progress, complete };
          },
          onComplete: () => {
            if (completionToast) show(completionToast);
          },
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        show({
          title: `${JOB_LABELS[kind].title} failed`,
          body: msg.slice(0, 240),
          durationMs: 8000,
        });
        setPendingKind(null);
      }
    });
  };

  return (
    <section
      className="space-y-4 rounded-2xl p-5"
      style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
    >
      <header className="space-y-1">
        <div className="fp-eyebrow">Library maintenance</div>
        <h2 className="text-lg font-semibold tracking-tight">Re-tag and rebuild</h2>
        <p className="text-sm" style={{ color: "var(--fg-muted)" }}>
          Run these after upgrading FlavorPress to refresh tags and cluster groupings against your
          existing library. Re-tagging is always safe; rebuilding is blocked once drafts exist so
          draft receipts stay attached to their source stories.
        </p>
      </header>

      <div className="grid gap-3 sm:grid-cols-2">
        <JobButton
          kind="reextract"
          title="Re-tag entities"
          description="Walks every item and re-runs the LLM extractor. Cached by content hash, so a second pass is free."
          pendingKind={pendingKind}
          onClick={() => runJob("reextract")}
        />
        <JobButton
          kind="recluster"
          title="Rebuild clusters"
          description={
            reclusterBlocked
              ? "Unavailable because existing drafts depend on current clusters."
              : "Wipes clusters (preserves items) and re-clusters from scratch using the latest tags and Layer 3 merge oracle. Run after re-tag."
          }
          pendingKind={pendingKind}
          disabledReason={reclusterBlocked ? "Existing drafts depend on current clusters" : null}
          onClick={() => runJob("recluster")}
        />
      </div>

      <CleanupCard />
    </section>
  );
}

function CleanupCard() {
  const { show } = useToast();
  const [hours, setHours] = useState<string>("72");
  const [pending, startTransition] = useTransition();

  function parseHours(): number | null {
    const n = Number(hours);
    if (!Number.isFinite(n)) return null;
    const rounded = Math.round(n);
    if (rounded < 1 || rounded > 8760) return null;
    return rounded;
  }

  function run() {
    const h = parseHours();
    if (h === null) {
      show({
        title: "Enter a number between 1 and 8760",
        durationMs: 3000,
      });
      return;
    }
    startTransition(async () => {
      const preview = await cleanupLibraryAction({ olderThanHours: h, preview: true });
      if (preview.deletedClusters === 0 && preview.deletedItems === 0) {
        show({
          title: "Nothing to clean up",
          body: `No clusters or items older than ${h} hours that aren't tied to a draft.`,
          durationMs: 4000,
        });
        return;
      }
      const ok = window.confirm(
        `Delete ${preview.deletedClusters} ${
          preview.deletedClusters === 1 ? "cluster" : "clusters"
        } and ${preview.deletedItems} ${
          preview.deletedItems === 1 ? "item" : "items"
        } older than ${h} hours? Drafted clusters are preserved. This cannot be undone.`,
      );
      if (!ok) return;
      const result = await cleanupLibraryAction({ olderThanHours: h, preview: false });
      show({
        title: "Library cleaned",
        body: `Removed ${result.deletedClusters} ${
          result.deletedClusters === 1 ? "cluster" : "clusters"
        } and ${result.deletedItems} ${result.deletedItems === 1 ? "item" : "items"}.`,
        durationMs: 5000,
      });
    });
  }

  const isInvalid = parseHours() === null;

  return (
    <div
      className="flex flex-col gap-3 rounded-xl p-4"
      style={{ background: "var(--bg-subtle)", border: "1px solid var(--border)" }}
    >
      <div>
        <div className="text-sm font-semibold" style={{ color: "var(--fg)" }}>
          Clean up old clusters
        </div>
        <p className="mt-1 text-xs leading-relaxed" style={{ color: "var(--fg-muted)" }}>
          Delete clusters whose latest item is older than the cutoff, plus their items, plus any
          orphan items past the cutoff. Drafted clusters and their items are preserved.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-xs" style={{ color: "var(--fg-muted)" }}>
          Older than
          <input
            type="number"
            min={1}
            max={8760}
            step={1}
            value={hours}
            onChange={(e) => setHours(e.target.value)}
            className="tabular rounded-md px-2 py-1 text-sm"
            style={{
              background: "var(--surface)",
              border: "1px solid var(--border-strong)",
              color: "var(--fg)",
              width: 80,
            }}
            disabled={pending}
            aria-invalid={isInvalid}
          />
          hours
        </label>
        <button
          type="button"
          onClick={run}
          disabled={pending || isInvalid}
          className="fp-btn"
          style={{
            background: pending || isInvalid ? "var(--bg-subtle)" : "var(--indigo)",
            color: pending || isInvalid ? "var(--fg-muted)" : "var(--bg)",
            border:
              pending || isInvalid ? "1px solid var(--border-strong)" : "1px solid var(--indigo)",
            fontSize: 12,
            padding: "0.3rem 0.7rem",
          }}
        >
          {pending ? "Cleaning" : "Clean up"}
        </button>
      </div>
    </div>
  );
}

function JobButton({
  kind,
  title,
  description,
  pendingKind,
  disabledReason,
  onClick,
}: {
  kind: JobKind;
  title: string;
  description: string;
  pendingKind: JobKind | null;
  disabledReason?: string | null;
  onClick: () => void;
}) {
  const isThisRunning = pendingKind === kind;
  const isOtherRunning = pendingKind !== null && pendingKind !== kind;
  const disabled = isThisRunning || isOtherRunning || Boolean(disabledReason);
  return (
    <div
      className="flex flex-col gap-3 rounded-xl p-4"
      style={{ background: "var(--bg-subtle)", border: "1px solid var(--border)" }}
    >
      <div>
        <div className="text-sm font-semibold" style={{ color: "var(--fg)" }}>
          {title}
        </div>
        <p className="mt-1 text-xs leading-relaxed" style={{ color: "var(--fg-muted)" }}>
          {description}
        </p>
      </div>
      <button
        type="button"
        className="fp-btn"
        style={{
          background: disabled ? "var(--bg-subtle)" : "var(--indigo)",
          color: disabled ? "var(--fg-muted)" : "var(--bg)",
          border: disabled ? "1px solid var(--border-strong)" : "1px solid var(--indigo)",
        }}
        disabled={disabled}
        aria-disabled={disabled}
        title={disabledReason ?? undefined}
        onClick={onClick}
      >
        {isThisRunning ? "Running" : isOtherRunning ? "Wait" : "Run"}
      </button>
    </div>
  );
}
