import { beforeEach, describe, expect, it, vi } from "vitest";

const { getSettingMock } = vi.hoisted(() => ({
  getSettingMock: vi.fn(),
}));

vi.mock("@/lib/v1/settings", () => ({
  getSetting: getSettingMock,
}));

import { applyEngagementThresholds, parseListing, toJsonListingUrl } from "../connector";
import {
  extractSubredditName,
  getRedditEngagementThresholds,
  isRedditUrl,
  redditSourceExtension,
} from "../server";
import type { RawItem } from "@/lib/v1/source-connector";

const USER_ID = "user_a";

beforeEach(() => {
  getSettingMock.mockReset();
  delete process.env.REDDIT_MIN_SCORE;
  delete process.env.REDDIT_MIN_COMMENTS;
});

describe("toJsonListingUrl", () => {
  it("converts a bare subreddit URL", () => {
    expect(toJsonListingUrl("https://www.reddit.com/r/science/")).toBe(
      "https://www.reddit.com/r/science.json",
    );
  });

  it("strips a trailing .rss before appending .json", () => {
    expect(toJsonListingUrl("https://www.reddit.com/r/science/.rss")).toBe(
      "https://www.reddit.com/r/science.json",
    );
  });

  it("preserves a sort segment like /new/", () => {
    expect(toJsonListingUrl("https://www.reddit.com/r/science/new/")).toBe(
      "https://www.reddit.com/r/science/new.json",
    );
  });

  it("leaves a .json URL unchanged", () => {
    expect(toJsonListingUrl("https://www.reddit.com/r/science.json")).toBe(
      "https://www.reddit.com/r/science.json",
    );
  });
});

describe("parseListing", () => {
  it("extracts score and num_comments per child", () => {
    const items = parseListing({
      data: {
        children: [
          {
            kind: "t3",
            data: {
              id: "abc",
              name: "t3_abc",
              title: "Hello world",
              permalink: "/r/foo/comments/abc/hello/",
              selftext: "body text",
              author: "user1",
              created_utc: 1_700_000_000,
              score: 1234,
              num_comments: 56,
            },
          },
        ],
      },
    });
    expect(items).toHaveLength(1);
    const item = items[0]!;
    expect(item.title).toBe("Hello world");
    expect(item.url).toBe("https://www.reddit.com/r/foo/comments/abc/hello/");
    expect(item.score).toBe(1234);
    expect(item.commentCount).toBe(56);
    expect(item.authors).toEqual(["user1"]);
    expect(item.publishedAt).toBe(1_700_000_000_000);
  });

  it("falls back to title when selftext is empty", () => {
    const items = parseListing({
      data: {
        children: [
          {
            kind: "t3",
            data: {
              id: "abc",
              title: "Image post",
              permalink: "/r/foo/comments/abc/img/",
              score: 0,
              num_comments: 0,
            },
          },
        ],
      },
    });
    expect(items[0]!.lede).toBe("Image post");
    expect(items[0]!.body).toBeNull();
    expect(items[0]!.score).toBe(0);
    expect(items[0]!.commentCount).toBe(0);
  });

  it("skips non-t3 children and entries missing title or permalink", () => {
    const items = parseListing({
      data: {
        children: [
          { kind: "t1", data: { title: "comment", permalink: "/r/x/y/" } },
          { kind: "t3", data: { permalink: "/r/x/y/" } },
          { kind: "t3", data: { title: "no perma" } },
        ],
      },
    });
    expect(items).toEqual([]);
  });

  it("returns null score/commentCount when fields are missing", () => {
    const items = parseListing({
      data: {
        children: [
          {
            kind: "t3",
            data: {
              id: "abc",
              title: "Old post",
              permalink: "/r/foo/comments/abc/old/",
            },
          },
        ],
      },
    });
    expect(items[0]!.score).toBeNull();
    expect(items[0]!.commentCount).toBeNull();
  });
});

function makeItem(score: number | null, commentCount: number | null): RawItem {
  return {
    externalId: `id-${score}-${commentCount}`,
    url: "https://www.reddit.com/r/foo/comments/x/y/",
    title: "t",
    lede: "l",
    body: null,
    authors: [],
    publishedAt: 0,
    raw: null,
    score,
    commentCount,
  };
}

describe("applyEngagementThresholds", () => {
  it("returns the input unchanged when both thresholds are null", () => {
    const items = [makeItem(0, 0), makeItem(null, null)];
    expect(applyEngagementThresholds(items, { minScore: null, minComments: null })).toBe(items);
  });

  it("filters posts below the score threshold", () => {
    const items = [makeItem(50, 100), makeItem(101, 100), makeItem(99, 100)];
    const filtered = applyEngagementThresholds(items, { minScore: 100, minComments: null });
    expect(filtered.map((i) => i.score)).toEqual([101]);
  });

  it("filters posts below the comment threshold", () => {
    const items = [makeItem(0, 5), makeItem(0, 10), makeItem(0, 11)];
    const filtered = applyEngagementThresholds(items, { minScore: null, minComments: 10 });
    expect(filtered.map((i) => i.commentCount)).toEqual([10, 11]);
  });

  it("requires both thresholds when both are set", () => {
    const items = [makeItem(100, 5), makeItem(50, 50), makeItem(100, 50)];
    const filtered = applyEngagementThresholds(items, { minScore: 100, minComments: 50 });
    expect(filtered).toHaveLength(1);
    expect(filtered[0]!.score).toBe(100);
    expect(filtered[0]!.commentCount).toBe(50);
  });

  it("drops posts missing a numeric value when that dimension is filtered", () => {
    const items = [makeItem(null, 100), makeItem(100, null)];
    expect(applyEngagementThresholds(items, { minScore: 50, minComments: null })).toHaveLength(1);
    expect(applyEngagementThresholds(items, { minScore: null, minComments: 50 })).toHaveLength(1);
  });
});

