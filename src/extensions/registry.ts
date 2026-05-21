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

import {
  COMMENT_COURTROOM_DESCRIPTION,
  COMMENT_COURTROOM_ID,
  COMMENT_COURTROOM_LABEL,
} from "./comment-courtroom/types";
import { FACT_CHECK_ID, FACT_CHECK_LABEL } from "./fact-check/types";
import {
  REDDIT_SOURCE_DESCRIPTION,
  REDDIT_SOURCE_ID,
  REDDIT_SOURCE_LABEL,
} from "./reddit-source/types";
import { RELATED_IMAGES_ID, RELATED_IMAGES_LABEL } from "./related-images/types";
import {
  WORKFLOW_AUTOPUBLISH_DESCRIPTION,
  WORKFLOW_AUTOPUBLISH_ID,
  WORKFLOW_AUTOPUBLISH_LABEL,
} from "./workflow-autopublish/types";
import { X_SOURCE_DESCRIPTION, X_SOURCE_ID, X_SOURCE_LABEL } from "./x-source/types";

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
  {
    id: X_SOURCE_ID,
    label: X_SOURCE_LABEL,
    description: X_SOURCE_DESCRIPTION,
  },
  {
    id: REDDIT_SOURCE_ID,
    label: REDDIT_SOURCE_LABEL,
    description: REDDIT_SOURCE_DESCRIPTION,
  },
  {
    id: COMMENT_COURTROOM_ID,
    label: COMMENT_COURTROOM_LABEL,
    description: COMMENT_COURTROOM_DESCRIPTION,
  },
  {
    id: WORKFLOW_AUTOPUBLISH_ID,
    label: WORKFLOW_AUTOPUBLISH_LABEL,
    description: WORKFLOW_AUTOPUBLISH_DESCRIPTION,
  },
];

export function findExtensionMetadata(id: string): ExtensionMetadata | undefined {
  return EXTENSION_METADATA.find((ext) => ext.id === id);
}
