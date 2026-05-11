import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { resolveSender, sendEmail } from "@/lib/email";

describe("resolveSender", () => {
  beforeEach(() => {
    delete process.env.FLAVORPRESS_EMAIL_FROM;
    delete process.env.FLAVORPRESS_ORIGIN;
  });

  it("uses FLAVORPRESS_EMAIL_FROM when set", () => {
    process.env.FLAVORPRESS_EMAIL_FROM = "Custom <custom@example.com>";
    expect(resolveSender()).toBe("Custom <custom@example.com>");
  });

  it("derives from FLAVORPRESS_ORIGIN host when no FROM override", () => {
    process.env.FLAVORPRESS_ORIGIN = "https://demo.flavorpress.app";
    expect(resolveSender()).toBe("FlavorPress <noreply@demo.flavorpress.app>");
  });

  it("falls back to local default", () => {
    expect(resolveSender()).toBe("FlavorPress <noreply@flavorpress.local>");
  });
});

describe("sendEmail console fallback", () => {
  let logs: string[];
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("NODE_ENV", "development");
    logs = [];
    logSpy = vi.spyOn(console, "info").mockImplementation((m: string) => {
      logs.push(String(m));
    });
  });

  afterEach(() => {
    logSpy.mockRestore();
    vi.unstubAllEnvs();
  });

  it("logs the email in dev without an API key", async () => {
    await sendEmail({
      to: "a@example.com",
      subject: "Hello",
      html: "<p>Hi</p>",
      text: "Hi",
    });
    expect(logs.join("\n")).toMatch(/a@example\.com/);
    expect(logs.join("\n")).toMatch(/Hello/);
  });

  it("throws in production with no key", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await expect(
      sendEmail({ to: "a@example.com", subject: "x", html: "<p>x</p>", text: "x" }),
    ).rejects.toThrow(/RESEND_API_KEY/);
  });
});
