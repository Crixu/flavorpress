import "server-only";

/**
 * Canonical list of editor extensions, server half. Imported by the
 * editor page to load persisted annotations on first paint.
 *
 * Adding a new extension: write its server module under
 * `src/extensions/<id>/server.ts` exporting a ServerExtensionEntry,
 * then add it to this array.
 */

import type { InitialAnnotationsByExtension, ServerExtensionEntry } from "./types";
import { angleBuilderServerEntry } from "./angle-builder/server";
import { commentCourtroomServerEntry } from "./comment-courtroom/server";
import { evidencePanelServerEntry } from "./evidence-panel/server";
import { factCheckServerEntry } from "./fact-check/server";
import { relatedImagesServerEntry } from "./related-images/server";
import { voiceGuardServerEntry } from "./voice-guard/server";
import { getEffectiveDisabledExtensionIds, getPaidExtensionIds } from "@/lib/v1/settings";
import { getUserPlan } from "@/lib/plans";
import { extensionIdAllowedForPlan } from "./registry";

export const SERVER_EXTENSIONS: ServerExtensionEntry[] = [
  factCheckServerEntry,
  relatedImagesServerEntry,
  commentCourtroomServerEntry,
  angleBuilderServerEntry,
  evidencePanelServerEntry,
  voiceGuardServerEntry,
];

/**
 * Fan out loadAnnotations() across every registered extension and
 * return the keyed payload the article + panels host expect. Extensions
 * the user has disabled in /settings are skipped entirely so the editor
 * never hydrates highlights or panels for them.
 */
export async function loadAllAnnotations(
  draftId: string,
  userId: string,
): Promise<InitialAnnotationsByExtension> {
  const [disabled, plan, paidExtensionIds] = await Promise.all([
    getEffectiveDisabledExtensionIds(userId),
    getUserPlan(userId),
    getPaidExtensionIds(),
  ]);
  const active = SERVER_EXTENSIONS.filter(
    (ext) =>
      !disabled.has(ext.id) && extensionIdAllowedForPlan(ext.id, plan.plan, paidExtensionIds),
  );
  const results = await Promise.all(
    active.map(async (ext) => {
      const load = await ext.loadAnnotations(draftId);
      return [ext.id, load] as const;
    }),
  );
  return Object.fromEntries(results);
}
