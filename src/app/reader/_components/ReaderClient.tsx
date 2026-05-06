"use client";

/**
 * Decides whether to show the onboarding practice deck or the live
 * triage deck. Onboarding state lives in localStorage so it only shows
 * on the user's first visit per browser. Until the flag is read we
 * render a same-height placeholder to avoid layout shift.
 *
 * Also owns the folder filter button and popover that replace the
 * old server-rendered chip bar.
 */

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { Button } from "@/components/wpds";
import { PracticeDeck } from "./PracticeDeck";
import { SwipeDeck, type ReaderItem } from "./SwipeDeck";
import type { ReaderFolderOption } from "@/lib/v1/reader";

const ONBOARDED_KEY = "flavorpress.reader.onboarded.v1";

export interface ReaderClientProps {
  initialItems: ReaderItem[];
  initialMarkedCount: number;
  folders: ReaderFolderOption[];
  totalCount: number;
  activeFolder: string | null;
}

type Stage = "loading" | "practice" | "live";

function subscribeToOnboardingStore(onStoreChange: () => void) {
  window.addEventListener("storage", onStoreChange);
  return () => window.removeEventListener("storage", onStoreChange);
}

function readOnboardingStage(): Stage {
  try {
    return window.localStorage.getItem(ONBOARDED_KEY) === "1" ? "live" : "practice";
  } catch {
    return "live";
  }
}

function readServerOnboardingStage(): Stage {
  return "loading";
}

export function ReaderClient({
  initialItems,
  initialMarkedCount,
  folders,
  totalCount,
  activeFolder,
}: ReaderClientProps) {
  const storedStage = useSyncExternalStore(
    subscribeToOnboardingStore,
    readOnboardingStage,
    readServerOnboardingStage,
  );
  const [completed, setCompleted] = useState(false);
  const stage: Stage = completed ? "live" : storedStage;

  function finishOnboarding() {
    try {
      window.localStorage.setItem(ONBOARDED_KEY, "1");
    } catch {
      // ignore; live deck still loads
    }
    setCompleted(true);
  }

  if (stage === "loading") {
    return (
      <div className="space-y-5" aria-hidden="true">
        <div className="h-4" />
        <div className="mx-auto" style={{ height: 460, maxWidth: 540 }} />
      </div>
    );
  }

  if (stage === "practice") {
    return <PracticeDeck onComplete={finishOnboarding} onSkip={finishOnboarding} />;
  }

  return (
    <div className="space-y-5">
      <FolderFilterButton folders={folders} totalCount={totalCount} activeFolder={activeFolder} />
      <SwipeDeck
        initialItems={initialItems}
        initialMarkedCount={initialMarkedCount}
        totalQueueCount={totalCount}
      />
    </div>
  );
}

function FolderFilterButton({
  folders,
  totalCount,
  activeFolder,
}: {
  folders: ReaderFolderOption[];
  totalCount: number;
  activeFolder: string | null;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const activeFolderName = activeFolder
    ? (folders.find((f) => f.id === activeFolder)?.name ?? "All folders")
    : "All folders";
  const activeCount = activeFolder
    ? (folders.find((f) => f.id === activeFolder)?.queueCount ?? 0)
    : totalCount;

  // Close on outside click or Escape
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Only show when there are folders to filter by
  if (folders.length === 0) return null;

  return (
    <div ref={containerRef} className="relative inline-block">
      <Button
        variant="secondary"
        size="sm"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        &#9660; Filter &middot; {activeFolderName}
        {activeCount > 0 ? ` (${activeCount})` : ""}
      </Button>
      {open ? (
        <div
          role="listbox"
          className="absolute left-0 top-full z-50 mt-1 min-w-[200px] rounded-md border py-1 shadow-lg"
          style={{
            background: "var(--surface)",
            borderColor: "var(--border)",
          }}
        >
          <Link
            href="/reader"
            role="option"
            aria-selected={!activeFolder}
            onClick={() => setOpen(false)}
            className="flex items-center justify-between px-3 py-2 text-sm transition hover:bg-[var(--bg-subtle)]"
            style={{
              color: !activeFolder ? "var(--fg)" : "var(--fg-muted)",
              fontWeight: !activeFolder ? 500 : 400,
            }}
          >
            <span>All folders</span>
            <span className="ml-4 tabular-nums text-xs" style={{ color: "var(--fg-subtle)" }}>
              {totalCount}
            </span>
          </Link>
          {folders.map((f) => {
            const active = activeFolder === f.id;
            return (
              <Link
                key={f.id}
                href={`/reader?folder=${encodeURIComponent(f.id)}`}
                role="option"
                aria-selected={active}
                onClick={() => setOpen(false)}
                className="flex items-center justify-between px-3 py-2 text-sm transition hover:bg-[var(--bg-subtle)]"
                style={{
                  color: active ? "var(--fg)" : "var(--fg-muted)",
                  fontWeight: active ? 500 : 400,
                }}
              >
                <span>{f.name}</span>
                <span className="ml-4 tabular-nums text-xs" style={{ color: "var(--fg-subtle)" }}>
                  {f.queueCount}
                </span>
              </Link>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
