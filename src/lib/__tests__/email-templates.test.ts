import { describe, it, expect } from "vitest";
import { verificationEmail, passwordResetEmail } from "@/lib/email-templates";

describe("verificationEmail", () => {
  it("returns subject, html, text containing the URL", () => {
    const url = "https://example.com/verify-email/abc";
    const m = verificationEmail(url);
    expect(m.subject).toMatch(/verify/i);
    expect(m.html).toContain(url);
    expect(m.text).toContain(url);
  });

  it("escapes a URL with HTML-sensitive characters", () => {
    const url = "https://example.com/verify-email/a&b<c";
    const m = verificationEmail(url);
    expect(m.html).not.toContain("<c");
    expect(m.text).toContain(url);
  });
});

describe("passwordResetEmail", () => {
  it("returns subject, html, text containing the URL", () => {
    const url = "https://example.com/reset-password/xyz";
    const m = passwordResetEmail(url);
    expect(m.subject).toMatch(/password/i);
    expect(m.html).toContain(url);
    expect(m.text).toContain(url);
  });
});
