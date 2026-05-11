import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { SESSION_COOKIE_NAME, verifySessionCookie } from "./auth";
import { getUserById } from "./users";

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

async function loadSessionUncached(cookieValue: string | null | undefined): Promise<Session | null> {
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
  const cookieStore = await cookies();
  const value = cookieStore.get(SESSION_COOKIE_NAME)?.value ?? null;
  return loadSession(value);
}

export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session) throw new AuthRequiredError();
  return session;
}
