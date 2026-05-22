import { describe, it, expect, beforeEach, vi } from "vitest";
import { db, ensureSchema } from "@/lib/db";
import { createSessionCookie, SESSION_COOKIE_NAME } from "@/lib/auth";
import { hashPassword } from "@/lib/password";
import { rateLimitKey } from "@/lib/rate-limit";
import { createUser, setStatus } from "@/lib/users";

let cookieJar: Map<string, string>;
let cookieOptions: Map<string, CookieOptions>;
let forwardedFor = "198.51.100.1";
let ipCounter = 1;

interface CookieOptions {
  httpOnly?: boolean;
  sameSite?: "lax" | "strict" | "none";
  secure?: boolean;
  path?: string;
  maxAge?: number;
  expires?: Date;
  domain?: string;
}

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const v = cookieJar.get(name);
      return v ? { value: v } : undefined;
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
      if (name === "x-forwarded-for") return forwardedFor;
      return null;
    },
  }),
}));

const redirectCalls: { url: string }[] = [];
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    redirectCalls.push({ url });
    throw new Error(`__REDIRECT__:${url}`);
  },
}));

beforeEach(async () => {
  await ensureSchema();
  await db.execute("DELETE FROM users");
  await db.execute("DELETE FROM rate_buckets");
  cookieJar = new Map();
  cookieOptions = new Map();
  forwardedFor = `198.51.100.${ipCounter}`;
  ipCounter += 1;
  redirectCalls.length = 0;
  process.env.FLAVORPRESS_SESSION_SECRET = "test-secret-that-is-at-least-32-bytes-long!!";
  process.env.FLAVORPRESS_ALLOWED_ORIGINS = "http://localhost:3000";
});

async function callLogin(form: Record<string, string>): Promise<string> {
  const { loginAction } = await import("@/app/login/actions");
  const formData = new FormData();
  for (const [k, v] of Object.entries(form)) formData.set(k, v);
  try {
    await loginAction(formData);
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("__REDIRECT__:")) {
      return err.message.slice("__REDIRECT__:".length);
    }
    throw err;
  }
  return "";
}

