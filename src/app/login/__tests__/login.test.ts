import { describe, it, expect, beforeEach, vi } from "vitest";
import { db, ensureSchema } from "@/lib/db";
import { SESSION_COOKIE_NAME } from "@/lib/auth";
import { hashPassword } from "@/lib/password";
import { createUser, setStatus } from "@/lib/users";

let cookieJar: Map<string, string>;
let cookieOptions: Map<string, CookieOptions>;

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
  cookieJar = new Map();
  cookieOptions = new Map();
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
    await createUser({ email: "a@example.com", passwordHash: hash });
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
    await createUser({ email: "a@example.com", passwordHash: hash });
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
    const u = await createUser({ email: "a@example.com", passwordHash: hash });
    await setStatus(u.id, "suspended");
    const to = await callLogin({
      email: "a@example.com",
      password: "correct horse battery staple",
    });
    expect(to).toMatch(/error=credentials/);
  });

  it("issues a cookie carrying the current session_version", async () => {
    const hash = await hashPassword("correct horse battery staple");
    const u = await createUser({ email: "a@example.com", passwordHash: hash });
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
});
