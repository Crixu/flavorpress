/**
 * Extension contract for the editor surface.
 *
 * An extension is a packaged inspector for the draft (fact-check,
 * originality, plagiarism, citation-finder, ...). Every extension
 * implements a server half and a client half:
 *
 *   - Server half (ServerExtensionEntry) lives in a server-only module.
 *     It knows how to load persisted annotations for a draft so the
 *     editor page can hydrate the client store on first paint.
 *   - Client half (ClientExtensionEntry) lives in a "use client" module.
 *     It owns its right-rail Panel and reads/writes its slice of the
 *     shared store. The Panel is bespoke per extension; only the
 *     annotation contract below is shared.
 *
 * The article overlay (`extensions/Article.tsx`) walks every extension's
 * annotations and wraps the matching draft text in a `<mark>` element
 * tagged with `data-fp-ext` and `data-fp-ann`. Click handling uses those
 * attributes to scroll the matching Panel comment into view via
 * `data-fp-comment="<extId>:<annId>"`.
 */

import type { ComponentType } from "react";

export type AnnotationTone = "positive" | "negative" | "neutral";

/**
 * Per-span annotation surfaced into the editor by an extension. The
 * extension converts its own internal rows (e.g. fact-check claims)
 * into this shape so the article overlay can stay extension-agnostic.
 */
export interface ExtensionAnnotation {
  /** Stable id from the extension's persisted row. */
  id: string;
  /** 1-based ordering inside the extension. Drives card numbering. */
  index: number;
  /** Verbatim substring of the draft body to highlight. */
  spanText: string;
  /** Drives mark color. positive=mint, negative=peach, neutral=amber. */
  tone: AnnotationTone;
  /** Eyebrow header for the comment card (e.g. "Claim 2 · Disputed"). */
  title: string;
  /** Free-text comment body. */
  body: string;
  /** Optional source link rendered at the foot of the comment card. */
  linkUrl: string | null;
  linkTitle: string | null;
}

export interface ExtensionPanelProps {
  draftId: string;
}

export interface AnnotationLoad {
  annotations: ExtensionAnnotation[];
  /** Epoch ms of the last successful run, or null if never run. */
  ranAt: number | null;
}

/**
 * Server-only extension entry. SERVER_EXTENSIONS in
 * `src/extensions/server.ts` is the canonical list for editor
 * page hydration.
 */
export interface ServerExtensionEntry {
  id: string;
  loadAnnotations(draftId: string): Promise<AnnotationLoad>;
}

/**
 * Client-only extension entry. CLIENT_EXTENSIONS in
 * `src/extensions/client.ts` is the canonical list the right-rail host
 * iterates over.
 */
export interface ClientExtensionEntry {
  id: string;
  /** Human-readable label, used inside the Panel's eyebrow. */
  label: string;
  Panel: ComponentType<ExtensionPanelProps>;
}

export type InitialAnnotationsByExtension = Record<string, AnnotationLoad>;