describe("loginAction", () => {
  it("happy path issues a session cookie", async () => {
    const hash = await hashPassword("correct horse battery staple");
    await createUser({
      email: "a@example.com",
      passwordHash: hash,
      emailVerifiedAt: Date.now(),
    });
    const to = await callLogin({
      email: "a@example.com",
      password: "correct horse battery staple",
    });
    expect(to).toBe("/");
    expect(cookieJar.get(SESSION_COOKIE_NAME)).toMatch(/^v2\./);
    expect(cookieOptions.get(SESSION_COOKIE_NAME)).toMatchObject({
      httpOnly: true,
      sameSite: "lax",
      secure: true,
      path: "/",
    });
    expect(cookieOptions.get(SESSION_COOKIE_NAME)).not.toHaveProperty("domain");
  });

  it("rejects wrong password", async () => {
    const hash = await hashPassword("correct horse battery staple");
    await createUser({
      email: "a@example.com",
      passwordHash: hash,
      emailVerifiedAt: Date.now(),
    });
    const to = await callLogin({
      email: "a@example.com",
      password: "wrong-but-long-enough",
    });
    expect(to).toMatch(/error=credentials/);
    expect(cookieJar.get(SESSION_COOKIE_NAME)).toBeUndefined();
  });

  it("rejects unknown email with the same error code (no enumeration)", async () => {
    const to = await callLogin({
      email: "ghost@example.com",
      password: "correct horse battery staple",
    });
    expect(to).toMatch(/error=credentials/);
  });

  it("rejects suspended user with the same error code", async () => {
    const hash = await hashPassword("correct horse battery staple");
    const u = await createUser({
      email: "a@example.com",
      passwordHash: hash,
      emailVerifiedAt: Date.now(),
    });
    await setStatus(u.id, "suspended");
    const to = await callLogin({
      email: "a@example.com",
      password: "correct horse battery staple",
    });
    expect(to).toMatch(/error=credentials/);
  });

  it("issues a cookie carrying the current session_version", async () => {
    const hash = await hashPassword("correct horse battery staple");
    const u = await createUser({
      email: "a@example.com",
      passwordHash: hash,
      emailVerifiedAt: Date.now(),
    });
    await db.execute({
      sql: "UPDATE users SET session_version = 5 WHERE id = ?",
      args: [u.id],
    });
    await callLogin({
      email: "a@example.com",
      password: "correct horse battery staple",
    });
    const cookieValue = cookieJar.get(SESSION_COOKIE_NAME);
    const parts = (cookieValue ?? "").split(".");
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    expect(payload.v).toBe(5);
    expect(payload.sub).toBe(u.id);
  });

  it("rejects an unverified password user", async () => {
    const hash = await hashPassword("correct horse battery staple");
    await createUser({ email: "a@example.com", passwordHash: hash });
    const to = await callLogin({
      email: "a@example.com",
      password: "correct horse battery staple",
    });
    expect(to).toMatch(/error=credentials/);
    expect(cookieJar.get(SESSION_COOKIE_NAME)).toBeUndefined();
  });

  it("rate-limits login when the IP bucket is exhausted", async () => {
    await seedExhaustedBucket("login", rateLimitKey("ip", forwardedFor));

    const limited = await callLogin({
      email: "ghost@example.com",
      password: "correct horse battery staple",
    });
    expect(limited).toMatch(/error=rate/);
  });

  it("rate-limits unknown accounts by normalized submitted email before the IP bucket", async () => {
    await seedExhaustedBucket("login", rateLimitKey("account", "ghost@example.com"));

    const limited = await callLogin({
      email: " Ghost@Example.COM ",
      password: "correct horse battery staple",
    });
    expect(limited).toMatch(/error=rate/);
  });

  it("bumps session_version after five consecutive failures for a real account", async () => {
    const hash = await hashPassword("correct horse battery staple");
    const u = await createUser({
      email: "a@example.com",
      passwordHash: hash,
      emailVerifiedAt: Date.now(),
    });

    for (let i = 0; i < 5; i += 1) {
      const to = await callLogin({
        email: "a@example.com",
        password: "wrong-but-long-enough",
      });
      expect(to).toMatch(/error=credentials/);
    }

    const after = await db.execute({
      sql: "SELECT session_version FROM users WHERE id = ?",
      args: [u.id],
    });
    expect(Number(after.rows[0]!.session_version)).toBe(1);
    await seedExhaustedBucket("login", rateLimitKey("account", "a@example.com"));

    const limited = await callLogin({
      email: "a@example.com",
      password: "wrong-but-long-enough",
    });
    expect(limited).toMatch(/error=rate/);
  });
});

describe("LoginPage", () => {
  it("redirects an already signed-in user away from the sign-in form", async () => {
    const user = await createUser({ email: "signed-in@example.com", passwordHash: null });
    const session = await createSessionCookie({
      userId: user.id,
      sessionVersion: user.sessionVersion,
      secret: process.env.FLAVORPRESS_SESSION_SECRET,
    });
    cookieJar.set(SESSION_COOKIE_NAME, session.value);

    const { default: LoginPage } = await import("@/app/login/page");

    await expect(LoginPage({ searchParams: Promise.resolve({ next: "/drafts" }) })).rejects.toThrow(
      "__REDIRECT__:/drafts",
    );
  });

  it("does not redirect a signed-in user back to /login", async () => {
    const user = await createUser({ email: "loop@example.com", passwordHash: null });
    const session = await createSessionCookie({
      userId: user.id,
      sessionVersion: user.sessionVersion,
      secret: process.env.FLAVORPRESS_SESSION_SECRET,
    });
    cookieJar.set(SESSION_COOKIE_NAME, session.value);

    const { default: LoginPage } = await import("@/app/login/page");

    await expect(
      LoginPage({ searchParams: Promise.resolve({ next: "/login?error=credentials" }) }),
    ).rejects.toThrow("__REDIRECT__:/");
  });
});

async function seedExhaustedBucket(scope: string, key: string): Promise<void> {
  await db.execute({
    sql: `INSERT INTO rate_buckets (scope, key, tokens, refilled_at)
          VALUES (?, ?, 0, ?)
          ON CONFLICT(scope, key) DO UPDATE SET
            tokens = excluded.tokens,
            refilled_at = excluded.refilled_at`,
    args: [scope, key, Math.floor(Date.now() / 60_000) * 60_000],
  });
}
