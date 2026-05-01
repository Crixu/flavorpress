import { describe, expect, it } from "vitest";
import { hostFromUrl } from "../source-title";

describe("hostFromUrl", () => {
  it("returns the host without the leading www.", () => {
    expect(hostFromUrl("https://www.sprudge.com/feed")).toBe("sprudge.com");
  });

  it("preserves a non-www subdomain", () => {
    expect(hostFromUrl("https://blog.example.com/feed")).toBe("blog.example.com");
  });

  it("returns the input unchanged when the URL is unparseable", () => {
    expect(hostFromUrl("not a url")).toBe("not a url");
  });

  it("handles URLs with a port", () => {
    expect(hostFromUrl("http://localhost:3000/x")).toBe("localhost:3000");
  });
});
