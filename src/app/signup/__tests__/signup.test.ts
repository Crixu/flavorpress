import { describe, it, expect, beforeEach, vi } from "vitest";
import { db, ensureSchema } from "@/lib/db";
import { issueInvite, readInvite } from "@/lib/invites";
import { getUserPlan } from "@/lib/plans";
import { getUserByEmail } from "@/lib/users";
import { SESSION_COOKIE_NAME } from "@/lib/auth";
import { rateLimitKey } from "@/lib/rate-limit";

let cookieJar: Map<string, string>;
let forwardedFor = "198.51.104.1";
let ipCounter = 1;

vi.mock("next/headers", () => {
  return {
    cookies: async () => ({
      get: (name: string) => {
        const v = cookieJar.get(name);
        return v ? { value: v } : undefined;
      },
      set: (name: string, value: string) => {
        cookieJar.set(name, value);
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
  };
});

const redirectCalls: { url: string }[] = [];
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    redirectCalls.push({ url });
    throw new Error(`__REDIRECT__:${url}`);
  },
}));

vi.mock("next/server", () => ({
  after: (fn: () => unknown) => {
    void fn();
  },
}));

const emailMock = vi.hoisted(() => ({
  sendCalls: [] as { to: string; subject: string }[],
  shouldFail: false,
}));
vi.mock("@/lib/email", async () => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  type EmailModule = typeof import("@/lib/email");
  const actual = await vi.importActual<EmailModule>("@/lib/email");
  return {
    ...actual,
    sendEmail: async (msg: { to: string; subject: string; html: string; text: string }) => {
      if (emailMock.shouldFail) throw new Error("email provider unavailable");
      emailMock.sendCalls.push({ to: msg.to, subject: msg.subject });
    },
  };
});

beforeEach(async () => {
  await ensureSchema();
  await db.execute("DELETE FROM user_plans");
  await db.execute("DELETE FROM users");
  await db.execute("DELETE FROM invites");
  await db.execute("DELETE FROM email_verification_tokens");
  await db.execute("DELETE FROM deployment_state");
  await db.execute("DELETE FROM rate_buckets");
  cookieJar = new Map();
  forwardedFor = `198.51.104.${ipCounter}`;
  ipCounter += 1;
  redirectCalls.length = 0;
  emailMock.sendCalls.length = 0;
  emailMock.shouldFail = false;
  process.env.FLAVORPRESS_SESSION_SECRET = "test-secret-that-is-at-least-32-bytes-long!!";
  process.env.FLAVORPRESS_ALLOWED_ORIGINS = "http://localhost:3000";
});

async function callSignup(form: Record<string, string>): Promise<string> {
  const { signupAction } = await import("@/app/signup/actions");
  const formData = new FormData();
  for (const [k, v] of Object.entries(form)) formData.set(k, v);
  try {
    await signupAction(formData);
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("__REDIRECT__:")) {
      return err.message.slice("__REDIRECT__:".length);
    }
    throw err;
  }
  return "";
}

