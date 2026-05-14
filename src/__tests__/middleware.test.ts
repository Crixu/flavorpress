import type { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

const authMocks = vi.hoisted(() => ({
  verifySessionCookie: vi.fn(async () => null),
}));

vi.mock("@/lib/auth", () => ({
  SESSION_COOKIE_NAME: "flavorpress_session",
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

function requestFor(pathname: string): NextRequest {
  const url = new URL(`http://localhost${pathname}`);
  return {
    method: "GET",
    headers: new Headers(),
    cookies: {
      get: () => undefined,
    },
    nextUrl: {
      pathname: url.pathname,
      search: url.search,
      origin: url.origin,
    },
  } as unknown as NextRequest;
}
