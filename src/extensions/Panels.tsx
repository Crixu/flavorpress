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
  enabledExtensionIds: string[];
}

export function ExtensionsPanels({
  draftId,
  initialAnnotationsByExt,
  enabledExtensionIds,
}: Props) {
  for (const [extId, payload] of Object.entries(initialAnnotationsByExt)) {
    hydrateSlice(draftId, extId, payload.annotations, payload.ranAt);
  }
  const enabled = new Set(enabledExtensionIds);
  return (
    <>
      {CLIENT_EXTENSIONS.filter((ext) => enabled.has(ext.id)).map((ext) => (
        <ext.Panel key={ext.id} draftId={draftId} />
      ))}
    </>
  );
}
