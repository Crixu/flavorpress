/**
 * Canonical list of editor extensions, client half. Imported by
 * `src/extensions/Panels.tsx` to render the right-rail cards.
 *
 * Adding a new extension: write its Panel component under
 * `src/extensions/<id>/Panel.tsx`, export a ClientExtensionEntry from
 * `src/extensions/<id>/index.ts`, and add it to this array.
 */

import type { ClientExtensionEntry } from "./types";
import { factCheckClientEntry } from "./fact-check";
import { relatedImagesClientEntry } from "./related-images";

export const CLIENT_EXTENSIONS: ClientExtensionEntry[] = [
  factCheckClientEntry,
  relatedImagesClientEntry,
];
