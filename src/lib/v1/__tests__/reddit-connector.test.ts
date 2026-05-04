import { describe, it, expect } from "vitest";
import { parseListing, toJsonListingUrl } from "../connectors/reddit";

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
