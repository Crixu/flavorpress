import "server-only";

/**
 * reddit-source extension: server half.
 *
 * Claims subreddit URLs on the source-add path, owns the JSON connector
 * (re-exported from `./connector`), and registers the engagement
 * thresholds the user can tune in /settings.
 *
 * Acceptable inputs:
 *   https://www.reddit.com/r/<sub>/
 *   https://www.reddit.com/r/<sub>/.rss
 *   https://www.reddit.com/r/<sub>/new/
 *   https://www.reddit.com/r/<sub>.json
 *   https://<subdomain>.reddit.com/r/<sub>/
 */

import { getSetting } from "@/lib/v1/settings";
import type { ExtensionSettingField, ResolvedSource, SourceExtensionEntry } from "../types";
import {
  ERR_REDDIT_THRESHOLD_INVALID,
  REDDIT_MIN_COMMENTS_ENV,
  REDDIT_MIN_COMMENTS_HINT,
  REDDIT_MIN_COMMENTS_KEY,
  REDDIT_MIN_COMMENTS_PLACEHOLDER,
  REDDIT_MIN_COMMENTS_SAVE_LABEL,
  REDDIT_MIN_COMMENTS_TITLE,
  REDDIT_MIN_SCORE_ENV,
  REDDIT_MIN_SCORE_HINT,
  REDDIT_MIN_SCORE_KEY,
  REDDIT_MIN_SCORE_PLACEHOLDER,
  REDDIT_MIN_SCORE_SAVE_LABEL,
  REDDIT_MIN_SCORE_TITLE,
  REDDIT_SOURCE_ID,
  REDDIT_SOURCE_LABEL,
  REDDIT_THRESHOLD_ERROR_MESSAGES,
} from "./types";
import type { RedditEngagementThresholds } from "./connector";

export { redditConnector } from "./connector";

export function isRedditUrl(input: string): boolean {
  const trimmed = input.trim();
  if (!trimmed) return false;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return false;
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (host !== "reddit.com" && !host.endsWith(".reddit.com")) return false;
  return url.pathname.startsWith("/r/") || url.pathname.startsWith("/.rss");
}

export function extractSubredditName(input: string): string | null {
  try {
    const u = new URL(input);
    const seg = u.pathname.split("/").filter(Boolean);
    if (seg[0]?.toLowerCase() === "r" && seg[1]) return seg[1];
  } catch {
    return null;
  }
  return null;
}

function parseThreshold(raw: string | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) return null;
  return n;
}

export async function getRedditEngagementThresholds(): Promise<RedditEngagementThresholds> {
  const [scoreDb, commentsDb] = await Promise.all([
    getSetting(REDDIT_MIN_SCORE_KEY),
    getSetting(REDDIT_MIN_COMMENTS_KEY),
  ]);
  const minScore =
    parseThreshold(scoreDb) ?? parseThreshold(process.env[REDDIT_MIN_SCORE_ENV] ?? null);
  const minComments =
    parseThreshold(commentsDb) ?? parseThreshold(process.env[REDDIT_MIN_COMMENTS_ENV] ?? null);
  return { minScore, minComments };
}

function validateThreshold(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
    return ERR_REDDIT_THRESHOLD_INVALID;
  }
  return null;
}

const minScoreField: ExtensionSettingField = {
  key: REDDIT_MIN_SCORE_KEY,
  envVar: REDDIT_MIN_SCORE_ENV,
  title: REDDIT_MIN_SCORE_TITLE,
  hint: REDDIT_MIN_SCORE_HINT,
  placeholder: REDDIT_MIN_SCORE_PLACEHOLDER,
  saveLabel: REDDIT_MIN_SCORE_SAVE_LABEL,
  inputType: "text",
  validate: validateThreshold,
  errorMessages: REDDIT_THRESHOLD_ERROR_MESSAGES,
};

const minCommentsField: ExtensionSettingField = {
  key: REDDIT_MIN_COMMENTS_KEY,
  envVar: REDDIT_MIN_COMMENTS_ENV,
  title: REDDIT_MIN_COMMENTS_TITLE,
  hint: REDDIT_MIN_COMMENTS_HINT,
  placeholder: REDDIT_MIN_COMMENTS_PLACEHOLDER,
  saveLabel: REDDIT_MIN_COMMENTS_SAVE_LABEL,
  inputType: "text",
  validate: validateThreshold,
  errorMessages: REDDIT_THRESHOLD_ERROR_MESSAGES,
};

export const redditSourceExtension: SourceExtensionEntry = {
  id: REDDIT_SOURCE_ID,
  label: REDDIT_SOURCE_LABEL,
  kind: "reddit",

  claims(input: string): boolean {
    return isRedditUrl(input);
  },

  async resolve(input: string): Promise<ResolvedSource> {
    const trimmed = input.trim();
    if (!isRedditUrl(trimmed)) {
      throw new Error(`reddit-source: refused to resolve non-reddit input: ${input}`);
    }
    const sub = extractSubredditName(trimmed);
    return {
      url: trimmed,
      displayName: sub ? `r/${sub}` : trimmed,
    };
  },

  settings: [minScoreField, minCommentsField],
};
