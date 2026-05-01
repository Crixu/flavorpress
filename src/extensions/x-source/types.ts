/**
 * Reference source-extension. Use this folder as a copy-paste template
 * for new source extensions (Bluesky, Mastodon, newsletter forwarders,
 * etc.). The contract this implements lives in `src/extensions/types.ts`.
 *
 * Files in this folder:
 *   - types.ts   constants + label strings (server-safe; no I/O imports)
 *   - server.ts  the SourceExtensionEntry implementation + helpers
 *   - index.ts   re-export the entry for the SOURCE_EXTENSIONS registry
 *   - __tests__/ pure-function tests for the resolver
 *
 * Constraints worth keeping when copying:
 *   - The setting key string is owned here, not in `lib/v1/settings.ts`.
 *   - Validation errors return short codes; their messages live in
 *     `errorMessages` so the settings page renders them generically.
 *   - `claims()` is pure and does no I/O. `resolve()` may read settings.
 */

export const X_SOURCE_ID = "x-source";
export const X_SOURCE_LABEL = "X (Twitter) sources";

export const X_BRIDGE_TEMPLATE_KEY = "x_bridge_template";
export const X_BRIDGE_TEMPLATE_ENV = "X_BRIDGE_TEMPLATE";

export const X_SOURCE_DESCRIPTION =
  "Lets you add an X handle as a source. X read access is paywalled, so this extension polls a public RSS bridge (xcancel.com or any Nitter instance you trust) configured on this page.";

export const X_BRIDGE_TEMPLATE_TITLE = "X (Twitter) RSS bridge template";
export const X_BRIDGE_TEMPLATE_HINT =
  "X read access requires a bridge that turns a handle into an RSS feed. Paste a URL with {handle} as the placeholder; FlavorPress substitutes it when you add an X source. xcancel.com is currently one of the more durable public Nitter mirrors (try https://xcancel.com/{handle}/rss); expect to swap this when an instance goes down. Leave blank to disable adding X sources.";
export const X_BRIDGE_TEMPLATE_PLACEHOLDER = "https://xcancel.com/{handle}/rss";
export const X_BRIDGE_TEMPLATE_SAVE_LABEL = "Save template";

export const ERR_TEMPLATE_INVALID = "x_bridge_template_invalid";
export const ERR_TEMPLATE_MISSING = "x_bridge_template_missing";
export const ERR_TEMPLATE_NO_PLACEHOLDER = "x_bridge_template_no_placeholder";

export const X_BRIDGE_TEMPLATE_ERROR_MESSAGES: Record<string, string> = {
  [ERR_TEMPLATE_INVALID]:
    "Bridge template must be an http(s):// URL containing {handle}. Nothing was saved.",
};
