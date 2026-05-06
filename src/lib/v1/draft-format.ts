/**
 * Client-safe draft format constants. The full draft generator lives in
 * `draft-generator.ts` (server-only by import chain); this file holds only
 * the format archetype list so client components like DraftWizardModal can
 * import without pulling in libSQL or node:fs.
 */

export const DRAFT_FORMATS = [
  "narrative",
  "listicle",
  "news-brief",
  "opinion",
  "qa",
] as const;
export type DraftFormat = (typeof DRAFT_FORMATS)[number];

export const DEFAULT_DRAFT_FORMAT: DraftFormat = "narrative";

export function isDraftFormat(value: unknown): value is DraftFormat {
  return typeof value === "string" && (DRAFT_FORMATS as readonly string[]).includes(value);
}
