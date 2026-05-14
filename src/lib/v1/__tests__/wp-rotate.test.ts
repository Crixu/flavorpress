import { afterEach, describe, expect, it, vi } from "vitest";
import {
  _resetLookupForTests,
  _resetPinnedFetchForTests,
  _setLookupForTests,
  _setPinnedFetchForTests,
} from "../safe-fetch";
import { isWpAppPasswordRotationEnabled, rotateOutletAppPassword } from "../wp-rotate";

afterEach(() => {
  _resetLookupForTests();
  _resetPinnedFetchForTests();
});

describe("isWpAppPasswordRotationEnabled", () => {
  it("requires the explicit rollout flag", () => {
    expect(isWpAppPasswordRotationEnabled({})).toBe(false);
    expect(isWpAppPasswordRotationEnabled({ FLAVORPRESS_WP_ROTATE_APP_PW: "0" })).toBe(false);
    expect(isWpAppPasswordRotationEnabled({ FLAVORPRESS_WP_ROTATE_APP_PW: "1" })).toBe(true);
  });
});

describe("rotateOutletAppPassword", () => {
  it("creates a replacement password and deletes the callback password with the replacement", async () => {
    _setLookupForTests(async () => [{ address: "8.8.8.8", family: 4 }]);
    const requested: Array<{ url: string; method: string; authorization: string | null }> = [];
    const replacementPassword = "new pass word";

    _setPinnedFetchForTests(
      vi.fn(async (target, init) => {
        requested.push({
          url: target.url.toString(),
          method: init.method ?? "GET",
          authorization: new Headers(init.headers).get("authorization"),
        });

        if (target.url.pathname === "/wp-json/wp/v2/users/me") {
          return jsonResponse({ id: 42 });
        }
        if (target.url.pathname === "/wp-json/wp/v2/users/42/application-passwords/introspect") {
          return jsonResponse({ uuid: "old-uuid", name: "FlavorPress" });
        }
        if (
          target.url.pathname === "/wp-json/wp/v2/users/42/application-passwords" &&
          init.method === "POST"
        ) {
          return jsonResponse({ uuid: "new-uuid", password: replacementPassword });
        }
        if (
          target.url.pathname === "/wp-json/wp/v2/users/42/application-passwords/old-uuid" &&
          init.method === "DELETE"
        ) {
          return jsonResponse({ deleted: true });
        }
        return new Response("not found", { status: 404 });
      }),
    );

    const result = await rotateOutletAppPassword({
      baseUrl: "https://wp.example/",
      username: "author",
      appPassword: "old pass word",
    });

    expect(result).toEqual({
      appPassword: "newpassword",
      replacementUuid: "new-uuid",
      previousUuid: "old-uuid",
      previousDeleted: true,
    });
    expect(requested.map((entry) => `${entry.method} ${new URL(entry.url).pathname}`)).toEqual([
      "GET /wp-json/wp/v2/users/me",
      "GET /wp-json/wp/v2/users/42/application-passwords/introspect",
      "POST /wp-json/wp/v2/users/42/application-passwords",
      "DELETE /wp-json/wp/v2/users/42/application-passwords/old-uuid",
    ]);
    expect(requested[0]!.authorization).toBe(basic("author", "oldpassword"));
    expect(requested[3]!.authorization).toBe(basic("author", "newpassword"));
  });

  it("fails before returning a credential when WordPress cannot create the replacement", async () => {
    _setLookupForTests(async () => [{ address: "8.8.8.8", family: 4 }]);
    _setPinnedFetchForTests(
      vi.fn(async (target, init) => {
        if (target.url.pathname === "/wp-json/wp/v2/users/me") {
          return jsonResponse({ id: 42 });
        }
        if (target.url.pathname === "/wp-json/wp/v2/users/42/application-passwords/introspect") {
          return jsonResponse({ uuid: "old-uuid" });
        }
        if (
          target.url.pathname === "/wp-json/wp/v2/users/42/application-passwords" &&
          init.method === "POST"
        ) {
          return new Response("denied", { status: 403 });
        }
        return new Response("not found", { status: 404 });
      }),
    );

    await expect(
      rotateOutletAppPassword({
        baseUrl: "https://wp.example",
        username: "author",
        appPassword: "old-secret",
      }),
    ).rejects.toThrow("WordPress create application password failed: HTTP 403 denied");
  });
});

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: new Headers({ "content-type": "application/json" }),
  });
}

function basic(username: string, appPassword: string): string {
  return `Basic ${Buffer.from(`${username}:${appPassword}`).toString("base64")}`;
}
