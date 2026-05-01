import "server-only";

/**
 * Canonical list of editor extensions, server half. Imported by the
 * editor page to load persisted annotations on first paint.
 *
 * Adding a new extension: write its server module under
 * `src/extensions/<id>/server.ts` exporting a ServerExtensionEntry,
 * then add it to this array.
 */

import type {
  InitialAnnotationsByExtension,
  ServerExtensionEntry,
} from "./types";
import { factCheckServerEntry } from "./fact-check/server";
import { relatedImagesServerEntry } from "./related-images/server";

export const SERVER_EXTENSIONS: ServerExtensionEntry[] = [
  factCheckServerEntry,
  relatedImagesServerEntry,
];

/**
 * Fan out loadAnnotations() across every registered extension and
 * return the keyed payload the article + panels host expect.
 */
export async function loadAllAnnotations(
  draftId: string,
): Promise<InitialAnnotationsByExtension> {
  const results = await Promise.all(
    SERVER_EXTENSIONS.map(async (ext) => {
      const load = await ext.loadAnnotations(draftId);
      return [ext.id, load] as const;
    }),
  );
  return Object.fromEntries(results);
}
