"use client";

/**
 * Decides whether to show the onboarding practice deck or the live
 * triage deck. Onboarding state lives in localStorage so it only shows
 * on the user's first visit per browser. Until the flag is read we
 * render a same-height placeholder to avoid layout shift.
 */

import { useState, useSyncExternalStore } from "react";
import { PracticeDeck } from "./PracticeDeck";
import { SwipeDeck, type ReaderItem } from "./SwipeDeck";

const ONBOARDED_KEY = "flavorpress.reader.onboarded.v1";

interface Props {
  initialItems: ReaderItem[];
  initialMarkedCount: number;
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

export function ReaderClient({ initialItems, initialMarkedCount }: Props) {
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

  return <SwipeDeck initialItems={initialItems} initialMarkedCount={initialMarkedCount} />;
}
