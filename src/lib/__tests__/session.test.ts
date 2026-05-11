import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const { cookieJar } = vi.hoisted(() => ({
  cookieJar: new Map<string, string>(),
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = cookieJar.get(name);
      return value ? { value } : undefined;
    },
  }),
}));

import { db, ensureSchema } from "@/lib/db";
import { hashPassword } from "@/lib/password";
import { createUser, setStatus, bumpSessionVersion } from "@/lib/users";
import { createSessionCookie } from "@/lib/auth";
import {
  loadSession,
  AuthRequiredError,
  isLocalAuthMode,
  hasSessionCookieForShell,
} from "@/lib/session";

const SECRET = "test-secret-that-is-at-least-32-bytes-long!!";

beforeEach(async () => {
  await ensureSchema();
  await db.execute("DELETE FROM users");
  cookieJar.clear();
  process.env.FLAVORPRESS_SESSION_SECRET = SECRET;
  delete process.env.FLAVORPRESS_AUTH;
  delete process.env.FLAVORPRESS_LOCAL_EMAIL;
});

afterEach(() => {
  delete process.env.FLAVORPRESS_AUTH;
  delete process.env.FLAVORPRESS_LOCAL_EMAIL;
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

describe("hasSessionCookieForShell", () => {
  it("trusts a valid signed cookie without requiring a user row", async () => {
    const c = await createSessionCookie({
      userId: "u_deleted",
      sessionVersion: 0,
      secret: SECRET,
    });
    cookieJar.set("flavorpress_session", c.value);

    expect(await hasSessionCookieForShell()).toBe(true);
  });

  it("returns false without a valid signed cookie", async () => {
    cookieJar.set("flavorpress_session", "garbage");
    expect(await hasSessionCookieForShell()).toBe(false);
  });
});

describe("local auth mode", () => {
  it("isLocalAuthMode reads FLAVORPRESS_AUTH=local", () => {
    expect(isLocalAuthMode({ FLAVORPRESS_AUTH: "local" })).toBe(true);
    expect(isLocalAuthMode({ FLAVORPRESS_AUTH: "off" })).toBe(false);
    expect(isLocalAuthMode({})).toBe(false);
  });

  it("returns the bootstrap session even with no cookie", async () => {
    process.env.FLAVORPRESS_AUTH = "local";
    const s = await loadSession(null);
    expect(s?.userId).toBe("default-user");
    expect(s?.isAdmin).toBe(true);
    expect(s?.email).toBe("local@flavorpress.app");
  });

  it("ignores a garbage cookie when in local mode", async () => {
    process.env.FLAVORPRESS_AUTH = "local";
    const s = await loadSession("not-a-real-cookie");
    expect(s?.userId).toBe("default-user");
  });

  it("creates the default-user row if missing", async () => {
    process.env.FLAVORPRESS_AUTH = "local";
    const before = await db.execute("SELECT 1 FROM users WHERE id = 'default-user'");
    expect(before.rows.length).toBe(0);
    await loadSession(null);
    const after = await db.execute(
      "SELECT id, email, is_admin FROM users WHERE id = 'default-user'",
    );
    expect(after.rows.length).toBe(1);
    expect(String(after.rows[0]!.email)).toBe("local@flavorpress.app");
    expect(Number(after.rows[0]!.is_admin)).toBe(1);
  });

  it("uses FLAVORPRESS_LOCAL_EMAIL when set on first bootstrap", async () => {
    process.env.FLAVORPRESS_AUTH = "local";
    process.env.FLAVORPRESS_LOCAL_EMAIL = "writer@example.com";
    const s = await loadSession(null);
    expect(s?.email).toBe("writer@example.com");
  });

  it("does not overwrite an existing default-user row", async () => {
    await db.execute({
      sql: `INSERT INTO users (id, email, status, is_admin, session_version, created_at)
            VALUES ('default-user', 'pre-existing@flavorpress.local', 'active', 0, 0, ?)`,
      args: [Date.now()],
    });
    process.env.FLAVORPRESS_AUTH = "local";
    const s = await loadSession(null);
    expect(s?.email).toBe("pre-existing@flavorpress.local");
    // Local mode forces isAdmin true regardless of the stored flag, so the
    // legacy default-user gets effective admin without us mutating the row.
    expect(s?.isAdmin).toBe(true);
  });
});
