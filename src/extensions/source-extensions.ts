import "server-only";

/**
 * Canonical list of source extensions. Imported by `addSourceAction`
 * to dispatch user-pasted inputs to the right resolver, and by the
 * settings page to render extension-owned settings forms.
 *
 * Adding a new source extension:
 *   1. Copy `src/extensions/x-source/` to `src/extensions/<your-id>/`.
 *   2. Implement claims() + resolve() + (optional) settings fields.
 *   3. Add the export here and a metadata row in `registry.ts`.
 *   4. Update `SourceKind` in `src/lib/v1/types.ts` if the extension
 *      needs a new kind label.
 *
 * The dispatcher iterates this list in order; the first extension
 * whose `claims()` returns true wins. Disabled extensions still get a
 * chance to claim so the dispatcher can throw a "support is disabled"
 * error instead of silently falling through to the RSS fallback.
 */

import type { SourceExtensionEntry } from "./types";
import { redditSourceExtension } from "./reddit-source/server";
import { xSourceExtension } from "./x-source/server";

export const SOURCE_EXTENSIONS: SourceExtensionEntry[] = [xSourceExtension, redditSourceExtension];

export function findClaimingSourceExtension(input: string): SourceExtensionEntry | null {
  for (const ext of SOURCE_EXTENSIONS) {
    if (ext.claims(input)) return ext;
  }
  return null;
}
