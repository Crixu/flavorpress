import { describe, it, expect, beforeEach, vi } from "vitest";
import { db, ensureSchema } from "@/lib/db";
import { issueInvite, readInvite } from "@/lib/invites";
import { getUserByEmail } from "@/lib/users";

let cookieJar: Map<string, string>;

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

const emailSendCalls: { to: string; subject: string }[] = [];
vi.mock("@/lib/email", async () => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  type EmailModule = typeof import("@/lib/email");
  const actual = await vi.importActual<EmailModule>("@/lib/email");
  return {
    ...actual,
    sendEmail: async (msg: { to: string; subject: string; html: string; text: string }) => {
      emailSendCalls.push({ to: msg.to, subject: msg.subject });
    },
  };
});

beforeEach(async () => {
  await ensureSchema();
  await db.execute("DELETE FROM users");
  await db.execute("DELETE FROM invites");
  await db.execute("DELETE FROM email_verification_tokens");
  cookieJar = new Map();
  redirectCalls.length = 0;
  emailSendCalls.length = 0;
  process.env.FLAVORPRESS_SESSION_SECRET = "test-secret-that-is-at-least-32-bytes-long!!";
  process.env.FLAVORPRESS_ALLOWED_ORIGINS = "http://localhost:3000";
  delete process.env.FLAVORPRESS_ADMIN_EMAIL;
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
    expect(to).toBe("/");
    const u = await getUserByEmail("a@example.com");
    expect(u?.email).toBe("a@example.com");
    const after = await readInvite(token);
    expect(after).toBeNull();
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

  it("rejects duplicate email", async () => {
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
    expect(to).toMatch(/error=account/);
  });

  it("promotes admin on first signup matching FLAVORPRESS_ADMIN_EMAIL", async () => {
    process.env.FLAVORPRESS_ADMIN_EMAIL = "lucas@example.com";
    const { token } = await issueInvite({});
    await callSignup({
      invite: token,
      email: "lucas@example.com",
      password: "correct horse battery staple",
    });
    const u = await getUserByEmail("lucas@example.com");
    expect(u?.isAdmin).toBe(true);
  });

  it("does not promote subsequent admins", async () => {
    process.env.FLAVORPRESS_ADMIN_EMAIL = "lucas@example.com";
    const t1 = (await issueInvite({})).token;
    await callSignup({
      invite: t1,
      email: "lucas@example.com",
      password: "correct horse battery staple",
    });
    const t2 = (await issueInvite({})).token;
    await callSignup({
      invite: t2,
      email: "lucas@example.com.attacker",
      password: "correct horse battery staple",
    });
    const v = await getUserByEmail("lucas@example.com.attacker");
    expect(v?.isAdmin).toBe(false);
  });

  it("re-keys default-user when admin signs up and default-user exists", async () => {
    process.env.FLAVORPRESS_ADMIN_EMAIL = "lucas@example.com";
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
    const u = await getUserByEmail("lucas@example.com");
    const o = await db.execute({ sql: "SELECT user_id FROM outlets WHERE id = 'o_seed'" });
    expect(String(o.rows[0]?.user_id)).toBe(u?.id);
    const orphan = await db.execute({ sql: "SELECT 1 FROM users WHERE id = 'default-user'" });
    expect(orphan.rows.length).toBe(0);
  });

  it("sends a verification email on successful signup", async () => {
    const { token } = await issueInvite({});
    await callSignup({
      invite: token,
      email: "verify@example.com",
      password: "correct horse battery staple",
    });
    expect(emailSendCalls).toHaveLength(1);
    expect(emailSendCalls[0]!.to).toBe("verify@example.com");
    expect(emailSendCalls[0]!.subject).toMatch(/verify/i);
  });
});
