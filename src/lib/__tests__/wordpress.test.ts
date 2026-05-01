import { afterEach, describe, expect, it, vi } from "vitest";
import { getOutletPostCount, MIN_VOICE_TRAIN_POSTS, type WPCredentials } from "../wordpress";

const creds: WPCredentials = {
  baseUrl: "https://example.com/",
  username: "author",
  appPassword: "abcd efgh",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getOutletPostCount", () => {
  it("uses X-WP-Total when WordPress returns it", async () => {
    const json = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        const headers = new Headers();
        headers.set("x-wp-total", "37");
        return { ok: true, status: 200, headers, json } as unknown as Response;
      }),
    );

    await expect(getOutletPostCount(creds)).resolves.toBe(37);
    expect(json).not.toHaveBeenCalled();
  });

  it("falls back to enough post IDs to distinguish a trainable archive", async () => {
    let requestedUrl = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        requestedUrl = url;
        return {
          ok: true,
          status: 200,
          headers: new Headers(),
          json: vi.fn(async () =>
            Array.from({ length: MIN_VOICE_TRAIN_POSTS }, (_, id) => ({ id })),
          ),
        } as unknown as Response;
      }),
    );

    await expect(getOutletPostCount(creds)).resolves.toBe(MIN_VOICE_TRAIN_POSTS);
    expect(requestedUrl).toContain(`per_page=${MIN_VOICE_TRAIN_POSTS}`);
  });
});
