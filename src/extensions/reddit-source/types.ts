/**
 * Reddit source extension. Owns the connector, the source-add resolver,
 * and the per-site engagement thresholds (minimum upvotes / minimum
 * comments) that filter the inbound stream before items reach the
 * cluster engine.
 *
 * Files in this folder:
 *   - types.ts     constants + label strings (server-safe; no I/O imports)
 *   - connector.ts the JSON-listing fetch + parse pipeline
 *   - server.ts    the SourceExtensionEntry and settings loaders
 *   - index.ts     re-exports for the registries
 *   - __tests__/   pure-function tests for the resolver and parser
 */

export const REDDIT_SOURCE_ID = "reddit-source";
export const REDDIT_SOURCE_LABEL = "Reddit sources";
export const REDDIT_SOURCE_DESCRIPTION =
  "Lets you add a subreddit as a source. Polls the subreddit's JSON listing and shows score plus comment count at swipe time. Engagement thresholds below filter low-signal posts before they reach the reader.";

export const REDDIT_MIN_SCORE_KEY = "reddit_min_score";
export const REDDIT_MIN_SCORE_ENV = "REDDIT_MIN_SCORE";
export const REDDIT_MIN_COMMENTS_KEY = "reddit_min_comments";
export const REDDIT_MIN_COMMENTS_ENV = "REDDIT_MIN_COMMENTS";

export const REDDIT_MIN_SCORE_TITLE = "Reddit minimum upvotes";
export const REDDIT_MIN_SCORE_HINT =
  "Drop subreddit posts with fewer upvotes than this. Leave blank to keep every post; existing items already in the database are not deleted.";
export const REDDIT_MIN_SCORE_PLACEHOLDER = "100";
export const REDDIT_MIN_SCORE_SAVE_LABEL = "Save upvote threshold";

export const REDDIT_MIN_COMMENTS_TITLE = "Reddit minimum comments";
export const REDDIT_MIN_COMMENTS_HINT =
  "Drop subreddit posts with fewer comments than this. Leave blank to keep every post; existing items already in the database are not deleted.";
export const REDDIT_MIN_COMMENTS_PLACEHOLDER = "10";
export const REDDIT_MIN_COMMENTS_SAVE_LABEL = "Save comment threshold";

export const ERR_REDDIT_THRESHOLD_INVALID = "reddit_threshold_invalid";

export const REDDIT_THRESHOLD_ERROR_MESSAGES: Record<string, string> = {
  [ERR_REDDIT_THRESHOLD_INVALID]:
    "Reddit thresholds must be whole numbers (0 or higher). Nothing was saved.",
};
