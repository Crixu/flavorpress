/**
 * Barrel for the x-source extension. Mirrors the shape used by
 * `related-images/index.ts`. Server-only consumers import from
 * `./server` directly; this file exists so the metadata in
 * `extensions/registry.ts` can pick up id + label without crossing
 * the server boundary.
 */

export { X_SOURCE_ID, X_SOURCE_LABEL, X_SOURCE_DESCRIPTION } from "./types";
