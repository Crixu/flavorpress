import { randomBytes } from "node:crypto";
import { db, ensureSchema } from "../db";

export const WP_AUTHORIZE_STATE_TTL_MS = 10 * 60 * 1000;
export const WP_AUTHORIZE_STATE_COOKIE = "fp_wp_authorize_state";
export const WP_AUTHORIZE_STATE_COOKIE_TTL_SECONDS = WP_AUTHORIZE_STATE_TTL_MS / 1000;

export interface WPAuthorizeState {
  state: string;
  userId: string;
  outletId: string;
  expectedSiteUrl: string;
  expectedSiteOrigin: string;
  boundValue: string | null;
  createdAt: number;
  expiresAt: number;
}

type ConsumeResult =
  | { ok: true; value: WPAuthorizeState }
  | { ok: false; reason: "missing" | "expired" };

interface CreateWPAuthorizeStateInput {
  userId: string;
  outletId: string;
  expectedSiteUrl: string;
  boundValue?: string;
  now?: number;
}

interface StateRow {
  state: string;
  user_id: string;
  outlet_id: string;
  expected_site_url: string;
  expected_site_origin: string;
  bound_value: string | null;
  created_at: number;
  expires_at: number;
}

export function wpAuthorizeStateCookieOptions(maxAgeSec: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/api/wp/callback",
    maxAge: maxAgeSec,
  };
}

export async function createWPAuthorizeState(
  input: CreateWPAuthorizeStateInput,
): Promise<WPAuthorizeState> {
  await ensureSchema();
  const expectedSiteUrl = normalizeSiteUrl(input.expectedSiteUrl);
  if (!expectedSiteUrl) {
    throw new Error("Valid WordPress site URL required.");
  }
  const expectedSiteOrigin = siteOrigin(expectedSiteUrl);
  if (!expectedSiteOrigin) {
    throw new Error("Valid WordPress site URL required.");
  }

  const now = input.now ?? Date.now();
  const value: WPAuthorizeState = {
    state: randomBytes(32).toString("base64url"),
    userId: input.userId,
    outletId: input.outletId,
    expectedSiteUrl,
    expectedSiteOrigin,
    boundValue: input.boundValue ?? null,
    createdAt: now,
    expiresAt: now + WP_AUTHORIZE_STATE_TTL_MS,
  };

  await db.batch(
    [
      {
        sql: `DELETE FROM wp_authorize_states WHERE expires_at <= ?`,
        args: [now],
      },
      {
        sql: `INSERT INTO wp_authorize_states
              (state, user_id, outlet_id, expected_site_url, expected_site_origin, bound_value, created_at, expires_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          value.state,
          value.userId,
          value.outletId,
          value.expectedSiteUrl,
          value.expectedSiteOrigin,
          value.boundValue,
          value.createdAt,
          value.expiresAt,
        ],
      },
    ],
    "write",
  );

  return value;
}

export async function consumeWPAuthorizeState(
  state: string,
  now = Date.now(),
): Promise<ConsumeResult> {
  await ensureSchema();
  if (!state || state.length > 256) return { ok: false, reason: "missing" };

  const result = await db.execute({
    sql: `SELECT state, user_id, outlet_id, expected_site_url, expected_site_origin, bound_value, created_at, expires_at
          FROM wp_authorize_states WHERE state = ?`,
    args: [state],
  });

  if (result.rows.length === 0) return { ok: false, reason: "missing" };

  await db.execute({
    sql: `DELETE FROM wp_authorize_states WHERE state = ?`,
    args: [state],
  });

  const value = rowToState(result.rows[0] as unknown as StateRow);
  if (value.expiresAt <= now) return { ok: false, reason: "expired" };
  return { ok: true, value };
}

export function siteOrigin(raw: string): string | null {
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function normalizeSiteUrl(raw: string): string | null {
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.hash = "";
    url.search = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

function rowToState(row: StateRow): WPAuthorizeState {
  return {
    state: String(row.state),
    userId: String(row.user_id),
    outletId: String(row.outlet_id),
    expectedSiteUrl: String(row.expected_site_url),
    expectedSiteOrigin: String(row.expected_site_origin),
    boundValue: row.bound_value === null ? null : String(row.bound_value),
    createdAt: Number(row.created_at),
    expiresAt: Number(row.expires_at),
  };
}
