import { beforeEach, describe, expect, it, vi } from "vitest";

const headersMock = vi.hoisted(() => vi.fn());

vi.mock("next/headers", () => ({
  headers: headersMock,
}));

import { canUseAuthorizeFlow, getOrigin } from "../origin";

describe("getOrigin", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    delete process.env.FLAVORPRESS_ORIGIN;
    headersMock.mockReset();
  });

  it("uses the configured FlavorPress origin", async () => {
    process.env.FLAVORPRESS_ORIGIN = "https://app.example/path";
    headersMock.mockResolvedValue(
      new Headers({
        host: "evil.example",
        "x-forwarded-proto": "https",
      }),
    );

    await expect(getOrigin()).resolves.toBe("https://app.example");
  });

  it("accepts safe localhost request headers for development", async () => {
    headersMock.mockResolvedValue(
      new Headers({
        host: "127.0.0.1:4310",
        "x-forwarded-proto": "http",
      }),
    );

    await expect(getOrigin()).resolves.toBe("http://127.0.0.1:4310");
  });

  it("does not trust arbitrary forwarded hosts", async () => {
    headersMock.mockResolvedValue(
      new Headers({
        host: "evil.example",
        "x-forwarded-proto": "https",
      }),
    );

    await expect(getOrigin()).resolves.toBe("http://localhost:3000");
  });

  it("uses the Vercel HTTPS request origin when no explicit origin is configured", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL", "1");
    headersMock.mockResolvedValue(
      new Headers({
        "x-forwarded-host": "app.flavorpress.io",
        host: "internal.vercel.app",
        "x-forwarded-proto": "https",
      }),
    );

    await expect(getOrigin()).resolves.toBe("https://app.flavorpress.io");
    await expect(canUseAuthorizeFlow()).resolves.toBe(true);
  });

  it("does not use a non-HTTPS Vercel request origin for callbacks", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL", "1");
    headersMock.mockResolvedValue(
      new Headers({
        "x-forwarded-host": "app.flavorpress.io",
        "x-forwarded-proto": "http",
      }),
    );

    await expect(getOrigin()).rejects.toThrow("FLAVORPRESS_ORIGIN is required in production.");
    await expect(canUseAuthorizeFlow()).resolves.toBe(false);
  });

  it("requires an explicit origin in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    headersMock.mockResolvedValue(
      new Headers({
        host: "evil.example",
        "x-forwarded-proto": "https",
      }),
    );

    await expect(getOrigin()).rejects.toThrow("FLAVORPRESS_ORIGIN is required in production.");
  });
});
