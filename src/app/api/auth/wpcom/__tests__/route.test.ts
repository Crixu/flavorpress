import { beforeEach, describe, expect, it } from "vitest";
import {
  consumeWpcomState,
  resetWpcomStateCacheForTests,
  WPCOM_OAUTH_STATE_COOKIE,
} from "@/lib/wpcom-oauth";
import { GET } from "../route";

beforeEach(async () => {
  process.env.FLAVORPRESS_SESSION_SECRET = "test-secret-that-is-at-least-32-bytes-long!!";
  process.env.WPCOM_OAUTH_CLIENT_ID = "test-client";
  process.env.WPCOM_OAUTH_CLIENT_SECRET = "test-secret";
  process.env.FLAVORPRESS_ORIGIN = "http://localhost:3000";
  await resetWpcomStateCacheForTests();
});

describe("wpcom auth start", () => {
  it("sets a nonce cookie matching the signed OAuth state", async () => {
    const response = await GET(new Request("http://localhost:3000/api/auth/wpcom?mode=login"));
    const location = response.headers.get("location");
    expect(location).not.toBeNull();

    const stateToken = new URL(location!).searchParams.get("state");
    expect(stateToken).not.toBeNull();
    const state = await consumeWpcomState(stateToken!);
    expect(state).not.toBeNull();

    const setCookie = response.headers.get("set-cookie");
    expect(setCookie).toContain(`${WPCOM_OAUTH_STATE_COOKIE}=${state!.nonce}`);
    expect(setCookie).toContain("Path=/api");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=lax");
  });
});
