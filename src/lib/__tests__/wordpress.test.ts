import { afterEach, describe, expect, it, vi } from "vitest";
import {
  _resetLookupForTests,
  _resetPinnedFetchForTests,
  _setLookupForTests,
  _setPinnedFetchForTests,
} from "../v1/safe-fetch";
import {
  blocksToHtml,
  getOutletPostCount,
  MIN_VOICE_TRAIN_POSTS,
  type WPCredentials,
} from "../wordpress";

const creds: WPCredentials = {
  baseUrl: "https://example.com/",
  username: "author",
  appPassword: "abcd efgh",
};

afterEach(() => {
  _resetLookupForTests();
  _resetPinnedFetchForTests();
});

describe("getOutletPostCount", () => {
  it("uses X-WP-Total when WordPress returns it", async () => {
    _setLookupForTests(async () => [{ address: "8.8.8.8", family: 4 }]);
    const fetchMock = vi.fn(async () => {
      const headers = new Headers();
      headers.set("x-wp-total", "37");
      return new Response("[]", { status: 200, headers });
    });
    _setPinnedFetchForTests(fetchMock);

    await expect(getOutletPostCount(creds)).resolves.toBe(37);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("falls back to enough post IDs to distinguish a trainable archive", async () => {
    _setLookupForTests(async () => [{ address: "8.8.8.8", family: 4 }]);
    let requestedUrl = "";
    _setPinnedFetchForTests(
      vi.fn(async (target) => {
        requestedUrl = target.url.toString();
        return new Response(
          JSON.stringify(Array.from({ length: MIN_VOICE_TRAIN_POSTS }, (_, id) => ({ id }))),
          { status: 200, headers: new Headers() },
        );
      }),
    );

    await expect(getOutletPostCount(creds)).resolves.toBe(MIN_VOICE_TRAIN_POSTS);
    expect(requestedUrl).toContain(`per_page=${MIN_VOICE_TRAIN_POSTS}`);
  });
});

describe("blocksToHtml", () => {
  it("strips block comments and sanitizes pulled HTML", () => {
    const raw =
      '<!-- wp:paragraph --><p onclick="alert(1)">Hello <a href="javascript:alert(1)">bad</a><a href="https://example.com">source</a><script>alert(1)</script></p><!-- /wp:paragraph -->';

    expect(blocksToHtml(raw)).toBe(
      '<p>Hello bad<a href="https://example.com">source</a></p>',
    );
  });
});
