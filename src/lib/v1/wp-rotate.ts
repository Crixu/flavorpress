import { safeFetch, safeReadJson, safeReadText } from "./safe-fetch";
import type { WPApplicationPasswordCredentials } from "../wordpress";

interface WPMeResponse {
  id: number;
}

interface WPApplicationPasswordRecord {
  uuid: string;
  name?: string;
  password?: string;
}

interface RotationEnv {
  FLAVORPRESS_WP_ROTATE_APP_PW?: string;
}

export interface RotateOutletAppPasswordResult {
  appPassword: string;
  replacementUuid: string;
  previousUuid: string | null;
  previousDeleted: boolean;
}

export function isWpAppPasswordRotationEnabled(env?: RotationEnv): boolean {
  return (env?.FLAVORPRESS_WP_ROTATE_APP_PW ?? process.env.FLAVORPRESS_WP_ROTATE_APP_PW) === "1";
}

export async function rotateOutletAppPassword(
  creds: WPApplicationPasswordCredentials,
): Promise<RotateOutletAppPasswordResult> {
  const baseUrl = creds.baseUrl.replace(/\/$/, "");
  const currentAuth = appPasswordAuthHeader(creds.username, creds.appPassword);
  const me = await fetchJson<WPMeResponse>(`${baseUrl}/wp-json/wp/v2/users/me`, currentAuth, "me");
  const previous = await fetchJson<WPApplicationPasswordRecord>(
    `${baseUrl}/wp-json/wp/v2/users/${me.id}/application-passwords/introspect?context=edit`,
    currentAuth,
    "introspect",
  );
  const replacement = await fetchJson<WPApplicationPasswordRecord>(
    `${baseUrl}/wp-json/wp/v2/users/${me.id}/application-passwords`,
    currentAuth,
    "create application password",
    {
      method: "POST",
      body: JSON.stringify({
        name: `FlavorPress ${new Date().toISOString().slice(0, 10)}`,
      }),
      headers: {
        "Content-Type": "application/json",
      },
    },
  );

  if (!replacement.uuid || !replacement.password) {
    throw new Error("WordPress did not return a replacement application password.");
  }

  let previousDeleted = false;
  if (previous.uuid) {
    const replacementAuth = appPasswordAuthHeader(creds.username, replacement.password);
    const deleteRes = await safeFetch(
      `${baseUrl}/wp-json/wp/v2/users/${me.id}/application-passwords/${previous.uuid}`,
      {
        method: "DELETE",
        headers: {
          Authorization: replacementAuth,
        },
      },
    );
    previousDeleted = deleteRes.ok;
  }

  return {
    appPassword: replacement.password.replace(/\s+/g, ""),
    replacementUuid: replacement.uuid,
    previousUuid: previous.uuid || null,
    previousDeleted,
  };
}

function appPasswordAuthHeader(username: string, appPassword: string): string {
  const cleaned = appPassword.replace(/\s+/g, "");
  return `Basic ${Buffer.from(`${username}:${cleaned}`).toString("base64")}`;
}

async function fetchJson<T>(
  url: string,
  authorization: string,
  label: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Authorization", authorization);
  const res = await safeFetch(url, {
    ...init,
    headers,
  });
  if (!res.ok) {
    const text = await safeReadText(res).catch(() => "");
    throw new Error(`WordPress ${label} failed: HTTP ${res.status} ${text.slice(0, 200)}`.trim());
  }
  return safeReadJson<T>(res);
}
