import { describe, it, expect, beforeEach } from "vitest";
import {
  issueWpcomState,
  consumeWpcomState,
  buildAuthorizeUrl,
  buildSiteAuthorizeUrl,
  isWpcomOAuthConfigured,
  resetWpcomStateCacheForTests,
} from "@/lib/wpcom-oauth";

beforeEach(() => {
  process.env.FLAVORPRESS_SESSION_SECRET = "test-secret-that-is-at-least-32-bytes-long!!";
  delete process.env.WPCOM_OAUTH_CLIENT_ID;
  delete process.env.WPCOM_OAUTH_CLIENT_SECRET;
  resetWpcomStateCacheForTests();
});

describe("wpcom state token", () => {
  it("round-trip", async () => {
    const token = await issueWpcomState({ nonce: "n1", mode: "login" });
    const state = await consumeWpcomState(token);
    expect(state?.nonce).toBe("n1");
    expect(state?.mode).toBe("login");
  });

  it("carries the invite for signup mode", async () => {
    const token = await issueWpcomState({ nonce: "n2", mode: "signup", invite: "INV" });
    const state = await consumeWpcomState(token);
    expect(state?.mode).toBe("signup");
    expect(state?.invite).toBe("INV");
  });

  it("carries outlet connection state", async () => {
    const token = await issueWpcomState({
      nonce: "n5",
      mode: "outlet",
      userId: "u1",
      outletId: "o1",
      expectedSiteUrl: "https://example.com",
    });
    const state = await consumeWpcomState(token);
    expect(state).toEqual({
      nonce: "n5",
      mode: "outlet",
      userId: "u1",
      outletId: "o1",
      expectedSiteUrl: "https://example.com",
    });
  });

  it("rejects tampered token", async () => {
    const token = await issueWpcomState({ nonce: "n3", mode: "login" });
    // Flip the first character of the signature segment. Tampering the last
    // base64url character is flaky: the last char encodes only 4 of its 6
    // bits (the bottom 2 are padding), so some flips decode to the same
    // bytes and the signature still matches. The first signature char
    // always encodes load-bearing bits.
    const parts = token.split(".");
    const sig = parts[2]!;
    const flippedHead = sig[0] === "A" ? "B" : "A";
    const tampered = `${parts[0]}.${parts[1]}.${flippedHead}${sig.slice(1)}`;
    expect(await consumeWpcomState(tampered)).toBeNull();
  });

  it("single-use within the cache window", async () => {
    const token = await issueWpcomState({ nonce: "n4", mode: "login" });
    await consumeWpcomState(token);
    expect(await consumeWpcomState(token)).toBeNull();
  });
});

describe("buildAuthorizeUrl", () => {
  it("includes client_id, redirect_uri, scope, state, response_type", () => {
    process.env.WPCOM_OAUTH_CLIENT_ID = "test-client";
    const url = new URL(
      buildAuthorizeUrl({ redirectUri: "https://example.com/cb", state: "STATE" }),
    );
    expect(url.host).toBe("public-api.wordpress.com");
    expect(url.searchParams.get("client_id")).toBe("test-client");
    expect(url.searchParams.get("redirect_uri")).toBe("https://example.com/cb");
    expect(url.searchParams.get("state")).toBe("STATE");
    expect(url.searchParams.get("scope")).toBe("auth");
    expect(url.searchParams.get("response_type")).toBe("code");
  });
});

describe("buildSiteAuthorizeUrl", () => {
  it("requests site publishing scopes for the chosen blog", () => {
    process.env.WPCOM_OAUTH_CLIENT_ID = "test-client";
    const url = new URL(
      buildSiteAuthorizeUrl({
        redirectUri: "https://example.com/wpcom",
        state: "STATE",
        siteUrl: "https://blog.example",
      }),
    );
    expect(url.host).toBe("public-api.wordpress.com");
    expect(url.searchParams.get("client_id")).toBe("test-client");
    expect(url.searchParams.get("redirect_uri")).toBe("https://example.com/wpcom");
    expect(url.searchParams.get("blog")).toBe("https://blog.example");
    expect(url.searchParams.get("scope")).toBe("sites posts media");
    expect(url.searchParams.get("response_type")).toBe("code");
  });
});

describe("isWpcomOAuthConfigured", () => {
  it("false without env vars", () => {
    expect(isWpcomOAuthConfigured()).toBe(false);
  });

  it("true with both env vars set", () => {
    expect(
      isWpcomOAuthConfigured({
        WPCOM_OAUTH_CLIENT_ID: "x",
        WPCOM_OAUTH_CLIENT_SECRET: "y",
      } as Record<string, string | undefined>),
    ).toBe(true);
  });

  it("false with only one env var", () => {
    expect(
      isWpcomOAuthConfigured({
        WPCOM_OAUTH_CLIENT_ID: "x",
      } as Record<string, string | undefined>),
    ).toBe(false);
  });
});
