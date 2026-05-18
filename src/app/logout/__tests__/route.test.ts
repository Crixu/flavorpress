import { beforeEach, describe, expect, it, vi } from "vitest";

interface CookieOptions {
  httpOnly?: boolean;
  sameSite?: "lax" | "strict" | "none";
  secure?: boolean;
  path?: string;
  maxAge?: number;
  expires?: Date;
}

const { cookieJar, cookieOptions } = vi.hoisted(() => ({
  cookieJar: new Map<string, string>(),
  cookieOptions: new Map<string, CookieOptions>(),
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = cookieJar.get(name);
      return value ? { value } : undefined;
    },
    set: (name: string, value: string, options?: CookieOptions) => {
      cookieJar.set(name, value);
      if (options) cookieOptions.set(name, options);
    },
  }),
  headers: async () => ({
    get: (name: string) => {
      if (name === "origin") return "http://localhost:3000";
      if (name === "x-forwarded-host") return "localhost:3000";
      return null;
    },
  }),
}));

import { createSessionCookie, LEGACY_SESSION_COOKIE_NAME, SESSION_COOKIE_NAME } from "@/lib/auth";
import { db, ensureSchema } from "@/lib/db";
import { loadSession } from "@/lib/session";
import { createUser, getUserById } from "@/lib/users";

const SECRET = "test-secret-that-is-at-least-32-bytes-long!!";

beforeEach(async () => {
  await ensureSchema();
  await db.execute("DELETE FROM users");
  cookieJar.clear();
  cookieOptions.clear();
  process.env.FLAVORPRESS_SESSION_SECRET = SECRET;
});

describe("POST /logout", () => {
  it("invalidates a cloned session cookie server-side", async () => {
    const user = await createUser({ email: "a@example.com", passwordHash: null });
    const session = await createSessionCookie({
      userId: user.id,
      sessionVersion: user.sessionVersion,
      secret: SECRET,
    });
    cookieJar.set(SESSION_COOKIE_NAME, session.value);

    const { POST } = await import("@/app/logout/route");
    const res = await POST();

    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("http://localhost:3000/login");
    expect(cookieJar.get(SESSION_COOKIE_NAME)).toBe("");
    expect(cookieJar.get(LEGACY_SESSION_COOKIE_NAME)).toBe("");
    expect(cookieOptions.get(SESSION_COOKIE_NAME)).toMatchObject({
      httpOnly: true,
      sameSite: "lax",
      secure: true,
      path: "/",
      maxAge: 0,
    });
    expect(await loadSession(session.value)).toBeNull();

    const after = await getUserById(user.id);
    expect(after?.sessionVersion).toBe(user.sessionVersion + 1);
  });

  it("allows repeat logout without bumping again", async () => {
    const user = await createUser({ email: "repeat@example.com", passwordHash: null });
    const session = await createSessionCookie({
      userId: user.id,
      sessionVersion: user.sessionVersion,
      secret: SECRET,
    });
    cookieJar.set(SESSION_COOKIE_NAME, session.value);

    const { POST } = await import("@/app/logout/route");
    await POST();
    cookieJar.set(SESSION_COOKIE_NAME, session.value);
    await POST();

    const after = await getUserById(user.id);
    expect(after?.sessionVersion).toBe(user.sessionVersion + 1);
  });

  it("only bumps once for concurrent logout attempts with the same cookie version", async () => {
    const user = await createUser({ email: "concurrent@example.com", passwordHash: null });
    const session = await createSessionCookie({
      userId: user.id,
      sessionVersion: user.sessionVersion,
      secret: SECRET,
    });
    cookieJar.set(SESSION_COOKIE_NAME, session.value);

    const { POST } = await import("@/app/logout/route");
    const [first, second] = await Promise.all([POST(), POST()]);

    expect(first.status).toBe(303);
    expect(second.status).toBe(303);
    const after = await getUserById(user.id);
    expect(after?.sessionVersion).toBe(user.sessionVersion + 1);
  });
});
