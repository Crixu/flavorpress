"use client";

/**
 * Renders the right-rail Panel for every registered client extension.
 * Each Panel reads its own slice from `extensions/store`; this host
 * just iterates and seeds slices from server-loaded data.
 */

import { hydrateSlice } from "./store";
import { CLIENT_EXTENSIONS } from "./client";
import type { InitialAnnotationsByExtension } from "./types";

interface Props {
  draftId: string;
  initialAnnotationsByExt: InitialAnnotationsByExtension;
}

export function ExtensionsPanels({
  draftId,
  initialAnnotationsByExt,
}: Props) {
  for (const [extId, payload] of Object.entries(initialAnnotationsByExt)) {
    hydrateSlice(draftId, extId, payload.annotations, payload.ranAt);
  }
  return (
    <>
      {CLIENT_EXTENSIONS.map((ext) => (
        <ext.Panel key={ext.id} draftId={draftId} />
      ))}
    </>
  );
}
