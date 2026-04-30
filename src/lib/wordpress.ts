/**
 * WordPress REST + Application Password helpers.
 *
 * Used by the v1 wordpress-publish capability and by the auth-detection
 * probe on the Sources view. Designed to be called with explicit credentials
 * rather than reading from a global "site" row, since v1 supports any
 * number of connections per user.
 */

export interface WPCredentials {
  baseUrl: string;
  username: string;
  appPassword: string;
}

export interface WPProbeResult {
  ok: boolean;
  kind: "wp-org" | "wp-com" | "jetpack-managed" | "multisite" | "unknown";
  username?: string;
  message: string;
}

export interface WPPost {
  id: number;
  title: { rendered: string };
  content: { rendered: string };
  excerpt: { rendered: string };
  link: string;
  date: string;
}

function authHeader(creds: WPCredentials): string {
  const token = Buffer.from(
    `${creds.username}:${creds.appPassword.replace(/\s+/g, "")}`,
  ).toString("base64");
  return `Basic ${token}`;
}

function root(creds: WPCredentials): string {
  return creds.baseUrl.replace(/\/$/, "");
}

/**
 * Auth-detection probe (engineer review): ship this BEFORE the publish
 * capability. Detects Jetpack-managed sites, custom auth plugin
 * interception, multisite vs subsite URL paste.
 */
