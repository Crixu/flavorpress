import { describe, it, expect } from "vitest";
import {
  hashPassword,
  verifyPassword,
  validatePasswordStrength,
  placeholderHash,
} from "@/lib/password";

describe("password", () => {
  it("hashes and verifies a password", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(hash.startsWith("$argon2id$")).toBe(true);
    expect(await verifyPassword("correct horse battery staple", hash)).toBe(true);
  });

  it("rejects a wrong password", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(await verifyPassword("wrong password here xyz", hash)).toBe(false);
  });

  it("returns false on malformed hash (does not throw)", async () => {
    expect(await verifyPassword("anything", "not an argon2 hash")).toBe(false);
  });

  it("rejects too-short passwords", () => {
    expect(validatePasswordStrength("short")).toMatch(/at least 12/);
  });

  it("rejects too-long passwords", () => {
    expect(validatePasswordStrength("x".repeat(257))).toMatch(/at most/);
  });

  it("rejects non-strings", () => {
    expect(validatePasswordStrength(123 as unknown as string)).toBeTruthy();
  });

  it("accepts a valid password", () => {
    expect(validatePasswordStrength("correct horse battery staple")).toBeNull();
  });

  it("placeholderHash is a real argon2id hash", async () => {
    const p = await placeholderHash();
    expect(p.startsWith("$argon2id$")).toBe(true);
    expect(await verifyPassword("not-the-placeholder-secret", p)).toBe(false);
  });
});
