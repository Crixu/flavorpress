import { describe, it, expect, beforeEach } from "vitest";
import { db, ensureSchema } from "@/lib/db";
import { hashPassword } from "@/lib/password";
import { createUser, setStatus, bumpSessionVersion } from "@/lib/users";
import { createSessionCookie } from "@/lib/auth";
import { loadSession, AuthRequiredError } from "@/lib/session";

const SECRET = "test-secret-that-is-at-least-32-bytes-long!!";

beforeEach(async () => {
  await ensureSchema();
  await db.execute("DELETE FROM users");
  process.env.FLAVORPRESS_SESSION_SECRET = SECRET;
});

async function makeUser(email: string) {
  const hash = await hashPassword("correct horse battery staple");
  return createUser({ email, passwordHash: hash });
}

describe("loadSession", () => {
  it("returns the session for a valid cookie", async () => {
    const u = await makeUser("a@example.com");
    const c = await createSessionCookie({ userId: u.id, sessionVersion: 0, secret: SECRET });
    const s = await loadSession(c.value);
    expect(s?.userId).toBe(u.id);
    expect(s?.email).toBe("a@example.com");
    expect(s?.isAdmin).toBe(false);
  });

  it("returns null for missing user row", async () => {
    const c = await createSessionCookie({
      userId: "u_nonexistent",
      sessionVersion: 0,
      secret: SECRET,
    });
    expect(await loadSession(c.value)).toBeNull();
  });

  it("returns null when session_version is stale", async () => {
    const u = await makeUser("a@example.com");
    const c = await createSessionCookie({ userId: u.id, sessionVersion: 0, secret: SECRET });
    await bumpSessionVersion(u.id);
    expect(await loadSession(c.value)).toBeNull();
  });

  it("returns null when user is suspended", async () => {
    const u = await makeUser("a@example.com");
    const c = await createSessionCookie({ userId: u.id, sessionVersion: 0, secret: SECRET });
    await setStatus(u.id, "suspended");
    expect(await loadSession(c.value)).toBeNull();
  });

  it("returns null for malformed cookie", async () => {
    expect(await loadSession("garbage")).toBeNull();
  });

  it("returns null for null input", async () => {
    expect(await loadSession(null)).toBeNull();
    expect(await loadSession(undefined)).toBeNull();
  });
});

describe("AuthRequiredError", () => {
  it("is a real error", () => {
    const err = new AuthRequiredError();
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("AuthRequiredError");
  });
});
