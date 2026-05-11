import { describe, it, expect, beforeEach } from "vitest";
import { db, ensureSchema } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/password";
import {
  createUser,
  getUserByEmail,
  getUserById,
  updatePassword,
  setStatus,
  bumpSessionVersion,
} from "@/lib/users";

beforeEach(async () => {
  await ensureSchema();
  await db.execute("DELETE FROM users");
});

describe("users", () => {
  it("creates a user with a hashed password", async () => {
    const hash = await hashPassword("correct horse battery staple");
    const u = await createUser({ email: "a@example.com", passwordHash: hash });
    expect(u.id).toMatch(/^u_/);
    expect(u.email).toBe("a@example.com");
    expect(u.isAdmin).toBe(false);
    expect(u.status).toBe("active");
    expect(u.sessionVersion).toBe(0);
  });

  it("rejects duplicate email", async () => {
    const hash = await hashPassword("correct horse battery staple");
    await createUser({ email: "a@example.com", passwordHash: hash });
    await expect(
      createUser({ email: "a@example.com", passwordHash: hash }),
    ).rejects.toThrow();
  });

  it("getUserByEmail returns the user with the password hash", async () => {
    const hash = await hashPassword("correct horse battery staple");
    await createUser({ email: "a@example.com", passwordHash: hash });
    const u = await getUserByEmail("a@example.com");
    expect(u?.email).toBe("a@example.com");
    expect(await verifyPassword("correct horse battery staple", u!.passwordHash!)).toBe(true);
  });

  it("getUserByEmail is case-insensitive", async () => {
    const hash = await hashPassword("correct horse battery staple");
    await createUser({ email: "a@example.com", passwordHash: hash });
    const u = await getUserByEmail("A@Example.COM");
    expect(u?.email).toBe("a@example.com");
  });

  it("getUserById returns the user", async () => {
    const hash = await hashPassword("correct horse battery staple");
    const created = await createUser({ email: "a@example.com", passwordHash: hash });
    const u = await getUserById(created.id);
    expect(u?.id).toBe(created.id);
  });

  it("setAdmin flag at creation", async () => {
    const hash = await hashPassword("correct horse battery staple");
    const u = await createUser({ email: "a@example.com", passwordHash: hash, isAdmin: true });
    expect(u.isAdmin).toBe(true);
  });

  it("updatePassword changes the hash and bumps session_version", async () => {
    const hash = await hashPassword("correct horse battery staple");
    const u = await createUser({ email: "a@example.com", passwordHash: hash });
    const newHash = await hashPassword("zebra zebra zebra zebra");
    await updatePassword(u.id, newHash);
    const after = await getUserById(u.id);
    expect(after?.sessionVersion).toBe(1);
    expect(await verifyPassword("zebra zebra zebra zebra", after!.passwordHash!)).toBe(true);
  });

  it("setStatus rejects suspended users at the row level", async () => {
    const hash = await hashPassword("correct horse battery staple");
    const u = await createUser({ email: "a@example.com", passwordHash: hash });
    await setStatus(u.id, "suspended");
    const after = await getUserById(u.id);
    expect(after?.status).toBe("suspended");
  });

  it("bumpSessionVersion increments", async () => {
    const hash = await hashPassword("correct horse battery staple");
    const u = await createUser({ email: "a@example.com", passwordHash: hash });
    await bumpSessionVersion(u.id);
    await bumpSessionVersion(u.id);
    const after = await getUserById(u.id);
    expect(after?.sessionVersion).toBe(2);
  });
});
