import { afterEach, describe, expect, it, vi } from "vitest";
import { LOCAL_AUTH_PRODUCTION_ERROR } from "@/lib/env-guards";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("local auth production guard", () => {
  it("refuses local auth when the session module imports in Vercel production", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("FLAVORPRESS_AUTH", "local");
    vi.resetModules();

    await expect(import("@/lib/session")).rejects.toThrow(LOCAL_AUTH_PRODUCTION_ERROR);
  });

  it("refuses local auth when middleware imports in Vercel production", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("FLAVORPRESS_AUTH", "local");
    vi.resetModules();

    await expect(import("../../middleware")).rejects.toThrow(LOCAL_AUTH_PRODUCTION_ERROR);
  });

  it("allows local auth imports in Vercel preview", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("FLAVORPRESS_AUTH", "local");
    vi.stubEnv(
      "FLAVORPRESS_ENCRYPTION_KEY",
      "hex:0000000000000000000000000000000000000000000000000000000000000000",
    );
    vi.resetModules();

    await expect(import("@/lib/session")).resolves.toHaveProperty("isLocalAuthMode");

    vi.resetModules();
    await expect(import("../../middleware")).resolves.toHaveProperty("middleware");
  });
});
