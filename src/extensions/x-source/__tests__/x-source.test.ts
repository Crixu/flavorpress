import { beforeEach, describe, expect, it, vi } from "vitest";

const { getSettingMock } = vi.hoisted(() => ({
  getSettingMock: vi.fn(),
}));

vi.mock("@/lib/v1/settings", () => ({
  getSetting: getSettingMock,
}));

import { buildBridgeUrl, extractHandle, xSourceExtension } from "../server";

const TEMPLATE = "https://nitter.example/{handle}/rss";

beforeEach(() => {
  getSettingMock.mockReset();
  delete process.env.X_BRIDGE_TEMPLATE;
});

describe("extractHandle", () => {
  it("accepts @handle", () => {
    expect(extractHandle("@levie")).toBe("levie");
  });

  it("accepts x.com profile URL", () => {
    expect(extractHandle("https://x.com/levie")).toBe("levie");
  });

  it("accepts twitter.com profile URL", () => {
    expect(extractHandle("https://twitter.com/levie")).toBe("levie");
  });

  it("strips www. prefix", () => {
    expect(extractHandle("https://www.x.com/levie")).toBe("levie");
  });

  it("extracts handle from a status URL", () => {
    expect(extractHandle("https://x.com/levie/status/123")).toBe("levie");
  });

  it("rejects bare handles without @", () => {
    expect(extractHandle("levie")).toBeNull();
  });

  it("rejects unrelated URLs", () => {
    expect(extractHandle("https://example.com/feed")).toBeNull();
  });

  it("rejects empty input", () => {
    expect(extractHandle("")).toBeNull();
    expect(extractHandle("   ")).toBeNull();
  });

  it("rejects malformed handles", () => {
    expect(extractHandle("@with-dash")).toBeNull();
    expect(extractHandle("@toolong_handle_exceeds_limit")).toBeNull();
  });
});

describe("buildBridgeUrl", () => {
  it("substitutes the handle placeholder", () => {
    expect(buildBridgeUrl("levie", TEMPLATE)).toBe("https://nitter.example/levie/rss");
  });

  it("throws when the template lacks a placeholder", () => {
    expect(() => buildBridgeUrl("levie", "https://nitter.example/rss")).toThrow();
  });
});

describe("xSourceExtension contract", () => {
  it("claims X handles and rejects unrelated inputs", () => {
    expect(xSourceExtension.claims("@levie")).toBe(true);
    expect(xSourceExtension.claims("https://x.com/levie")).toBe(true);
    expect(xSourceExtension.claims("https://example.com/feed")).toBe(false);
  });

  it("declares the x SourceKind", () => {
    expect(xSourceExtension.kind).toBe("x");
  });

  it("registers a bridge-template setting field", () => {
    expect(xSourceExtension.settings?.[0]?.key).toBe("x_bridge_template");
  });

  it("resolves handles with the bridge template from the environment", async () => {
    getSettingMock.mockResolvedValue(null);
    process.env.X_BRIDGE_TEMPLATE = TEMPLATE;

    await expect(xSourceExtension.resolve("@levie")).resolves.toEqual({
      url: "https://nitter.example/levie/rss",
      displayName: "@levie",
    });
  });

  it("surfaces a missing bridge template as a user-facing error", async () => {
    getSettingMock.mockResolvedValue(null);

    await expect(xSourceExtension.resolve("@levie")).rejects.toThrow(
      "X bridge template is missing",
    );
  });
});
