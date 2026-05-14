import { describe, it, expect, beforeEach, vi } from "vitest";
import type * as NextServer from "next/server";
import { db, ensureSchema } from "@/lib/db";
import { SESSION_COOKIE_NAME } from "@/lib/auth";
import {
  issueWpcomState,
  resetWpcomStateCacheForTests,
  WPCOM_OAUTH_STATE_COOKIE,
} from "@/lib/wpcom-oauth";
import { issueInvite } from "@/lib/invites";
import { hashPassword } from "@/lib/password";
import { createUser, getUserByEmail } from "@/lib/users";

let cookieJar: Map<string, string>;

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (n: string) => {
      const v = cookieJar.get(n);
      return v ? { value: v } : undefined;
    },
    set: (n: string, v: string) => {
      cookieJar.set(n, v);
    },
  }),
}));

vi.mock("next/server", async () => {
  const actual = await vi.importActual<typeof NextServer>("next/server");
  return {
    ...actual,
    after: (fn: () => unknown) => {
      void fn();
    },
  };
});

const fetchMock = vi.fn();

function mockWpcomFlow(wpcomUser: { ID: number; username: string; email: string }) {
  fetchMock
    .mockImplementationOnce(async (url: string) => {
      if (url.startsWith("https://public-api.wordpress.com/oauth2/token")) {
        return new Response(JSON.stringify({ access_token: "fake-token" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    })
    .mockImplementationOnce(async (url: string) => {
      if (url.startsWith("https://public-api.wordpress.com/rest/v1.1/me")) {
        return new Response(JSON.stringify(wpcomUser), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
}

beforeEach(async () => {
  await ensureSchema();
  await db.execute("DELETE FROM users");
  await db.execute("DELETE FROM invites");
  cookieJar = new Map();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  process.env.FLAVORPRESS_SESSION_SECRET = "test-secret-that-is-at-least-32-bytes-long!!";
  process.env.WPCOM_OAUTH_CLIENT_ID = "test-client";
  process.env.WPCOM_OAUTH_CLIENT_SECRET = "test-secret";
  process.env.FLAVORPRESS_ORIGIN = "http://localhost:3000";
  delete process.env.FLAVORPRESS_ADMIN_EMAIL;
  resetWpcomStateCacheForTests();
});

async function call(state: string, code: string): Promise<Response> {
  const { GET } = await import("@/app/api/auth/wpcom/callback/route");
  const url = `http://localhost:3000/api/auth/wpcom/callback?state=${encodeURIComponent(state)}&code=${encodeURIComponent(code)}`;
  return GET(new Request(url));
}

async function stateWithCookie(opts: {
  nonce: string;
  mode: "signup" | "login";
  invite?: string;
}): Promise<string> {
  cookieJar.set(WPCOM_OAUTH_STATE_COOKIE, opts.nonce);
  return issueWpcomState(opts);
}

describe("wpcom callback signup", () => {
  it("creates a user from WP.com identity on valid invite", async () => {
    const { token: invite } = await issueInvite({});
    const state = await stateWithCookie({ nonce: "n_signup", mode: "signup", invite });
    mockWpcomFlow({ ID: 12345, username: "lucas", email: "lucas@wordpress.test" });

    const res = await call(state, "fake-code");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("http://localhost:3000/");
    const u = await getUserByEmail("lucas@wordpress.test");
    expect(u).not.toBeNull();
    expect(u?.wpcomId).toBe("12345");
    expect(u?.wpcomUsername).toBe("lucas");
    expect(u?.emailVerifiedAt).not.toBeNull();
    expect(cookieJar.get(SESSION_COOKIE_NAME)).toMatch(/^v2\./);
    expect(cookieJar.get(WPCOM_OAUTH_STATE_COOKIE)).toBe("");
  });

  it("redirects to generic check-email on email collision without leaking existence", async () => {
    await createUser({
      email: "lucas@wordpress.test",
      passwordHash: await hashPassword("the existing password long"),
    });
    const { token: invite } = await issueInvite({});
    const state = await stateWithCookie({ nonce: "n_collide", mode: "signup", invite });
    mockWpcomFlow({ ID: 12345, username: "lucas", email: "lucas@wordpress.test" });
    const res = await call(state, "fake-code");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("http://localhost:3000/signup/check-email");
    const r = await db.execute("SELECT COUNT(*) AS n FROM users");
    expect(Number(r.rows[0]!.n)).toBe(1);
  });

  it("rejects missing invite on signup", async () => {
    const state = await stateWithCookie({ nonce: "n_no_invite", mode: "signup" });
    mockWpcomFlow({ ID: 12345, username: "lucas", email: "lucas@wordpress.test" });
    const res = await call(state, "fake-code");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toMatch(/\/signup\?.*error=invite/);
  });
});

describe("wpcom callback login", () => {
  it("logs in an existing wpcom_id user", async () => {
    await db.execute({
      sql: `INSERT INTO users (id, email, status, is_admin, session_version, wpcom_id, wpcom_username, email_verified_at, created_at)
            VALUES ('u_known', 'known@wp.test', 'active', 0, 0, '99999', 'known', ?, ?)`,
      args: [Date.now(), Date.now()],
    });
    const state = await stateWithCookie({ nonce: "n_login", mode: "login" });
    mockWpcomFlow({ ID: 99999, username: "known", email: "known@wp.test" });
    const res = await call(state, "fake-code");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("http://localhost:3000/");
    expect(cookieJar.get(SESSION_COOKIE_NAME)).toMatch(/^v2\./);
  });

  it("rejects login with unknown wpcom_id", async () => {
    const state = await stateWithCookie({ nonce: "n_unknown", mode: "login" });
    mockWpcomFlow({ ID: 77777, username: "stranger", email: "stranger@wp.test" });
    const res = await call(state, "fake-code");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toMatch(/\/login\?error=credentials/);
  });
});

describe("wpcom callback invalid", () => {
  it("rejects an unsigned/invalid state", async () => {
    cookieJar.set(WPCOM_OAUTH_STATE_COOKIE, "n_invalid");
    const res = await call("totally-bogus", "fake-code");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toMatch(/error=oauth_state/);
  });

  it("rejects a valid state without the per-browser nonce cookie", async () => {
    const state = await issueWpcomState({ nonce: "n_missing_cookie", mode: "login" });
    const res = await call(state, "fake-code");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toMatch(/error=oauth_state/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a valid state with a mismatched nonce cookie", async () => {
    const state = await issueWpcomState({ nonce: "n_state", mode: "login" });
    cookieJar.set(WPCOM_OAUTH_STATE_COOKIE, "n_other_browser");
    const res = await call(state, "fake-code");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toMatch(/error=oauth_state/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects replay after a valid callback consumes the state", async () => {
    await db.execute({
      sql: `INSERT INTO users (id, email, status, is_admin, session_version, wpcom_id, wpcom_username, email_verified_at, created_at)
            VALUES ('u_replay', 'replay@wp.test', 'active', 0, 0, '88888', 'replay', ?, ?)`,
      args: [Date.now(), Date.now()],
    });
    const state = await stateWithCookie({ nonce: "n_replay", mode: "login" });
    mockWpcomFlow({ ID: 88888, username: "replay", email: "replay@wp.test" });
    const first = await call(state, "fake-code");
    expect(first.headers.get("location")).toBe("http://localhost:3000/");

    cookieJar.set(WPCOM_OAUTH_STATE_COOKIE, "n_replay");
    const second = await call(state, "fake-code");
    expect(second.status).toBe(302);
    expect(second.headers.get("location")).toMatch(/error=oauth_state/);
  });
});
