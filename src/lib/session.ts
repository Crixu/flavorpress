import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { SESSION_COOKIE_NAME, verifySessionCookie } from "./auth";
import { createUser, getUserById } from "./users";

export class AuthRequiredError extends Error {
  constructor() {
    super("Authentication required.");
    this.name = "AuthRequiredError";
  }
}

export interface Session {
  userId: string;
  email: string;
  isAdmin: boolean;
  issuedAt: number;
  expiresAt: number;
}

/**
 * Local-mode bootstrap. When `FLAVORPRESS_AUTH=local` is set (used by the
 * macOS app and as a dev convenience), every request resolves to a fixed
 * admin user id. The id is `default-user` so that any pre-existing
 * single-user data on disk continues to work without an explicit migration.
 */
const LOCAL_BOOTSTRAP_USER_ID = "default-user";

type EnvLike = Record<string, string | undefined>;

export function isLocalAuthMode(env: EnvLike = process.env): boolean {
  return env.FLAVORPRESS_AUTH === "local";
}

function localBootstrapEmail(env: EnvLike = process.env): string {
  return (env.FLAVORPRESS_LOCAL_EMAIL ?? "local@flavorpress.app").trim().toLowerCase();
}

async function ensureLocalBootstrapSession(): Promise<Session> {
  let user = await getUserById(LOCAL_BOOTSTRAP_USER_ID);
  if (!user) {
    await createUser({
      id: LOCAL_BOOTSTRAP_USER_ID,
      email: localBootstrapEmail(),
      passwordHash: null,
      isAdmin: true,
    });
    user = await getUserById(LOCAL_BOOTSTRAP_USER_ID);
    if (!user) throw new Error("Failed to bootstrap local user.");
  }
  const now = Date.now();
  return {
    userId: user.id,
    email: user.email,
    isAdmin: true,
    issuedAt: now,
    expiresAt: now + 365 * 24 * 60 * 60 * 1000,
  };
}

async function loadSessionUncached(cookieValue: string | null | undefined): Promise<Session | null> {
  if (isLocalAuthMode()) return ensureLocalBootstrapSession();
  if (!cookieValue) return null;
  const verified = await verifySessionCookie(cookieValue);
  if (!verified) return null;
  const user = await getUserById(verified.userId);
  if (!user) return null;
  if (user.status !== "active") return null;
  if (user.sessionVersion !== verified.sessionVersion) return null;
  return {
    userId: user.id,
    email: user.email,
    isAdmin: user.isAdmin,
    issuedAt: verified.issuedAt,
    expiresAt: verified.expiresAt,
  };
}

export const loadSession = cache(loadSessionUncached);

export async function getSession(): Promise<Session | null> {
  if (isLocalAuthMode()) return loadSession(null);
  const cookieStore = await cookies();
  const value = cookieStore.get(SESSION_COOKIE_NAME)?.value ?? null;
  return loadSession(value);
}

export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session) throw new AuthRequiredError();
  return session;
}
