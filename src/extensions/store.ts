"use client";

/**
 * Shared client-side state for editor extensions.
 *
 * State is keyed by draftId, then by extensionId. The article overlay
 * needs the union of all extensions' annotations to draw highlights;
 * each Panel only needs its own slice. A draft-level `active` selection
 * is shared across extensions so clicking any highlight rings exactly
 * one card at a time.
 *
 * The store is a plain module-scoped pub/sub, not React Context, so
 * sibling components in different grid cells can subscribe without
 * the editor page having to host a provider.
 */

import { useEffect, useState } from "react";
import type { ExtensionAnnotation } from "./types";

export type RunStatus = "idle" | "running" | "error";

export interface ExtensionSlice {
  annotations: ExtensionAnnotation[];
  status: RunStatus;
  error: string | null;
  ranAt: number | null;
}

export interface ActiveSelection {
  extensionId: string;
  annotationId: string;
}

interface DraftStore {
  byExtension: Record<string, ExtensionSlice>;
  /**
   * Extension ids that have already been seeded from server-loaded data.
   * Tracking this explicitly is what prevents `hydrateSlice` from
   * overwriting a freshly-set "running" status during the re-render
   * triggered by `setSlice`. Without it, an empty-but-running slice
   * looks identical to a never-seeded slice and gets reset to idle.
   */
  hydrated: Set<string>;
  active: ActiveSelection | null;
  listeners: Set<() => void>;
}

const stores = new Map<string, DraftStore>();

const EMPTY_SLICE: ExtensionSlice = Object.freeze({
  annotations: [],
  status: "idle",
  error: null,
  ranAt: null,
}) as ExtensionSlice;

function ensure(draftId: string): DraftStore {
  let s = stores.get(draftId);
  if (!s) {
    s = {
      byExtension: {},
      hydrated: new Set(),
      active: null,
      listeners: new Set(),
    };
    stores.set(draftId, s);
  }
  return s;
}

function notify(s: DraftStore): void {
  s.listeners.forEach((l) => l());
}

export function getSlice(
  draftId: string,
  extensionId: string,
): ExtensionSlice {
  const s = ensure(draftId);
  return s.byExtension[extensionId] ?? EMPTY_SLICE;
}

export function setSlice(
  draftId: string,
  extensionId: string,
  partial: Partial<ExtensionSlice>,
): void {
  const s = ensure(draftId);
  const existing = s.byExtension[extensionId] ?? EMPTY_SLICE;
  s.byExtension[extensionId] = { ...existing, ...partial };
  notify(s);
}

export function setActive(
  draftId: string,
  active: ActiveSelection | null,
): void {
  const s = ensure(draftId);
  s.active = active;
  notify(s);
}

function useStoreSubscription(draftId: string): void {
  const [, force] = useState(0);
  useEffect(() => {
    const s = ensure(draftId);
    const trigger = () => force((n) => n + 1);
    s.listeners.add(trigger);
    return () => {
      s.listeners.delete(trigger);
    };
  }, [draftId]);
}

export function useExtensionSlice(
  draftId: string,
  extensionId: string,
): ExtensionSlice {
  useStoreSubscription(draftId);
  return getSlice(draftId, extensionId);
}

export function useActiveSelection(
  draftId: string,
): ActiveSelection | null {
  useStoreSubscription(draftId);
  return ensure(draftId).active;
}

/**
 * Flat list of every annotation across every extension on this draft.
 * Used by the article overlay to wrap spans uniformly.
 */
export function useAllAnnotations(draftId: string): Array<{
  extensionId: string;
  annotation: ExtensionAnnotation;
}> {
  useStoreSubscription(draftId);
  const s = ensure(draftId);
  const out: Array<{ extensionId: string; annotation: ExtensionAnnotation }> =
    [];
  for (const [extensionId, slice] of Object.entries(s.byExtension)) {
    for (const annotation of slice.annotations) {
      out.push({ extensionId, annotation });
    }
  }
  return out;
}

/**
 * Idempotent seed for an extension's slice from server-loaded data.
 * Safe to call during render; the hydrated set guarantees we only seed
 * once per (draft, extension) per page load, even if the slice is
 * still empty (e.g. mid-run with no prior persisted annotations).
 * Never notifies listeners.
 */
export function hydrateSlice(
  draftId: string,
  extensionId: string,
  annotations: ExtensionAnnotation[],
  ranAt: number | null,
): void {
  const s = ensure(draftId);
  if (s.hydrated.has(extensionId)) return;
  s.hydrated.add(extensionId);
  s.byExtension[extensionId] = {
    annotations,
    status: "idle",
    error: null,
    ranAt,
  };
}
