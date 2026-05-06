import { describe, expect, it, vi, afterEach } from "vitest";
import {
  createSessionCookie,
  getAuthConfig,
  hasValidCredentials,
  isAllowedMutationOrigin,
  isAllowedOrigin,
  isAuthConfigured,
  requestOriginFromHeaders,
  safeRedirectPath,
  verifySessionCookie,
} from "@/lib/auth";

describe("auth config", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses obvious defaults only in development", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(getAuthConfig()).toMatchObject({
      username: "writer",
      password: "flavorpress-dev",
      sessionSecret: "dev-only-flavorpress-session-secret-change-me",
    });
    expect(isAuthConfigured()).toBe(true);

    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("FLAVORPRESS_AUTH_USER", "");
    vi.stubEnv("FLAVORPRESS_AUTH_PASSWORD", "");
    vi.stubEnv("FLAVORPRESS_SESSION_SECRET", "");
    expect(isAuthConfigured()).toBe(false);
  });

  it("requires explicit credentials and a session secret outside development", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("FLAVORPRESS_AUTH_USER", "");
    vi.stubEnv("FLAVORPRESS_AUTH_PASSWORD", "");
    vi.stubEnv("FLAVORPRESS_SESSION_SECRET", "");

    expect(hasValidCredentials("writer", "flavorpress-dev")).toBe(false);
    await expect(createSessionCookie()).rejects.toThrow("FlavorPress auth is not configured.");
    await expect(verifySessionCookie("v1.payload.signature")).resolves.toBeNull();
  });
});

describe("session cookies", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("signs and verifies the single writer session", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("FLAVORPRESS_AUTH_USER", "lucas");
    vi.stubEnv("FLAVORPRESS_AUTH_PASSWORD", "secret");
    vi.stubEnv("FLAVORPRESS_SESSION_SECRET", "a-long-random-session-secret-for-tests");

    expect(hasValidCredentials("lucas", "secret")).toBe(true);
    const session = await createSessionCookie(undefined, 1_000);
    await expect(verifySessionCookie(session.value, undefined, 2_000)).resolves.toMatchObject({
      sub: "lucas",
      issuedAt: 1_000,
    });
  });

  it("rejects tampered, expired, and wrong-user cookies", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("FLAVORPRESS_AUTH_USER", "lucas");
    vi.stubEnv("FLAVORPRESS_AUTH_PASSWORD", "secret");
    vi.stubEnv("FLAVORPRESS_SESSION_SECRET", "a-long-random-session-secret-for-tests");

    const session = await createSessionCookie(undefined, 1_000);
    await expect(verifySessionCookie(`${session.value}x`, undefined, 2_000)).resolves.toBeNull();
    await expect(
      verifySessionCookie(session.value, undefined, session.expiresAt + 1_000),
    ).resolves.toBeNull();

    vi.stubEnv("FLAVORPRESS_AUTH_USER", "other");
    await expect(verifySessionCookie(session.value, undefined, 2_000)).resolves.toBeNull();
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
