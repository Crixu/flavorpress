/**
 * Server-safe metadata for every editor extension. Imported by the
 * settings page and the toggle server action, both of which need to
 * read ids, labels, and descriptions across the RSC boundary.
 *
 * `client.ts` re-exports its entries through "use client" modules, so
 * the live Panel references can't be inspected from a server component.
 * This list duplicates the human-readable metadata once so that adding
 * a new extension requires updating two arrays (registry + client).
 */

import { FACT_CHECK_ID, FACT_CHECK_LABEL } from "./fact-check/types";
import { RELATED_IMAGES_ID, RELATED_IMAGES_LABEL } from "./related-images/types";

export interface ExtensionMetadata {
  id: string;
  label: string;
  description: string;
}

export const EXTENSION_METADATA: ExtensionMetadata[] = [
  {
    id: FACT_CHECK_ID,
    label: FACT_CHECK_LABEL,
    description:
      "Pulls factual claims from the draft and tags each one supported, disputed, or unverified with a source link.",
  },
  {
    id: RELATED_IMAGES_ID,
    label: RELATED_IMAGES_LABEL,
    description:
      "Searches Openverse for openly-licensed photos and illustrations the writer can drop into the draft, filtered by license.",
  },
];

export function findExtensionMetadata(id: string): ExtensionMetadata | undefined {
  return EXTENSION_METADATA.find((ext) => ext.id === id);
}