describe("isRedditUrl / extractSubredditName", () => {
  it("claims subreddit URLs", () => {
    expect(isRedditUrl("https://www.reddit.com/r/science/")).toBe(true);
    expect(isRedditUrl("https://reddit.com/r/science/.rss")).toBe(true);
    expect(isRedditUrl("https://old.reddit.com/r/science/new/")).toBe(true);
    expect(isRedditUrl("https://new.reddit.com/r/science/")).toBe(true);
    expect(isRedditUrl("https://np.reddit.com/r/science/")).toBe(true);
  });

  it("rejects non-reddit URLs and non-subreddit reddit URLs", () => {
    expect(isRedditUrl("https://example.com/r/science/")).toBe(false);
    expect(isRedditUrl("https://www.reddit.com/user/foo/")).toBe(false);
    expect(isRedditUrl("not a url")).toBe(false);
  });

  it("extracts the subreddit name from a URL", () => {
    expect(extractSubredditName("https://www.reddit.com/r/science/")).toBe("science");
    expect(extractSubredditName("https://www.reddit.com/r/science/new/")).toBe("science");
  });
});

describe("redditSourceExtension contract", () => {
  it("declares the reddit SourceKind", () => {
    expect(redditSourceExtension.kind).toBe("reddit");
  });

  it("registers minimum-upvote and minimum-comment settings", () => {
    const keys = redditSourceExtension.settings?.map((f) => f.key);
    expect(keys).toEqual(["reddit_min_score", "reddit_min_comments"]);
  });

  it("resolves a subreddit URL into r/<sub> as the display name", async () => {
    getSettingMock.mockResolvedValue(null);
    await expect(
      redditSourceExtension.resolve("https://www.reddit.com/r/science/", USER_ID),
    ).resolves.toEqual({
      url: "https://www.reddit.com/r/science/",
      displayName: "r/science",
    });
  });

  it("rejects threshold values that are not whole non-negative integers", () => {
    const field = redditSourceExtension.settings?.find((f) => f.key === "reddit_min_score");
    expect(field?.validate?.("100")).toBeNull();
    expect(field?.validate?.("0")).toBeNull();
    expect(field?.validate?.("")).toBeNull();
    expect(field?.validate?.("  ")).toBeNull();
    expect(field?.validate?.("-1")).toBe("reddit_threshold_invalid");
    expect(field?.validate?.("1.5")).toBe("reddit_threshold_invalid");
    expect(field?.validate?.("abc")).toBe("reddit_threshold_invalid");
  });
});

describe("getRedditEngagementThresholds", () => {
  it("returns null thresholds when no setting and no env var is present", async () => {
    getSettingMock.mockResolvedValue(null);
    await expect(getRedditEngagementThresholds(USER_ID)).resolves.toEqual({
      minScore: null,
      minComments: null,
    });
  });

  it("prefers DB settings over environment variables", async () => {
    getSettingMock.mockImplementation(async (key: string) => {
      if (key === "reddit_min_score") return "100";
      if (key === "reddit_min_comments") return "20";
      return null;
    });
    process.env.REDDIT_MIN_SCORE = "1";
    process.env.REDDIT_MIN_COMMENTS = "1";
    await expect(getRedditEngagementThresholds(USER_ID)).resolves.toEqual({
      minScore: 100,
      minComments: 20,
    });
    expect(getSettingMock).toHaveBeenCalledWith("reddit_min_score", USER_ID);
    expect(getSettingMock).toHaveBeenCalledWith("reddit_min_comments", USER_ID);
  });

  it("falls back to env vars when settings are absent", async () => {
    getSettingMock.mockResolvedValue(null);
    process.env.REDDIT_MIN_SCORE = "5";
    process.env.REDDIT_MIN_COMMENTS = "0";
    await expect(getRedditEngagementThresholds(USER_ID)).resolves.toEqual({
      minScore: 5,
      minComments: 0,
    });
  });

  it("ignores invalid stored values rather than throwing", async () => {
    getSettingMock.mockImplementation(async (key: string) => {
      if (key === "reddit_min_score") return "not-a-number";
      if (key === "reddit_min_comments") return "-3";
      return null;
    });
    await expect(getRedditEngagementThresholds(USER_ID)).resolves.toEqual({
      minScore: null,
      minComments: null,
    });
  });
});