export async function probeWordPress(creds: WPCredentials): Promise<WPProbeResult> {
  try {
    const res = await fetch(`${root(creds)}/wp-json/wp/v2/users/me`, {
      headers: { Authorization: authHeader(creds) },
    });
    if (res.status === 401 || res.status === 403) {
      const headers = res.headers;
      if (
        headers.get("x-jetpack") ||
        headers.get("x-rest-allowed-schemes")?.includes("jetpack")
      ) {
        return {
          ok: false,
          kind: "jetpack-managed",
          message:
            "Site is Jetpack-managed; Application Passwords are blocked. v1.1 will route via Jetpack Connect; for now, deactivate Jetpack SSO temporarily.",
        };
      }
      return {
        ok: false,
        kind: "unknown",
        message: `${res.status} on /users/me. Likely a custom auth plugin (LoginRadius, miniOrange, Auth0). Disable for the REST API path or add an exclusion.`,
      };
    }
    if (!res.ok) {
      return {
        ok: false,
        kind: "unknown",
        message: `Probe failed: HTTP ${res.status}`,
      };
    }
    const user = (await res.json()) as { username?: string; name?: string };
    const wpcom = creds.baseUrl.includes(".wordpress.com");
    return {
      ok: true,
      kind: wpcom ? "wp-com" : "wp-org",
      username: user.username ?? user.name,
      message: "Connected.",
    };
  } catch (err) {
    return {
      ok: false,
      kind: "unknown",
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Preflight check before redirecting the user to authorize-application.php.
 *
 * Catches the common failure modes BEFORE the user leaves our app:
 *   - URL not reachable
 *   - Not a WordPress site (or REST API disabled)
 *   - Application Passwords endpoint missing (WP < 5.6 or plugin-disabled)
 *   - Jetpack-managed (SSO will block)
 *   - HTTP callback to HTTPS WP (some installs reject)
 *
 * Returns structured findings the UI uses to gate the Authorize button.
 */

export interface PreflightResult {
  ok: boolean;
  baseUrl: string;
  /** WordPress reports its name from /wp-json. */
  siteName?: string;
  /** Major.minor version from REST root, if exposed. */
  wpVersion?: string;
  reachable: boolean;
  isWordPress: boolean;
  hasApplicationPasswords: boolean;
  hasJetpack: boolean;
  callbackSchemeMatch: boolean;
  warnings: string[];
  errors: string[];
  /** One-line guidance for the next step. */
  hint?: string;
}

export async function preflightWordPress(
  rawBaseUrl: string,
  callbackOrigin: string,
): Promise<PreflightResult> {
  const result: PreflightResult = {
    ok: false,
    baseUrl: rawBaseUrl,
    reachable: false,
    isWordPress: false,
    hasApplicationPasswords: false,
    hasJetpack: false,
    callbackSchemeMatch: false,
    warnings: [],
    errors: [],
  };

  // 1. URL parse + normalize.
  let baseUrl: URL;
  try {
    baseUrl = new URL(rawBaseUrl.replace(/\/$/, ""));
  } catch {
    result.errors.push("URL doesn't parse. Did you include https:// ?");
    result.hint = "Paste the full URL, e.g. https://yourblog.com";
    return result;
  }
  if (baseUrl.protocol !== "http:" && baseUrl.protocol !== "https:") {
    result.errors.push("URL must use http:// or https://.");
    return result;
  }
  result.baseUrl = baseUrl.toString().replace(/\/$/, "");

  // 2. Hit /wp-json to confirm WordPress + REST API.
  try {
    const res = await fetch(`${result.baseUrl}/wp-json/`, {
      headers: { Accept: "application/json" },
      redirect: "follow",
      signal: AbortSignal.timeout(8000),
    });
    result.reachable = res.ok;
    if (!res.ok) {
      result.errors.push(
        `Site responded ${res.status} on /wp-json/. REST API may be disabled or the URL is wrong.`,
      );
      result.hint =
        res.status === 404
          ? "Check the URL. Multisite users: paste the subsite URL, not the network root."
          : "Check that the WordPress REST API is enabled.";
      return result;
    }
    const data = (await res.json()) as {
      name?: string;
      namespaces?: string[];
    };
    result.siteName = data.name ?? undefined;
    const ns = Array.isArray(data.namespaces) ? data.namespaces : [];
    result.isWordPress = ns.includes("wp/v2");
    if (!result.isWordPress) {
      result.errors.push(
        "Site responded but doesn't expose the wp/v2 REST namespace. May not be WordPress.",
      );
      return result;
    }
    result.hasJetpack = ns.some((n) => n.startsWith("jetpack/"));

    // Surface a generation field if WP exposed it.
    const gen = res.headers.get("x-wp-version");
    if (gen) result.wpVersion = gen;
  } catch (err) {
    result.errors.push(
      err instanceof Error ? err.message : String(err),
    );
    result.hint =
      "Site unreachable. Check the URL, your network, and that the site isn't behind a Cloudflare bot wall.";
    return result;
  }

  // 3. Application Passwords endpoint (WP 5.6+).
  try {
    const res = await fetch(
      `${result.baseUrl}/wp-admin/authorize-application.php`,
      {
        method: "HEAD",
        redirect: "follow",
        signal: AbortSignal.timeout(8000),
      },
    );
    // 200, 302 (redirect to login), or 401 all mean the endpoint exists.
    result.hasApplicationPasswords = res.status < 500 && res.status !== 404;
    if (!result.hasApplicationPasswords) {
      result.errors.push(
        "Application Passwords endpoint not found. WordPress 5.6+ is required, and the feature must not be disabled by a security plugin.",
      );
      return result;
    }
  } catch (err) {
    result.warnings.push(
      `Couldn't reach authorize-application.php directly: ${err instanceof Error ? err.message : String(err)}. The authorize redirect may still work.`,
    );
    // Don't fail preflight on this; the actual redirect happens server-side
    // from the user's browser, which has different network access.
    result.hasApplicationPasswords = true;
  }

  // 4. Callback scheme match.
  try {
    const cbUrl = new URL(callbackOrigin);
    if (cbUrl.protocol === "http:" && baseUrl.protocol === "https:") {
      result.callbackSchemeMatch = false;
      result.warnings.push(
        `Your WordPress site is HTTPS but FlavorPress is running on ${callbackOrigin}. WordPress may refuse to redirect back to an http:// URL. Consider running FlavorPress under HTTPS (ngrok, Cloudflare Tunnel) or use the manual paste flow.`,
      );
    } else {
      result.callbackSchemeMatch = true;
    }
  } catch {
    result.warnings.push("Callback origin URL malformed.");
  }

  // 5. Jetpack notice (warn only; some setups still allow App Passwords).
  if (result.hasJetpack) {
    result.warnings.push(
      "Jetpack is installed on this site. If Jetpack SSO is enforced, Application Passwords will be blocked. Try the authorize flow; fall back to manual paste if it fails.",
    );
  }

  // 6. Compute ok.
  result.ok =
    result.reachable &&
    result.isWordPress &&
    result.hasApplicationPasswords &&
    result.errors.length === 0;

  if (result.ok && result.callbackSchemeMatch && !result.hasJetpack) {
    result.hint = "All checks pass. The authorize flow will redirect you to your site's login, then back here.";
  } else if (result.ok && !result.callbackSchemeMatch) {
    result.hint = "Site is ready, but the http→https callback might fail. If it does, use the manual paste flow.";
  } else if (result.ok && result.hasJetpack) {
    result.hint = "Site is ready. If Jetpack SSO blocks the authorize, switch to manual paste.";
  }

  return result;
}

/**
 * Compact serialization of a preflight result for storage on the
 * outlets.last_error column. The /voice page decodes and renders.
 */
export function encodePreflight(p: PreflightResult): string {
  return `PRE:${JSON.stringify({
    ok: p.ok,
    reachable: p.reachable,
    isWordPress: p.isWordPress,
    hasApplicationPasswords: p.hasApplicationPasswords,
    hasJetpack: p.hasJetpack,
    callbackSchemeMatch: p.callbackSchemeMatch,
    siteName: p.siteName,
    warnings: p.warnings.slice(0, 4),
    errors: p.errors.slice(0, 4),
    hint: p.hint,
  })}`;
}

export function decodePreflight(s: string | null): PreflightResult | null {
  if (!s || !s.startsWith("PRE:")) return null;
  try {
    const data = JSON.parse(s.slice(4)) as Partial<PreflightResult>;
    return {
      ok: Boolean(data.ok),
      baseUrl: "",
      reachable: Boolean(data.reachable),
      isWordPress: Boolean(data.isWordPress),
      hasApplicationPasswords: Boolean(data.hasApplicationPasswords),
      hasJetpack: Boolean(data.hasJetpack),
      callbackSchemeMatch: Boolean(data.callbackSchemeMatch),
      siteName: data.siteName,
      warnings: Array.isArray(data.warnings) ? data.warnings : [],
      errors: Array.isArray(data.errors) ? data.errors : [],
      hint: data.hint,
    };
  } catch {
    return null;
  }
}

/** Pull the user's last N posts. Used by the voice profile build. */
export async function listRecentPosts(
  creds: WPCredentials,
  count = 50,
): Promise<WPPost[]> {
  const res = await fetch(
    `${root(creds)}/wp-json/wp/v2/posts?per_page=${count}&orderby=date&_fields=id,title,content,excerpt,link,date`,
    { headers: { Authorization: authHeader(creds) } },
  );
  if (!res.ok) throw new Error(`WP fetch failed: ${res.status}`);
  return (await res.json()) as WPPost[];
}

export type WPPostStatus = "draft" | "publish" | "future";

export interface PublishInput {
  creds: WPCredentials;
  title: string;
  contentHtml: string;
  status?: WPPostStatus;
  scheduleAt?: number;
}

export interface PublishResult {
  wpPostId: number;
  url: string;
  editLink: string;
}

/**
 * Wrap the draft body's `<p>` and `<blockquote>` tags in Gutenberg block
 * comments so the post renders as proper blocks in the WP editor instead of
 * a single Classic block with raw HTML inside.
 */
export function htmlToBlocks(html: string): string {
  const trimmed = html.trim();
  if (!trimmed) return "";

  const tagRegex = /<(p|blockquote)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  const parts: string[] = [];
  let lastIndex = 0;
  let m: RegExpExecArray | null;

  const pushTextAsParagraphs = (text: string) => {
    const stripped = text.replace(/\s+/g, " ").trim();
    if (!stripped) return;
    for (const chunk of stripped.split(/\n{2,}/)) {
      const line = chunk.trim();
      if (!line) continue;
      parts.push(`<!-- wp:paragraph -->\n<p>${line}</p>\n<!-- /wp:paragraph -->`);
    }
  };

  while ((m = tagRegex.exec(trimmed)) !== null) {
    if (m.index > lastIndex) {
      pushTextAsParagraphs(trimmed.slice(lastIndex, m.index));
    }
    const tag = m[1].toLowerCase();
    const inner = m[2].trim();
    if (tag === "p") {
      parts.push(`<!-- wp:paragraph -->\n<p>${inner}</p>\n<!-- /wp:paragraph -->`);
    } else {
      const quoteInner = /<p[\s>]/i.test(inner) ? inner : `<p>${inner}</p>`;
      parts.push(
        `<!-- wp:quote -->\n<blockquote class="wp-block-quote">${quoteInner}</blockquote>\n<!-- /wp:quote -->`,
      );
    }
    lastIndex = m.index + m[0].length;
  }
  if (lastIndex < trimmed.length) {
    pushTextAsParagraphs(trimmed.slice(lastIndex));
  }

  return parts.join("\n\n");
}

export async function publishToWordPress(input: PublishInput): Promise<PublishResult> {
  const body: Record<string, unknown> = {
    title: input.title,
    content: htmlToBlocks(input.contentHtml),
    status: input.status ?? "draft",
  };
  if (input.status === "future" && input.scheduleAt) {
    body.date = new Date(input.scheduleAt).toISOString();
  }

  const res = await fetch(`${root(input.creds)}/wp-json/wp/v2/posts`, {
    method: "POST",
    headers: {
      Authorization: authHeader(input.creds),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`WP publish failed: ${res.status} ${text.slice(0, 200)}`);
  }
  const post = (await res.json()) as { id: number; link: string };
  return {
    wpPostId: post.id,
    url: post.link,
    editLink: `${root(input.creds)}/wp-admin/post.php?post=${post.id}&action=edit`,
  };
}

/**
 * Application Password kill-switch (engineer review): revoke FlavorPress's
 * stored credential by issuing the WordPress REST DELETE. Useful in
 * incident response.
 */
export async function revokeAllAppPasswords(creds: WPCredentials): Promise<void> {
  const meRes = await fetch(`${root(creds)}/wp-json/wp/v2/users/me`, {
    headers: { Authorization: authHeader(creds) },
  });
  if (!meRes.ok) throw new Error(`me failed: ${meRes.status}`);
  const me = (await meRes.json()) as { id: number };

  const listRes = await fetch(
    `${root(creds)}/wp-json/wp/v2/users/${me.id}/application-passwords`,
    { headers: { Authorization: authHeader(creds) } },
  );
  if (!listRes.ok) return;
  const list = (await listRes.json()) as Array<{ uuid: string; name: string }>;
  for (const p of list) {
    if (!p.name.toLowerCase().includes("flavorpress")) continue;
    await fetch(
      `${root(creds)}/wp-json/wp/v2/users/${me.id}/application-passwords/${p.uuid}`,
      { method: "DELETE", headers: { Authorization: authHeader(creds) } },
    );
  }
}
