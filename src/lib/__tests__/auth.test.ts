import { describe, it, expect, afterEach, vi } from "vitest";
import {
  createSessionCookie,
  verifySessionCookie,
  SESSION_TTL_SECONDS_DEV,
  SESSION_TTL_SECONDS_PROD,
  getSessionTtlSeconds,
  isAllowedMutationOrigin,
  isAllowedOrigin,
  safeRedirectPath,
  requestOriginFromHeaders,
} from "@/lib/auth";

const SECRET = "test-secret-that-is-at-least-32-bytes-long-string!";

describe("auth session cookie", () => {
  it("issues a v2 cookie with userId as sub", async () => {
    const cookie = await createSessionCookie({
      userId: "u_abc",
      sessionVersion: 7,
      secret: SECRET,
    });
    const verified = await verifySessionCookie(cookie.value, SECRET);
    expect(verified?.userId).toBe("u_abc");
    expect(verified?.sessionVersion).toBe(7);
  });

  it("rejects a tampered signature", async () => {
    const cookie = await createSessionCookie({
      userId: "u_abc",
      sessionVersion: 0,
      secret: SECRET,
    });
    // Flip the first signature character. Replacing the last char of a
    // base64url signature is flaky: the last char encodes only 4 of its
    // 6 bits (the bottom 2 are padding), so some flips decode to the same
    // bytes and the signature still verifies.
    const parts = cookie.value.split(".");
    const sig = parts[2]!;
    const flippedHead = sig[0] === "A" ? "B" : "A";
    const tampered = `${parts[0]}.${parts[1]}.${flippedHead}${sig.slice(1)}`;
    expect(await verifySessionCookie(tampered, SECRET)).toBeNull();
  });

  it("rejects an expired payload", async () => {
    const cookie = await createSessionCookie({
      userId: "u_abc",
      sessionVersion: 0,
      secret: SECRET,
      now: Date.now() - (getSessionTtlSeconds() * 1000 + 1000),
    });
    expect(await verifySessionCookie(cookie.value, SECRET)).toBeNull();
  });

  it("getSessionTtlSeconds returns 1 day in production, 7 in development", () => {
    expect(SESSION_TTL_SECONDS_DEV).toBe(60 * 60 * 24 * 7);
    expect(SESSION_TTL_SECONDS_PROD).toBe(60 * 60 * 24);
  });
});

describe("origin and redirects", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("allows the request origin and configured origins", () => {
    vi.stubEnv("FLAVORPRESS_ALLOWED_ORIGINS", "https://admin.example.com");

    expect(
      isAllowedOrigin("https://flavorpress.example.com/path", "https://flavorpress.example.com"),
    ).toBe(true);
    expect(
      isAllowedOrigin("https://admin.example.com/path", "https://flavorpress.example.com"),
    ).toBe(true);
    expect(isAllowedOrigin("https://evil.example.com", "https://flavorpress.example.com")).toBe(
      false,
    );
  });

  it("checks mutation origins where browsers provide them", () => {
    expect(
      isAllowedMutationOrigin(
        new Headers({ origin: "https://flavorpress.example.com" }),
        "https://flavorpress.example.com",
      ),
    ).toBe(true);
    expect(
      isAllowedMutationOrigin(
        new Headers({ origin: "https://evil.example.com" }),
        "https://flavorpress.example.com",
      ),
    ).toBe(false);
    expect(
      isAllowedMutationOrigin(
        new Headers({ "sec-fetch-site": "cross-site" }),
        "https://flavorpress.example.com",
      ),
    ).toBe(false);
  });

  it("keeps redirects app-local", () => {
    expect(safeRedirectPath("/sources?folder=abc")).toBe("/sources?folder=abc");
    expect(safeRedirectPath("https://evil.example.com")).toBe("/");
    expect(safeRedirectPath("//evil.example.com/path")).toBe("/");
  });

  it("uses browser origin before host fallback", () => {
    expect(
      requestOriginFromHeaders(
        new Headers({
          origin: "http://localhost:3000",
          host: "localhost:3000",
        }),
      ),
    ).toBe("http://localhost:3000");
  });
});
