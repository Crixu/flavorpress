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
    set: (name: string, value: string) => {
      cookieJar.set(name, value);
    },
  }),
}));

import { db, ensureSchema } from "@/lib/db";
import { hashPassword } from "@/lib/password";
import { createUser, setStatus, bumpSessionVersion, getUserById } from "@/lib/users";
import { LEGACY_SESSION_COOKIE_NAME, SESSION_COOKIE_NAME, createSessionCookie } from "@/lib/auth";
import {
  loadSession,
  AuthRequiredError,
  canAccessSettings,
  getSession,
  isLocalAuthMode,
  isLocalAdminDebugMode,
  hasSessionCookieForShell,
  shouldShowAdminControls,
} from "@/lib/session";

const SECRET = "test-secret-that-is-at-least-32-bytes-long!!";

beforeEach(async () => {
  await ensureSchema();
  await db.execute("DELETE FROM users");
  cookieJar.clear();
  process.env.FLAVORPRESS_SESSION_SECRET = SECRET;
  delete process.env.FLAVORPRESS_AUTH;
  delete process.env.FLAVORPRESS_LOCAL_EMAIL;
  delete process.env.FLAVORPRESS_DEBUG_ADMIN;
});

afterEach(() => {
  delete process.env.FLAVORPRESS_AUTH;
  delete process.env.FLAVORPRESS_LOCAL_EMAIL;
  delete process.env.FLAVORPRESS_DEBUG_ADMIN;
});

async function makeUser(email: string) {
  const hash = await hashPassword("correct horse battery staple");
  return createUser({ email, passwordHash: hash, emailVerifiedAt: Date.now() });
}

describe("loadSession", () => {
  it("returns the session for a valid cookie", async () => {
    const u = await makeUser("a@example.com");
    const staleActiveAt = 1;
    await db.execute({
      sql: "UPDATE users SET last_active_at = ? WHERE id = ?",
      args: [staleActiveAt, u.id],
    });
    const c = await createSessionCookie({ userId: u.id, sessionVersion: 0, secret: SECRET });
    const s = await loadSession(c.value);
    expect(s?.userId).toBe(u.id);
    expect(s?.email).toBe("a@example.com");
    expect(s?.isAdmin).toBe(false);
    expect((await getUserById(u.id))?.lastActiveAt).toBeGreaterThan(staleActiveAt);
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

  it("returns null for an unverified password user", async () => {
    const hash = await hashPassword("correct horse battery staple");
    const u = await createUser({ email: "unverified@example.com", passwordHash: hash });
    const c = await createSessionCookie({ userId: u.id, sessionVersion: 0, secret: SECRET });
    expect(await loadSession(c.value)).toBeNull();
  });

  it("allows legacy WP.com SSO users without email_verified_at", async () => {
    const u = await createUser({
      email: "wpcom@example.com",
      passwordHash: null,
      wpcomId: "12345",
      wpcomUsername: "wpcom",
    });
    const c = await createSessionCookie({ userId: u.id, sessionVersion: 0, secret: SECRET });
    const s = await loadSession(c.value);
    expect(s?.userId).toBe(u.id);
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
    cookieJar.set(SESSION_COOKIE_NAME, c.value);

    expect(await hasSessionCookieForShell()).toBe(true);
  });

  it("returns false without a valid signed cookie", async () => {
    cookieJar.set(SESSION_COOKIE_NAME, "garbage");
    expect(await hasSessionCookieForShell()).toBe(false);
  });
});

describe("getSession", () => {
  it("accepts a legacy session cookie once and replaces it with the __Host name", async () => {
    const u = await makeUser("legacy@example.com");
    const c = await createSessionCookie({ userId: u.id, sessionVersion: 0, secret: SECRET });
    cookieJar.set(LEGACY_SESSION_COOKIE_NAME, c.value);

    const s = await getSession();

    expect(s?.userId).toBe(u.id);
    expect(cookieJar.get(SESSION_COOKIE_NAME)).toBe(c.value);
    expect(cookieJar.get(LEGACY_SESSION_COOKIE_NAME)).toBe("");
  });
});

describe("local auth mode", () => {
  it("isLocalAuthMode reads FLAVORPRESS_AUTH=local", () => {
    expect(isLocalAuthMode({ FLAVORPRESS_AUTH: "local" })).toBe(true);
    expect(isLocalAuthMode({ FLAVORPRESS_AUTH: "off" })).toBe(false);
    expect(isLocalAuthMode({})).toBe(false);
  });

  it("shows admin controls in local mode only when the debug flag is set", () => {
    const admin = { isAdmin: true };
    const writer = { isAdmin: false };
    expect(isLocalAdminDebugMode({ FLAVORPRESS_DEBUG_ADMIN: "1" })).toBe(true);
    expect(isLocalAdminDebugMode({ FLAVORPRESS_DEBUG_ADMIN: "true" })).toBe(true);
    expect(isLocalAdminDebugMode({ FLAVORPRESS_DEBUG_ADMIN: "0" })).toBe(false);
    expect(shouldShowAdminControls(admin, { FLAVORPRESS_AUTH: "local" })).toBe(false);
    expect(
      shouldShowAdminControls(admin, {
        FLAVORPRESS_AUTH: "local",
        FLAVORPRESS_DEBUG_ADMIN: "1",
      }),
    ).toBe(true);
    expect(
      shouldShowAdminControls(writer, {
        FLAVORPRESS_AUTH: "local",
        FLAVORPRESS_DEBUG_ADMIN: "1",
      }),
    ).toBe(false);
    expect(shouldShowAdminControls(admin, {})).toBe(true);
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

describe("canAccessSettings", () => {
  it("allows admins and rejects non-admin writers", () => {
    expect(canAccessSettings({ isAdmin: true })).toBe(true);
    expect(canAccessSettings({ isAdmin: false })).toBe(false);
  });
});
