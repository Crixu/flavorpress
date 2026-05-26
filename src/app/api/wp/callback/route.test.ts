import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  ensureSchema: vi.fn(),
  getOrigin: vi.fn(),
  consumeWPAuthorizeState: vi.fn(),
  getOutlet: vi.fn(),
  recordOutletError: vi.fn(),
  commitOutletCredentials: vi.fn(),
  probeWordPress: vi.fn(),
  rotateOutletAppPassword: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  ensureSchema: mocks.ensureSchema,
}));

vi.mock("@/lib/v1/origin", () => ({
  getOrigin: mocks.getOrigin,
}));

vi.mock("@/lib/v1/wp-authorize-state", () => ({
  WP_AUTHORIZE_STATE_COOKIE: "fp_wp_authorize_state",
  consumeWPAuthorizeState: mocks.consumeWPAuthorizeState,
  wpAuthorizeStateCookieOptions(maxAge: number) {
    return {
      httpOnly: true,
      sameSite: "lax" as const,
      secure: false,
      path: "/api/wp/callback",
      maxAge,
    };
  },
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

vi.mock("@/lib/v1/wp-rotate", () => ({
  isWpAppPasswordRotationEnabled: () => process.env.FLAVORPRESS_WP_ROTATE_APP_PW === "1",
  rotateOutletAppPassword: mocks.rotateOutletAppPassword,
}));

import { GET } from "./route";

const authorizeState = {
  state: "state-1",
  userId: "default-user",
  outletId: "outlet-1",
  expectedSiteUrl: "https://wp.example",
  expectedSiteOrigin: "https://wp.example",
  boundValue: "cookie-secret",
  createdAt: 1,
  expiresAt: 2,
};

describe("WordPress authorize callback", () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset();
    mocks.getOrigin.mockResolvedValue("https://app.example");
    mocks.ensureSchema.mockResolvedValue(undefined);
    mocks.recordOutletError.mockResolvedValue(undefined);
    mocks.commitOutletCredentials.mockResolvedValue(undefined);
    mocks.rotateOutletAppPassword.mockResolvedValue({
      appPassword: "rotated-secret",
      replacementUuid: "replacement-uuid",
      previousUuid: "previous-uuid",
      previousDeleted: true,
    });
    delete process.env.FLAVORPRESS_WP_ROTATE_APP_PW;
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

  it("sets no-referrer and no-store on redirects", async () => {
    const response = await GET(
      request({
        outlet_id: "outlet-1",
        site_url: "https://wp.example",
        user_login: "author",
        password: "secret",
      }),
    );

    expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("rejects a valid state without the matching browser cookie", async () => {
    mocks.consumeWPAuthorizeState.mockResolvedValue({ ok: true, value: authorizeState });

    const response = await GET(
      request(
        {
          outlet_id: "outlet-1",
          state: "state-1",
          site_url: "https://wp.example",
          user_login: "author",
          password: "secret",
        },
        { cookie: null },
      ),
    );

    expect(mocks.consumeWPAuthorizeState).toHaveBeenCalledWith("state-1");
    expect(locationOf(response)).toBe("https://app.example/voice?wp_error=state_mismatch");
    expect(mocks.commitOutletCredentials).not.toHaveBeenCalled();
  });

  it("rejects a valid state with a different browser cookie", async () => {
    mocks.consumeWPAuthorizeState.mockResolvedValue({ ok: true, value: authorizeState });

    const response = await GET(
      request(
        {
          outlet_id: "outlet-1",
          state: "state-1",
          site_url: "https://wp.example",
          user_login: "author",
          password: "secret",
        },
        { cookie: "attacker-cookie" },
      ),
    );

    expect(mocks.consumeWPAuthorizeState).toHaveBeenCalledWith("state-1");
    expect(locationOf(response)).toBe("https://app.example/voice?wp_error=state_mismatch");
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

  it("rejects a callback when the outlet in state does not belong to the state userId", async () => {
    // State belongs to user A but getOutlet returns null, simulating an outlet
    // owned by a different user (user B). The route must not commit credentials.
    mocks.consumeWPAuthorizeState.mockResolvedValue({
      ok: true,
      value: { ...authorizeState, userId: "user-a", outletId: "outlet-of-user-b" },
    });
    mocks.getOutlet.mockResolvedValue(null); // getOutlet(outletId, userId) returns null for wrong owner

    const response = await GET(
      request({
        outlet_id: "outlet-of-user-b",
        state: "state-1",
        site_url: "https://wp.example",
        user_login: "author",
        password: "secret",
      }),
    );

    expect(mocks.getOutlet).toHaveBeenCalledWith("outlet-of-user-b", "user-a");
    expect(locationOf(response)).toBe("https://app.example/voice?wp_error=unknown_outlet");
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
    expect(response.headers.get("set-cookie")).toContain("fp_wp_authorize_state=");
  });

  it("allows legacy in-flight states that do not have a bound cookie value", async () => {
    mocks.consumeWPAuthorizeState.mockResolvedValue({
      ok: true,
      value: { ...authorizeState, boundValue: null },
    });
    mocks.getOutlet.mockResolvedValue({ id: "outlet-1", baseUrl: "https://wp.example" });
    mocks.probeWordPress.mockResolvedValue({ ok: true, kind: "wp-org" });

    const response = await GET(
      request(
        {
          outlet_id: "outlet-1",
          state: "state-1",
          site_url: "https://wp.example",
          user_login: "author",
          password: "secret",
        },
        { cookie: null },
      ),
    );

    expect(mocks.commitOutletCredentials).toHaveBeenCalledWith(
      "outlet-1",
      "author",
      "secret",
      "wp-org",
    );
    expect(locationOf(response)).toBe("https://app.example/voice?wp_connected=outlet-1");
  });

  it("stores a rotated application password when rotation is enabled", async () => {
    process.env.FLAVORPRESS_WP_ROTATE_APP_PW = "1";
    mocks.consumeWPAuthorizeState.mockResolvedValue({ ok: true, value: authorizeState });
    mocks.getOutlet.mockResolvedValue({ id: "outlet-1", baseUrl: "https://wp.example" });
    mocks.probeWordPress.mockResolvedValue({ ok: true, kind: "wp-org" });

    const response = await GET(
      request({
        outlet_id: "outlet-1",
        state: "state-1",
        site_url: "https://wp.example",
        user_login: "author",
        password: "callback-secret",
      }),
    );

    expect(mocks.rotateOutletAppPassword).toHaveBeenCalledWith({
      baseUrl: "https://wp.example",
      username: "author",
      appPassword: "callback-secret",
    });
    expect(mocks.commitOutletCredentials).toHaveBeenCalledWith(
      "outlet-1",
      "author",
      "rotated-secret",
      "wp-org",
    );
    expect(locationOf(response)).toBe("https://app.example/voice?wp_connected=outlet-1");
  });

  it("does not store the callback password when flagged rotation fails", async () => {
    process.env.FLAVORPRESS_WP_ROTATE_APP_PW = "1";
    mocks.consumeWPAuthorizeState.mockResolvedValue({ ok: true, value: authorizeState });
    mocks.getOutlet.mockResolvedValue({ id: "outlet-1", baseUrl: "https://wp.example" });
    mocks.probeWordPress.mockResolvedValue({ ok: true, kind: "wp-org" });
    mocks.rotateOutletAppPassword.mockRejectedValue(new Error("create denied"));

    const response = await GET(
      request({
        outlet_id: "outlet-1",
        state: "state-1",
        site_url: "https://wp.example",
        user_login: "author",
        password: "callback-secret",
      }),
    );

    expect(mocks.commitOutletCredentials).not.toHaveBeenCalled();
    expect(mocks.recordOutletError).toHaveBeenCalledWith(
      "outlet-1",
      "WordPress credential rotation failed: create denied",
    );
    expect(locationOf(response)).toBe(
      "https://app.example/voice?wp_error=credential_rotation_failed",
    );
  });

  it("does not log the callback secret", async () => {
    mocks.consumeWPAuthorizeState.mockResolvedValue({ ok: true, value: authorizeState });
    mocks.getOutlet.mockResolvedValue({ id: "outlet-1", baseUrl: "https://wp.example" });
    mocks.probeWordPress.mockResolvedValue({ ok: true, kind: "wp-org" });
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    let logged = "";
    try {
      await GET(
        request({
          outlet_id: "outlet-1",
          state: "state-1",
          site_url: "https://wp.example",
          user_login: "author",
          password: "callback-secret",
        }),
      );
      logged = [...info.mock.calls, ...warn.mock.calls, ...error.mock.calls]
        .flat()
        .map(String)
        .join("\n");
    } finally {
      info.mockRestore();
      warn.mockRestore();
      error.mockRestore();
    }

    expect(logged).not.toContain("callback-secret");
    expect(logged).not.toContain("password=");
  });
});

function request(params: Record<string, string>, opts: { cookie?: string | null } = {}): Request {
  const url = new URL("https://attacker.example/api/wp/callback");
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  const headers = new Headers();
  const cookie = opts.cookie === undefined ? authorizeState.boundValue : opts.cookie;
  if (cookie !== null) {
    headers.set("cookie", `fp_wp_authorize_state=${cookie}`);
  }
  return new Request(url, { headers });
}

function locationOf(response: Response): string | null {
  return response.headers.get("location");
}
