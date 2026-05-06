import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  _resetLookupForTests,
  _resetPinnedFetchForTests,
  _setLookupForTests,
  _setPinnedFetchForTests,
  safeFetchText,
} from "../safe-fetch";

beforeEach(() => {
  _setLookupForTests(async () => [{ address: "8.8.8.8", family: 4 }]);
});

afterEach(() => {
  _resetLookupForTests();
  _resetPinnedFetchForTests();
  vi.unstubAllGlobals();
});

describe("safeFetch", () => {
  it("blocks direct private IPv4 targets", async () => {
    const fetchMock = vi.fn(async () => new Response("nope"));
    _setPinnedFetchForTests(fetchMock);

    await expect(safeFetchText("http://10.0.0.1/feed")).rejects.toMatchObject({
      code: "blocked_ip",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("blocks localhost targets", async () => {
    const fetchMock = vi.fn(async () => new Response("nope"));
    _setPinnedFetchForTests(fetchMock);

    await expect(safeFetchText("http://localhost:3000/feed")).rejects.toMatchObject({
      code: "blocked_hostname",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("blocks redirects to private targets before following them", async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(null, {
        status: 302,
        headers: { location: "http://127.0.0.1/admin" },
      });
    });
    _setPinnedFetchForTests(fetchMock);

    await expect(safeFetchText("https://example.com/feed")).rejects.toMatchObject({
      code: "blocked_ip",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("allows public HTTP URLs with public DNS answers", async () => {
    const fetchMock = vi.fn(async () => new Response("ok", { status: 200 }));
    _setPinnedFetchForTests(fetchMock);

    await expect(safeFetchText("https://example.com/feed")).resolves.toMatchObject({
      text: "ok",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.objectContaining({ address: "8.8.8.8", servername: "example.com" }),
      expect.objectContaining({ redirect: "manual" }),
    );
  });

  it("times out stalled response bodies", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            pull() {
              // Leave the body open without yielding bytes.
              return new Promise(() => undefined);
            },
          }),
          { status: 200 },
        ),
    );
    _setPinnedFetchForTests(fetchMock);

    await expect(safeFetchText("https://example.com/feed", { timeoutMs: 20 })).rejects.toMatchObject(
      {
        code: "aborted",
      },
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("strips sensitive headers on cross-origin POST redirects", async () => {
    let redirectedHeaders: Headers | undefined;
    const fetchMock = vi.fn(async (_target, init: RequestInit) => {
      if (fetchMock.mock.calls.length === 1) {
        return new Response(null, {
          status: 303,
          headers: { location: "https://other.example/done" },
        });
      }
      redirectedHeaders = new Headers(init.headers);
      return new Response("ok", { status: 200 });
    });
    _setPinnedFetchForTests(fetchMock);

    await expect(
      safeFetchText("https://example.com/post", {
        method: "POST",
        headers: {
          authorization: "Bearer secret",
          cookie: "session=secret",
          "content-type": "application/json",
        },
        body: JSON.stringify({ ok: true }),
      }),
    ).resolves.toMatchObject({ text: "ok" });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]![1]).toMatchObject({ method: "GET", body: undefined });
    expect(redirectedHeaders).toBeDefined();
    const headers = redirectedHeaders as Headers;
    expect(headers.has("authorization")).toBe(false);
    expect(headers.has("cookie")).toBe(false);
    expect(headers.has("content-type")).toBe(false);
  });
});