describe("signupAction", () => {
  it("creates a user on the happy path", async () => {
    const { token } = await issueInvite({});
    const to = await callSignup({
      invite: token,
      email: "a@example.com",
      password: "correct horse battery staple",
    });
    expect(to).toBe("/signup/check-email");
    const u = await getUserByEmail("a@example.com");
    expect(u?.email).toBe("a@example.com");
    expect(u?.emailVerifiedAt).toBeNull();
    expect(cookieJar.get(SESSION_COOKIE_NAME)).toBeUndefined();
    const after = await readInvite(token);
    expect(after).toBeNull();
  });

  it("applies the invite plan to the new user", async () => {
    const { token } = await issueInvite({ plan: "pro" });
    await callSignup({
      invite: token,
      email: "pro@example.com",
      password: "correct horse battery staple",
    });
    const u = await getUserByEmail("pro@example.com");
    expect(u).not.toBeNull();
    const plan = await getUserPlan(u!.id);
    expect(plan.plan).toBe("pro");
  });

  it("rejects missing invite", async () => {
    const to = await callSignup({
      invite: "",
      email: "a@example.com",
      password: "correct horse battery staple",
    });
    expect(to).toMatch(/\/signup\?.*error=invite/);
  });

  it("rejects expired invite", async () => {
    const { token } = await issueInvite({ expiresAt: Date.now() - 1000 });
    const to = await callSignup({
      invite: token,
      email: "a@example.com",
      password: "correct horse battery staple",
    });
    expect(to).toMatch(/error=invite/);
  });

  it("rejects weak password", async () => {
    const { token } = await issueInvite({});
    const to = await callSignup({
      invite: token,
      email: "a@example.com",
      password: "short",
    });
    expect(to).toMatch(/error=password/);
  });

  it("returns generic check-email on duplicate email without leaking existence", async () => {
    const t1 = (await issueInvite({})).token;
    await callSignup({
      invite: t1,
      email: "a@example.com",
      password: "correct horse battery staple",
    });
    const t2 = (await issueInvite({})).token;
    const to = await callSignup({
      invite: t2,
      email: "a@example.com",
      password: "correct horse battery staple",
    });
    expect(to).toBe("/signup/check-email");
    const remaining = await readInvite(t2);
    expect(remaining).not.toBeNull();
  });

  it("promotes the first signup to admin", async () => {
    const { token } = await issueInvite({});
    await callSignup({
      invite: token,
      email: "first@example.com",
      password: "correct horse battery staple",
    });
    const u = await getUserByEmail("first@example.com");
    expect(u?.isAdmin).toBe(true);
  });

  it("does not promote subsequent admins", async () => {
    const t1 = (await issueInvite({})).token;
    await callSignup({
      invite: t1,
      email: "first@example.com",
      password: "correct horse battery staple",
    });
    const t2 = (await issueInvite({})).token;
    await callSignup({
      invite: t2,
      email: "second@example.com",
      password: "correct horse battery staple",
    });
    const v = await getUserByEmail("second@example.com");
    expect(v?.isAdmin).toBe(false);
  });

  it("does not re-key default-user during signup", async () => {
    await db.execute({
      sql: `INSERT INTO users (id, email, status, is_admin, session_version, created_at)
            VALUES ('default-user', 'you@flavorpress.local', 'active', 0, 0, ?)`,
      args: [Date.now()],
    });
    await db.execute({
      sql: `INSERT INTO outlets (id, user_id, base_url, display_name, created_at)
            VALUES ('o_seed', 'default-user', 'https://x.test', 'X', ?)`,
      args: [Date.now()],
    });
    const { token } = await issueInvite({});
    await callSignup({
      invite: token,
      email: "lucas@example.com",
      password: "correct horse battery staple",
    });
    const o = await db.execute({ sql: "SELECT user_id FROM outlets WHERE id = 'o_seed'" });
    expect(String(o.rows[0]?.user_id)).toBe("default-user");
    const orphan = await db.execute({ sql: "SELECT 1 FROM users WHERE id = 'default-user'" });
    expect(orphan.rows.length).toBe(1);
  });

  it("sends a verification email on successful signup", async () => {
    const { token } = await issueInvite({});
    await callSignup({
      invite: token,
      email: "verify@example.com",
      password: "correct horse battery staple",
    });
    expect(emailMock.sendCalls).toHaveLength(1);
    expect(emailMock.sendCalls[0]!.to).toBe("verify@example.com");
    expect(emailMock.sendCalls[0]!.subject).toMatch(/verify/i);
  });

  it("rate-limits signup by IP before consuming the invite or sending verification", async () => {
    const { token } = await issueInvite({});
    await seedExhaustedBucket("signup", rateLimitKey("ip", forwardedFor));

    const to = await callSignup({
      invite: token,
      email: "rate@example.com",
      password: "correct horse battery staple",
    });

    expect(to).toMatch(/\/signup\?.*error=rate/);
    expect(await readInvite(token)).not.toBeNull();
    expect(await getUserByEmail("rate@example.com")).toBeNull();
    expect(emailMock.sendCalls).toHaveLength(0);
    const tokens = await db.execute("SELECT COUNT(*) AS n FROM email_verification_tokens");
    expect(Number(tokens.rows[0]!.n)).toBe(0);
  });

  it("rolls back signup when the verification email cannot be sent", async () => {
    emailMock.shouldFail = true;
    const { token } = await issueInvite({});
    const to = await callSignup({
      invite: token,
      email: "failed-send@example.com",
      password: "correct horse battery staple",
    });

    expect(to).toMatch(/error=account/);
    expect(await getUserByEmail("failed-send@example.com")).toBeNull();
    expect(await readInvite(token)).not.toBeNull();
    const plans = await db.execute("SELECT COUNT(*) AS n FROM user_plans");
    expect(Number(plans.rows[0]!.n)).toBe(0);
    const tokens = await db.execute("SELECT COUNT(*) AS n FROM email_verification_tokens");
    expect(Number(tokens.rows[0]!.n)).toBe(0);
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
