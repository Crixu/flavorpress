"use client";

import { useEffect, useState, useTransition } from "react";
import type {
  ClientExtensionEntry,
  ExtensionPanelProps,
} from "../types";
import {
  clearRelatedImagesAction,
  loadRelatedImagesAction,
  runRelatedImagesAction,
  setLicenseFilterAction,
  type RelatedImagesPayload,
} from "./actions";
import {
  DEFAULT_LICENSE_FILTER,
  LICENSE_CODES,
  LICENSE_DESCRIPTIONS,
  LICENSE_LABELS,
  RELATED_IMAGES_ID,
  RELATED_IMAGES_LABEL,
  type LicenseCode,
  type RelatedImageResult,
} from "./types";

interface PanelState {
  results: RelatedImageResult[];
  ranAt: number | null;
  licenseFilter: LicenseCode[];
  status: "idle" | "loading" | "running" | "error";
  error: string | null;
  settingsOpen: boolean;
  copiedId: string | null;
}

const INITIAL_STATE: PanelState = {
  results: [],
  ranAt: null,
  licenseFilter: [...DEFAULT_LICENSE_FILTER],
  status: "loading",
  error: null,
  settingsOpen: false,
  copiedId: null,
};

function RelatedImagesPanel({ draftId }: ExtensionPanelProps) {
  const [state, setState] = useState<PanelState>(INITIAL_STATE);
  const [, startTransition] = useTransition();

  // Hydrate stored results + license filter once per mount. The
  // extension manages its own state instead of going through the shared
  // annotation store because image suggestions aren't span-anchored.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const fd = new FormData();
      fd.set("draftId", draftId);
      const res = await loadRelatedImagesAction(fd);
      if (cancelled) return;
      if (res.ok) {
        setState((s) => ({
          ...s,
          results: res.payload.results,
          ranAt: res.payload.ranAt,
          licenseFilter: res.payload.licenseFilter,
          status: "idle",
          error: null,
        }));
      } else {
        setState((s) => ({ ...s, status: "error", error: res.error }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [draftId]);

  function applyPayload(payload: RelatedImagesPayload) {
    setState((s) => ({
      ...s,
      results: payload.results,
      ranAt: payload.ranAt,
      licenseFilter: payload.licenseFilter,
      status: "idle",
      error: null,
    }));
  }

  function handleRun() {
    setState((s) => ({ ...s, status: "running", error: null }));
    startTransition(async () => {
      const fd = new FormData();
      fd.set("draftId", draftId);
      const res = await runRelatedImagesAction(fd);
      if (res.ok) applyPayload(res.payload);
      else setState((s) => ({ ...s, status: "error", error: res.error }));
    });
  }

  function handleClear() {
    startTransition(async () => {
      const fd = new FormData();
      fd.set("draftId", draftId);
      await clearRelatedImagesAction(fd);
      setState((s) => ({ ...s, results: [], ranAt: null, error: null }));
    });
  }

  function toggleLicense(code: LicenseCode) {
    const next = state.licenseFilter.includes(code)
      ? state.licenseFilter.filter((c) => c !== code)
      : [...state.licenseFilter, code];
    setState((s) => ({ ...s, licenseFilter: next }));
    startTransition(async () => {
      const fd = new FormData();
      fd.set("draftId", draftId);
      fd.set("codes", next.join(","));
      const res = await setLicenseFilterAction(fd);
      if (res.ok) applyPayload(res.payload);
    });
  }

  async function handleCopy(image: RelatedImageResult) {
    try {
      await navigator.clipboard.writeText(image.imageUrl);
      setState((s) => ({ ...s, copiedId: image.id }));
      setTimeout(() => {
        setState((s) =>
          s.copiedId === image.id ? { ...s, copiedId: null } : s,
        );
      }, 1500);
    } catch {
      // Some embedded surfaces block clipboard writes; we just no-op.
    }
  }

  const isRunning = state.status === "running";
  const isLoading = state.status === "loading";

  return (
    <div
      className="rounded-2xl p-4"
      style={{
        background: "var(--surface)",
        boxShadow: "var(--shadow-xs)",
      }}
    >
      <div className="flex items-center justify-between">
        <div className="fp-eyebrow">{RELATED_IMAGES_LABEL}</div>
        {state.ranAt ? (
          <span
            className="text-[10px]"
            style={{ color: "var(--fg-subtle)" }}
            title={new Date(state.ranAt).toLocaleString()}
          >
            {relativeTime(Date.now() - state.ranAt)}
          </span>
        ) : null}
      </div>

      <p
        className="mt-2 text-[11.5px] leading-snug"
        style={{ color: "var(--fg-muted)" }}
      >
        {state.results.length === 0
          ? "Searches Openverse for licensed photographs that match the draft."
          : `${state.results.length} licensed image${state.results.length === 1 ? "" : "s"} found.`}
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={handleRun}
          disabled={isRunning || isLoading}
          className="rounded-full px-3 py-1.5 text-[12px]"
          style={{
            background: isRunning || isLoading ? "var(--bg-subtle)" : "var(--fg)",
            color: isRunning || isLoading ? "var(--fg-muted)" : "var(--surface)",
            cursor: isRunning ? "wait" : isLoading ? "default" : "pointer",
          }}
        >
          {isRunning
            ? "Searching…"
            : isLoading
              ? "Loading…"
              : state.results.length > 0
                ? "Search again"
                : "Find images"}
        </button>
        <button
          type="button"
          onClick={() =>
            setState((s) => ({ ...s, settingsOpen: !s.settingsOpen }))
          }
          className="text-[11px]"
          style={{ color: "var(--fg-subtle)" }}
        >
          {state.settingsOpen ? "Hide licenses" : "License filter"}
        </button>
        {state.results.length > 0 && !isRunning ? (
          <button
            type="button"
            onClick={handleClear}
            className="text-[11px]"
            style={{ color: "var(--fg-subtle)" }}
          >
            Clear
          </button>
        ) : null}
      </div>

      {state.settingsOpen ? (
        <div
          className="mt-3 rounded-xl p-3"
          style={{
            background: "var(--bg-subtle)",
            border: "1px solid var(--border)",
          }}
        >
          <div
            className="text-[10.5px] uppercase tracking-wider"
            style={{ color: "var(--fg-subtle)" }}
          >
            Licenses to include
          </div>
          <p
            className="mt-1 text-[11px] leading-snug"
            style={{ color: "var(--fg-muted)" }}
          >
            Defaults to commercial-use-OK licenses. Toggle others on if your
            blog allows non-commercial reuse.
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {LICENSE_CODES.map((code) => {
              const enabled = state.licenseFilter.includes(code);
              return (
                <button
                  key={code}
                  type="button"
                  onClick={() => toggleLicense(code)}
                  title={LICENSE_DESCRIPTIONS[code]}
                  className="rounded-full px-2.5 py-1 text-[11px]"
                  style={{
                    background: enabled ? "var(--fg)" : "var(--surface)",
                    color: enabled ? "var(--surface)" : "var(--fg-muted)",
                    border: enabled
                      ? "1px solid var(--fg)"
                      : "1px solid var(--border)",
                  }}
                >
                  {enabled ? "✓ " : ""}
                  {LICENSE_LABELS[code]}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {state.error ? (
        <p
          className="mt-3 rounded-lg p-2 text-[11.5px] leading-snug"
          style={{ background: "var(--rose-tint)", color: "#9C4A22" }}
        >
          {state.error}
        </p>
      ) : null}

      {state.results.length > 0 ? (
        <ul className="mt-4 grid grid-cols-2 gap-2">
          {state.results.map((img) => {
            const copied = state.copiedId === img.id;
            return (
              <li
                key={img.id}
                className="overflow-hidden rounded-xl"
                style={{
                  background: "var(--surface)",
                  border: "1px solid var(--border)",
                }}
              >
                <a
                  href={img.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="block"
                  title={img.title ?? "Open source"}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={img.thumbnailUrl}
                    alt={img.title ?? ""}
                    loading="lazy"
                    className="block h-24 w-full object-cover"
                    style={{ background: "var(--bg-subtle)" }}
                  />
                </a>
                <div className="p-2">
                  <div
                    className="line-clamp-1 text-[11.5px]"
                    style={{ color: "var(--fg)" }}
                  >
                    {img.title ?? "Untitled"}
                  </div>
                  <div
                    className="mt-0.5 line-clamp-1 text-[10.5px]"
                    style={{ color: "var(--fg-subtle)" }}
                  >
                    {img.creator ? `by ${img.creator}` : "by unknown"}
                    {img.sourceProvider ? ` · ${img.sourceProvider}` : ""}
                  </div>
                  <div className="mt-1.5 flex items-center justify-between gap-1">
                    <a
                      href={img.licenseUrl ?? img.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-full px-1.5 py-0.5 text-[10px] uppercase tracking-wider"
                      style={{
                        background: "var(--bg-subtle)",
                        color: "var(--fg-muted)",
                        border: "1px solid var(--border)",
                      }}
                      title={LICENSE_DESCRIPTIONS[img.licenseCode]}
                    >
                      {LICENSE_LABELS[img.licenseCode]}
                    </a>
                    <button
                      type="button"
                      onClick={() => handleCopy(img)}
                      className="text-[11px]"
                      style={{
                        color: copied ? "var(--emerald)" : "var(--fg-subtle)",
                      }}
                    >
                      {copied ? "✓ copied" : "Copy URL"}
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

export const relatedImagesClientEntry: ClientExtensionEntry = {
  id: RELATED_IMAGES_ID,
  label: RELATED_IMAGES_LABEL,
  Panel: RelatedImagesPanel,
};

function relativeTime(diffMs: number): string {
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}
