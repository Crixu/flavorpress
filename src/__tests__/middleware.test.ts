import type { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

const authMocks = vi.hoisted(() => ({
  verifySessionCookie: vi.fn(
    async (
      _value?: string,
    ): Promise<{
      userId: string;
      sessionVersion: number;
      issuedAt: number;
      expiresAt: number;
    } | null> => null,
  ),
}));

vi.mock("@/lib/auth", () => ({
  LEGACY_SESSION_COOKIE_NAME: "flavorpress_session",
  SESSION_COOKIE_NAME: "__Host-flavorpress_session",
  isAllowedMutationOrigin: () => true,
  isMutationMethod: (method: string) => !["GET", "HEAD", "OPTIONS"].includes(method),
  safeRedirectPath: (path: string) => path,
  verifySessionCookie: authMocks.verifySessionCookie,
}));

import { middleware } from "../../middleware";

describe("middleware cron routes", () => {
  it.each([
    "/api/cron/poll-early",
    "/api/cron/poll",
    "/api/cron/poll-midday",
    "/api/cron/poll-late",
  ])("lets %s reach its handler without a session cookie", async (pathname) => {
    authMocks.verifySessionCookie.mockClear();

    const res = await middleware(requestFor(pathname));

    expect(res.status).toBe(200);
    expect(res.headers.get("x-middleware-next")).toBe("1");
    expect(authMocks.verifySessionCookie).not.toHaveBeenCalled();
  });
});

describe("middleware session cookies", () => {
  it("accepts the legacy session cookie name during migration", async () => {
    authMocks.verifySessionCookie.mockImplementation(async (value) =>
      value === "legacy-session"
        ? { userId: "u1", sessionVersion: 0, issuedAt: 1, expiresAt: 2 }
        : null,
    );

    const res = await middleware(requestFor("/", { flavorpress_session: "legacy-session" }));

    expect(res.status).toBe(200);
    expect(res.headers.get("x-middleware-next")).toBe("1");
    expect(authMocks.verifySessionCookie).toHaveBeenCalledWith(undefined);
    expect(authMocks.verifySessionCookie).toHaveBeenCalledWith("legacy-session");
  });
});

function requestFor(pathname: string, cookieValues: Record<string, string> = {}): NextRequest {
  const url = new URL(`http://localhost${pathname}`);
  return {
    method: "GET",
    headers: new Headers(),
    cookies: {
      get: (name: string) => {
        const value = cookieValues[name];
        return value ? { value } : undefined;
      },
    },
    nextUrl: {
      pathname: url.pathname,
      search: url.search,
      origin: url.origin,
    },
  } as unknown as NextRequest;
}
