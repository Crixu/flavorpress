import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  issueWpcomState,
  resetWpcomStateCacheForTests,
  WPCOM_OAUTH_STATE_COOKIE,
} from "@/lib/wpcom-oauth";

const mocks = vi.hoisted(() => ({
  cookieJar: new Map<string, string>(),
  requireSession: vi.fn(),
  getOrigin: vi.fn(),
  commitOutletWpcomOAuthCredentials: vi.fn(),
  getOutlet: vi.fn(),
  recordOutletError: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (n: string) => {
      const v = mocks.cookieJar.get(n);
      return v ? { value: v } : undefined;
    },
    set: (n: string, v: string) => {
      mocks.cookieJar.set(n, v);
    },
  }),
}));

vi.mock("@/lib/session", () => ({
  AuthRequiredError: class AuthRequiredError extends Error {},
  requireSession: mocks.requireSession,
}));

vi.mock("@/lib/v1/origin", () => ({
  getOrigin: mocks.getOrigin,
}));

vi.mock("@/lib/v1/outlets", () => ({
  commitOutletWpcomOAuthCredentials: mocks.commitOutletWpcomOAuthCredentials,
  getOutlet: mocks.getOutlet,
  recordOutletError: mocks.recordOutletError,
}));

import { GET } from "./route";

const fetchMock = vi.fn();

beforeEach(async () => {
  mocks.cookieJar.clear();
  for (const mock of [
    mocks.requireSession,
    mocks.getOrigin,
    mocks.commitOutletWpcomOAuthCredentials,
    mocks.getOutlet,
    mocks.recordOutletError,
  ]) {
    mock.mockReset();
  }
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  process.env.FLAVORPRESS_SESSION_SECRET = "test-secret-that-is-at-least-32-bytes-long!!";
  process.env.WPCOM_OAUTH_CLIENT_ID = "test-client";
  process.env.WPCOM_OAUTH_CLIENT_SECRET = "test-secret";
  mocks.requireSession.mockResolvedValue({ userId: "u1" });
  mocks.getOrigin.mockResolvedValue("http://localhost:3000");
  mocks.commitOutletWpcomOAuthCredentials.mockResolvedValue(undefined);
  mocks.getOutlet.mockResolvedValue({ wpcomExpectedBlogId: "123" });
  mocks.recordOutletError.mockResolvedValue(undefined);
  await resetWpcomStateCacheForTests();
});

function locationOf(response: Response): string | null {
  return response.headers.get("location");
}

async function call(state: string, code = "fake-code"): Promise<Response> {
  const url = `http://localhost:3000/api/wpcom/outlet-callback?state=${encodeURIComponent(
    state,
  )}&code=${encodeURIComponent(code)}`;
  return GET(new Request(url));
}

async function outletState(nonce: string): Promise<string> {
  return issueWpcomState({
    nonce,
    mode: "outlet",
    userId: "u1",
    outletId: "outlet-1",
    expectedSiteUrl: "https://blog.example",
  });
}

function mockWpcomSiteFlow() {
  fetchMock
    .mockImplementationOnce(async (url: string) => {
      if (url.startsWith("https://public-api.wordpress.com/oauth2/token")) {
        return new Response(
          JSON.stringify({
            access_token: "site-token",
            blog_id: "123",
            expires_in: 3600,
            refresh_token: "refresh-token",
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      }
      throw new Error(`Unexpected fetch: ${url}`);
    })
    .mockImplementationOnce(async (url: string) => {
      if (url.startsWith("https://public-api.wordpress.com/rest/v1.1/me")) {
        return new Response(JSON.stringify({ username: "author" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    })
    .mockImplementationOnce(async (url: string) => {
      if (url.startsWith("https://public-api.wordpress.com/rest/v1.1/sites/123")) {
        return new Response(
          JSON.stringify({
            ID: 123,
            URL: "https://blog.example",
            name: "Blog",
            jetpack: false,
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
}

describe("WP.com outlet callback state cookie", () => {
  it("rejects a valid state without the per-browser nonce cookie", async () => {
    const state = await outletState("n_outlet_missing_cookie");
    const response = await call(state);
    expect(locationOf(response)).toBe("http://localhost:3000/voice?wp_error=oauth_state");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.commitOutletWpcomOAuthCredentials).not.toHaveBeenCalled();
  });

  it("rejects a valid state with a mismatched nonce cookie", async () => {
    const state = await outletState("n_outlet_state");
    mocks.cookieJar.set(WPCOM_OAUTH_STATE_COOKIE, "n_other_browser");
    const response = await call(state);
    expect(locationOf(response)).toBe("http://localhost:3000/voice?wp_error=oauth_state");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.commitOutletWpcomOAuthCredentials).not.toHaveBeenCalled();
  });

  it("commits credentials when the state nonce matches the cookie", async () => {
    const state = await outletState("n_outlet_ok");
    mocks.cookieJar.set(WPCOM_OAUTH_STATE_COOKIE, "n_outlet_ok");
    mockWpcomSiteFlow();

    const response = await call(state);

    expect(locationOf(response)).toBe("http://localhost:3000/voice?wp_connected=outlet-1");
    expect(mocks.commitOutletWpcomOAuthCredentials).toHaveBeenCalledWith({
      outletId: "outlet-1",
      accessToken: "site-token",
      siteId: "123",
      siteUrl: "https://blog.example",
      siteName: "Blog",
      username: "author",
      kind: "wp-com",
      expiresAt: expect.any(Number),
      refreshToken: "refresh-token",
    });
    expect(mocks.cookieJar.get(WPCOM_OAUTH_STATE_COOKIE)).toBe("");
  });
});
