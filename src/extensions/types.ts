/**
 * Extension contract.
 *
 * FlavorPress has two kinds of extensions, both gated by the same
 * "Editor extensions" toggle in /settings:
 *
 *   1. Editor extensions: per-draft inspectors that contribute marked
 *      spans + a right-rail Panel (fact-check, related-images, ...).
 *      Server half (ServerExtensionEntry) loads persisted annotations
 *      on first paint; client half (ClientExtensionEntry) renders the
 *      Panel.
 *
 *   2. Source extensions: claim a user-pasted input on the source-add
 *      path and resolve it into the URL FlavorPress should poll. The
 *      x-source extension (under `src/extensions/x-source/`) is the
 *      reference implementation; copy that folder for new ones.
 *
 * The article overlay (`extensions/Article.tsx`) walks every editor
 * extension's annotations and wraps the matching draft text in a
 * `<mark>` element tagged with `data-fp-ext` and `data-fp-ann`. Click
 * handling uses those attributes to scroll the matching Panel comment
 * into view via `data-fp-comment="<extId>:<annId>"`.
 */

import type { ComponentType } from "react";
import type { SourceKind } from "@/lib/v1/types";

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

/**
 * The shape an extension returns when it claims a source input. Stored
 * verbatim on the `sources` row at insert time.
 */
export interface ResolvedSource {
  /** The URL the polling loop fetches. For X this is the bridge URL. */
  url: string;
  /** Display label seeded on the row (suppresses LLM auto-titling). */
  displayName: string;
}

/**
 * One settings field an extension wants the /settings page to render.
 * The page knows how to render `text` and `password` inputs; richer
 * controls require widening this type. Validators live alongside their
 * field so the save action can enforce them without a central registry.
 */
export interface ExtensionSettingField {
  key: string;
  envVar: string;
  title: string;
  hint: string;
  placeholder: string;
  saveLabel: string;
  inputType: "text" | "password";
  /**
   * Returns null when the value is acceptable; an error code string
   * otherwise. The settings UI surfaces the code via the same banner
   * mechanism used for built-in validators.
   */
  validate?(value: string): string | null;
  /**
   * Maps a validator error code to the message the UI should render.
   * Each extension owns its messages so the page doesn't need to
   * special-case them.
   */
  errorMessages?: Record<string, string>;
}

/**
 * Source-extension contract. Implement under `src/extensions/<id>/server.ts`,
 * register in `src/extensions/source-extensions.ts`. See
 * `src/extensions/x-source/server.ts` for the reference implementation.
 */
export interface SourceExtensionEntry {
  id: string;
  label: string;
  /** SourceKind written to `sources.kind` when this extension claims an input. */
  kind: SourceKind;
  /**
   * Pure check: does this extension claim this input? Side-effect-free
   * so the dispatcher can run it on every paste without I/O.
   */
  claims(input: string): boolean;
  /**
   * Resolve a claimed input into the row to insert. Throws with a
   * user-facing message when the extension is misconfigured (missing
   * setting, malformed input). Only called when `claims()` returned true.
   */
  resolve(input: string, userId: string): Promise<ResolvedSource>;
  /** Settings the extension wants on /settings. Empty for none. */
  settings?: ExtensionSettingField[];
}
