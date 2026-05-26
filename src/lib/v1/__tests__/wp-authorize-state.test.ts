import { beforeEach, describe, expect, it } from "vitest";
import { db, ensureSchema } from "@/lib/db";
import {
  consumeWPAuthorizeState,
  createWPAuthorizeState,
  WP_AUTHORIZE_STATE_COOKIE,
  WP_AUTHORIZE_STATE_COOKIE_TTL_SECONDS,
  wpAuthorizeStateCookieOptions,
} from "@/lib/v1/wp-authorize-state";

beforeEach(async () => {
  await ensureSchema();
  await db.execute("DELETE FROM wp_authorize_states");
});

describe("WordPress authorize state", () => {
  it("persists and consumes the browser-bound value", async () => {
    const created = await createWPAuthorizeState({
      userId: "user-1",
      outletId: "outlet-1",
      expectedSiteUrl: "https://wp.example",
      boundValue: "cookie-secret",
      now: 1000,
    });

    const consumed = await consumeWPAuthorizeState(created.state, 1001);

    expect(consumed).toEqual({
      ok: true,
      value: {
        state: created.state,
        userId: "user-1",
        outletId: "outlet-1",
        expectedSiteUrl: "https://wp.example",
        expectedSiteOrigin: "https://wp.example",
        boundValue: "cookie-secret",
        createdAt: 1000,
        expiresAt: 601000,
      },
    });
    await expect(consumeWPAuthorizeState(created.state, 1002)).resolves.toEqual({
      ok: false,
      reason: "missing",
    });
  });

  it("uses a short-lived callback-scoped HttpOnly Lax cookie", () => {
    expect(WP_AUTHORIZE_STATE_COOKIE).toBe("fp_wp_authorize_state");
    expect(WP_AUTHORIZE_STATE_COOKIE_TTL_SECONDS).toBe(600);
    expect(wpAuthorizeStateCookieOptions(600)).toEqual({
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/api/wp/callback",
      maxAge: 600,
    });
  });
});
