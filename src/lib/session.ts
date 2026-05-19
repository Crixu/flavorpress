import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import {
  LEGACY_SESSION_COOKIE_NAME,
  SESSION_COOKIE_NAME,
  getSessionTtlSeconds,
  verifySessionCookie,
} from "./auth";
import { assertLocalAuthNotVercelProduction } from "./env-guards";
import { createUser, getUserById, touchUserActiveDay } from "./users";

assertLocalAuthNotVercelProduction();

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

export function isLocalAdminDebugMode(env: EnvLike = process.env): boolean {
  const value = (env.FLAVORPRESS_DEBUG_ADMIN ?? "").trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}

export function shouldShowAdminControls(
  session: Pick<Session, "isAdmin">,
  env: EnvLike = process.env,
): boolean {
  if (!session.isAdmin) return false;
  if (!isLocalAuthMode(env)) return true;
  return isLocalAdminDebugMode(env);
}

export function canAccessSettings(session: Pick<Session, "isAdmin">): boolean {
  return session.isAdmin;
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
  await touchUserActiveDay(user.id, now);
  return {
    userId: user.id,
    email: user.email,
    isAdmin: true,
    issuedAt: now,
    expiresAt: now + 365 * 24 * 60 * 60 * 1000,
  };
}

async function loadSessionUncached(
  cookieValue: string | null | undefined,
): Promise<Session | null> {
  if (isLocalAuthMode()) return ensureLocalBootstrapSession();
  if (!cookieValue) return null;
  const verified = await verifySessionCookie(cookieValue);
  if (!verified) return null;
  const user = await getUserById(verified.userId);
  if (!user) return null;
  if (user.status !== "active") return null;
  if (user.sessionVersion !== verified.sessionVersion) return null;
  if (user.passwordHash && user.emailVerifiedAt == null) return null;
  await touchUserActiveDay(user.id);
  return {
    userId: user.id,
    email: user.email,
    isAdmin: user.isAdmin,
    issuedAt: verified.issuedAt,
    expiresAt: verified.expiresAt,
  };
}

export const loadSession = cache(loadSessionUncached);

async function readSessionCookieValue(migrateLegacy: boolean): Promise<string | null> {
  const cookieStore = await cookies();
  const current = cookieStore.get(SESSION_COOKIE_NAME)?.value ?? null;
  if (current) return current;

  const legacy = cookieStore.get(LEGACY_SESSION_COOKIE_NAME)?.value ?? null;
  if (!legacy || !migrateLegacy) return legacy;

  const verified = await verifySessionCookie(legacy);
  if (!verified) return legacy;

  try {
    cookieStore.set(SESSION_COOKIE_NAME, legacy, {
      httpOnly: true,
      sameSite: "lax",
      secure: true,
      path: "/",
      maxAge: getSessionTtlSeconds(),
      expires: new Date(verified.expiresAt),
    });
    cookieStore.set(LEGACY_SESSION_COOKIE_NAME, "", {
      httpOnly: true,
      sameSite: "lax",
      secure: true,
      path: "/",
      maxAge: 0,
      expires: new Date(0),
    });
  } catch {
    // Some read-only render paths cannot mutate cookies. They still accept
    // the legacy cookie for this release.
  }

  return legacy;
}

export async function getSession(): Promise<Session | null> {
  if (isLocalAuthMode()) return loadSession(null);
  const value = await readSessionCookieValue(true);
  return loadSession(value);
}

export async function hasSessionCookieForShell(): Promise<boolean> {
  if (isLocalAuthMode()) return true;
  const value = await readSessionCookieValue(false);
  return Boolean(await verifySessionCookie(value));
}

export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session) throw new AuthRequiredError();
  return session;
}
