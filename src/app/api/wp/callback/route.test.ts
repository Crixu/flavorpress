import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  ensureSchema: vi.fn(),
  ensureSingleUser: vi.fn(),
  getOrigin: vi.fn(),
  consumeWPAuthorizeState: vi.fn(),
  getOutlet: vi.fn(),
  recordOutletError: vi.fn(),
  commitOutletCredentials: vi.fn(),
  probeWordPress: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  ensureSchema: mocks.ensureSchema,
  ensureSingleUser: mocks.ensureSingleUser,
}));

vi.mock("@/lib/v1/origin", () => ({
  getOrigin: mocks.getOrigin,
}));

vi.mock("@/lib/v1/wp-authorize-state", () => ({
  consumeWPAuthorizeState: mocks.consumeWPAuthorizeState,
  normalizeSiteUrl(raw: string) {
    try {
      const url = new URL(raw.trim());
      if (url.protocol !== "http:" && url.protocol !== "https:") return null;
      url.hash = "";
      url.search = "";
      return url.toString().replace(/\/$/, "");
    } catch {
      return null;
    }
  },
  siteOrigin(raw: string) {
    try {
      const url = new URL(raw);
      if (url.protocol !== "http:" && url.protocol !== "https:") return null;
      return url.origin;
    } catch {
      return null;
    }
  },
}));

vi.mock("@/lib/v1/outlets", () => ({
  getOutlet: mocks.getOutlet,
  recordOutletError: mocks.recordOutletError,
  commitOutletCredentials: mocks.commitOutletCredentials,
}));

vi.mock("@/lib/wordpress", () => ({
  probeWordPress: mocks.probeWordPress,
}));

import { GET } from "./route";

const authorizeState = {
  state: "state-1",
  userId: "default-user",
  outletId: "outlet-1",
  expectedSiteUrl: "https://wp.example",
  expectedSiteOrigin: "https://wp.example",
  createdAt: 1,
  expiresAt: 2,
};

describe("WordPress authorize callback", () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset();
    mocks.getOrigin.mockResolvedValue("https://app.example");
    mocks.ensureSchema.mockResolvedValue(undefined);
    mocks.ensureSingleUser.mockResolvedValue(undefined);
    mocks.recordOutletError.mockResolvedValue(undefined);
    mocks.commitOutletCredentials.mockResolvedValue(undefined);
  });

  it("rejects a callback with missing state", async () => {
    const response = await GET(
      request({
        outlet_id: "outlet-1",
        site_url: "https://wp.example",
        user_login: "author",
        password: "secret",
      }),
    );

    expect(locationOf(response)).toBe("https://app.example/voice?wp_error=missing_state");
    expect(mocks.consumeWPAuthorizeState).not.toHaveBeenCalled();
    expect(mocks.commitOutletCredentials).not.toHaveBeenCalled();
  });

  it("rejects a callback with wrong state", async () => {
    mocks.consumeWPAuthorizeState.mockResolvedValue({ ok: false, reason: "missing" });

    const response = await GET(
      request({
        outlet_id: "outlet-1",
        state: "wrong",
        site_url: "https://wp.example",
        user_login: "author",
        password: "secret",
      }),
    );

    expect(mocks.consumeWPAuthorizeState).toHaveBeenCalledWith("wrong");
    expect(locationOf(response)).toBe("https://app.example/voice?wp_error=invalid_state");
    expect(mocks.commitOutletCredentials).not.toHaveBeenCalled();
  });

  it("rejects an expired state", async () => {
    mocks.consumeWPAuthorizeState.mockResolvedValue({ ok: false, reason: "expired" });

    const response = await GET(
      request({
        outlet_id: "outlet-1",
        state: "state-1",
        site_url: "https://wp.example",
        user_login: "author",
        password: "secret",
      }),
    );

    expect(locationOf(response)).toBe("https://app.example/voice?wp_error=expired_state");
    expect(mocks.commitOutletCredentials).not.toHaveBeenCalled();
  });

  it("rejects a callback from the wrong WordPress site URL", async () => {
    mocks.consumeWPAuthorizeState.mockResolvedValue({ ok: true, value: authorizeState });
    mocks.getOutlet.mockResolvedValue({ id: "outlet-1", baseUrl: "https://wp.example" });

    const response = await GET(
      request({
        outlet_id: "outlet-1",
        state: "state-1",
        site_url: "https://evil.example",
        user_login: "author",
        password: "secret",
      }),
    );

    expect(locationOf(response)).toBe("https://app.example/voice?wp_error=site_mismatch");
    expect(mocks.recordOutletError).toHaveBeenCalledWith(
      "outlet-1",
      "WordPress authorize callback returned a different site URL.",
    );
    expect(mocks.probeWordPress).not.toHaveBeenCalled();
    expect(mocks.commitOutletCredentials).not.toHaveBeenCalled();
  });

  it("rejects a callback from the same origin but wrong WordPress path", async () => {
    mocks.consumeWPAuthorizeState.mockResolvedValue({
      ok: true,
      value: {
        ...authorizeState,
        expectedSiteUrl: "https://wp.example/blog",
        expectedSiteOrigin: "https://wp.example",
      },
    });
    mocks.getOutlet.mockResolvedValue({ id: "outlet-1", baseUrl: "https://wp.example/blog" });

    const response = await GET(
      request({
        outlet_id: "outlet-1",
        state: "state-1",
        site_url: "https://wp.example",
        user_login: "author",
        password: "secret",
      }),
    );

    expect(locationOf(response)).toBe("https://app.example/voice?wp_error=site_mismatch");
    expect(mocks.recordOutletError).toHaveBeenCalledWith(
      "outlet-1",
      "WordPress authorize callback returned a different site URL.",
    );
    expect(mocks.probeWordPress).not.toHaveBeenCalled();
    expect(mocks.commitOutletCredentials).not.toHaveBeenCalled();
  });

  it("commits credentials for a valid callback", async () => {
    mocks.consumeWPAuthorizeState.mockResolvedValue({ ok: true, value: authorizeState });
    mocks.getOutlet.mockResolvedValue({ id: "outlet-1", baseUrl: "https://wp.example" });
    mocks.probeWordPress.mockResolvedValue({ ok: true, kind: "wp-org" });

    const response = await GET(
      request({
        outlet_id: "outlet-1",
        state: "state-1",
        site_url: "https://wp.example",
        user_login: "author",
        password: "secret",
      }),
    );

    expect(mocks.probeWordPress).toHaveBeenCalledWith({
      baseUrl: "https://wp.example",
      username: "author",
      appPassword: "secret",
    });
    expect(mocks.commitOutletCredentials).toHaveBeenCalledWith(
      "outlet-1",
      "author",
      "secret",
      "wp-org",
    );
    expect(locationOf(response)).toBe("https://app.example/voice?wp_connected=outlet-1");
  });
});

function request(params: Record<string, string>): Request {
  const url = new URL("https://attacker.example/api/wp/callback");
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return new Request(url);
}

function locationOf(response: Response): string | null {
  return response.headers.get("location");
}
