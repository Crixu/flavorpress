/**
 * Outlets - a writer's WordPress publishing destinations.
 *
 * One author can have many outlets. Each outlet has its own voice profile
 * (built from that outlet's WP archive) and its own credentials. Drafts
 * pick an outlet at the moment of draft.
 *
 * The "is_default" flag picks which outlet a draft uses when the author
 * doesn't choose explicitly. There is at most one default per user.
 */

import { db, ensureSchema } from "../db";
import { notifyFirstSiteConnected } from "../notifications";
import { assertCanCreateOutlets } from "../plans";
import { decryptSecret, encryptSecret, isEncryptedSecret } from "../secret-crypto";
import type { WPCredentials } from "../wordpress";
import { refreshWpcomAccessToken, revokeWpcomToken } from "../wpcom-oauth";

export type OutletKind = "wp-org" | "wp-com" | "jetpack-managed" | "multisite" | "unknown" | null;

export interface Outlet {
  id: string;
  userId: string;
  baseUrl: string;
  displayName: string | null;
  username: string | null;
  kind: OutletKind;
  isDefault: boolean;
  /** True iff app_password_encrypted is non-null (auth completed). */
  connected: boolean;
  lastError: string | null;
  connectedAt: number | null;
  createdAt: number;
  lastUsedAt: number | null;
  wpcomExpectedBlogId: string | null;
}

interface OutletRow {
  id: string;
  user_id: string;
  base_url: string;
  display_name: string | null;
  username: string | null;
  app_password_encrypted: ArrayBuffer | null;
  kind: string | null;
  is_default: number;
  last_error: string | null;
  connected_at: number | null;
  created_at: number;
  last_used_at: number | null;
  wpcom_expected_blog_id: string | null;
}

function rowToOutlet(row: OutletRow): Outlet {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    baseUrl: String(row.base_url),
    displayName: row.display_name ? String(row.display_name) : null,
    username: row.username ? String(row.username) : null,
    kind: (row.kind as OutletKind) ?? null,
    isDefault: Number(row.is_default) === 1,
    connected: row.app_password_encrypted !== null,
    lastError: row.last_error ? String(row.last_error) : null,
    connectedAt: row.connected_at ? Number(row.connected_at) : null,
    createdAt: Number(row.created_at),
    lastUsedAt: row.last_used_at ? Number(row.last_used_at) : null,
    wpcomExpectedBlogId: row.wpcom_expected_blog_id ? String(row.wpcom_expected_blog_id) : null,
  };
}

const OUTLET_COLS = `id, user_id, base_url, display_name, username,
  app_password_encrypted, kind, is_default, last_error,
  connected_at, created_at, last_used_at, wpcom_expected_blog_id`;

const WPCOM_TOKEN_KID = "v1";
const WPCOM_REFRESH_WINDOW_MS = 5 * 60 * 1000;

export async function listOutlets(userId: string): Promise<Outlet[]> {
  await ensureSchema();
  const r = await db.execute({
    sql: `SELECT ${OUTLET_COLS} FROM outlets WHERE user_id = ? ORDER BY is_default DESC, created_at ASC`,
    args: [userId],
  });
  return r.rows.map((row) => rowToOutlet(row as unknown as OutletRow));
}

export async function getOutlet(outletId: string, userId: string): Promise<Outlet | null> {
  await ensureSchema();
  const r = await db.execute({
    sql: `SELECT ${OUTLET_COLS} FROM outlets WHERE id = ? AND user_id = ?`,
    args: [outletId, userId],
  });
  if (r.rows.length === 0) return null;
  return rowToOutlet(r.rows[0] as unknown as OutletRow);
}

export async function getDefaultOutlet(userId: string): Promise<Outlet | null> {
  await ensureSchema();
  const r = await db.execute({
    sql: `SELECT ${OUTLET_COLS} FROM outlets
          WHERE user_id = ?
          ORDER BY is_default DESC, last_used_at DESC, created_at DESC
          LIMIT 1`,
    args: [userId],
  });
  if (r.rows.length === 0) return null;
  return rowToOutlet(r.rows[0] as unknown as OutletRow);
}

export async function setOutletWpcomExpectedBlogId(
  outletId: string,
  userId: string,
  blogId: string | null,
): Promise<void> {
  await ensureSchema();
  await db.execute({
    sql: `UPDATE outlets
          SET wpcom_expected_blog_id = ?
          WHERE id = ? AND user_id = ?`,
    args: [blogId, outletId, userId],
  });
}

/**
 * Stage a new outlet (URL only) before authorize. Returns the outlet id.
 * Idempotent: if (user_id, base_url) already exists, returns that id and
 * resets last_error.
 */
export async function stageOutlet(
  userId: string,
  baseUrl: string,
  displayName?: string,
): Promise<string> {
  await ensureSchema();
  const existing = await db.execute({
    sql: `SELECT id FROM outlets WHERE user_id = ? AND base_url = ?`,
    args: [userId, baseUrl],
  });
  if (existing.rows.length > 0) {
    const id = String(existing.rows[0]!.id);
    await db.execute({
      sql: `UPDATE outlets SET last_error = NULL WHERE id = ?`,
      args: [id],
    });
    return id;
  }
  await assertCanCreateOutlets(userId);
  const id = crypto.randomUUID();
  await db.execute({
    sql: `INSERT INTO outlets (id, user_id, base_url, display_name, created_at)
          VALUES (?, ?, ?, ?, ?)`,
    args: [id, userId, baseUrl, displayName ?? hostFromUrl(baseUrl), Date.now()],
  });
  return id;
}

/**
 * Persist credentials onto an outlet after a successful probe. If this is
 * the first connected outlet for the user, mark it default.
 */
export async function commitOutletCredentials(
  outletId: string,
  username: string,
  appPassword: string,
  kind: OutletKind,
): Promise<void> {
  await ensureSchema();
  const cleaned = appPassword.replace(/\s+/g, "");
  const blob = secretStringToBlob(encryptSecret(`${username}:${cleaned}`));
  await db.execute({
    sql: `UPDATE outlets
          SET username = ?, app_password_encrypted = ?, kind = ?,
              connected_at = ?, last_error = NULL,
              wpcom_token_expires_at = NULL,
              wpcom_refresh_token_encrypted = NULL,
              wpcom_token_kid = NULL
          WHERE id = ?`,
    args: [username, blob, kind, Date.now(), outletId],
  });

  // First-connected becomes default.
  const outletRow = await db.execute({
    sql: `SELECT o.user_id, o.base_url, o.display_name,
                 (SELECT COUNT(*) FROM outlets
                  WHERE user_id = o.user_id AND app_password_encrypted IS NOT NULL) AS connected_count
          FROM outlets o WHERE o.id = ?`,
    args: [outletId],
  });
  if (outletRow.rows.length === 0) return;
  const userId = String(outletRow.rows[0]!.user_id);
  const connectedCount = Number(outletRow.rows[0]!.connected_count ?? 0);
  const defaultRow = await db.execute({
    sql: `SELECT id FROM outlets WHERE user_id = ? AND is_default = 1`,
    args: [userId],
  });
  if (defaultRow.rows.length === 0) {
    await db.execute({
      sql: `UPDATE outlets SET is_default = 1 WHERE id = ?`,
      args: [outletId],
    });
  }
  if (connectedCount === 1) {
    await notifyFirstSiteConnected({
      userId,
      outletId,
      baseUrl: String(outletRow.rows[0]!.base_url ?? ""),
      displayName:
        outletRow.rows[0]!.display_name == null ? null : String(outletRow.rows[0]!.display_name),
      kind,
    });
  }
}

export async function commitOutletWpcomOAuthCredentials(opts: {
  outletId: string;
  accessToken: string;
  siteId: string;
  siteUrl: string;
  siteName: string | null;
  username: string | null;
  kind: OutletKind;
  expiresAt?: number | null;
  refreshToken?: string | null;
}): Promise<void> {
  await ensureSchema();
  const payload = stringifyWpcomPayload({
    accessToken: opts.accessToken,
    siteId: opts.siteId,
    siteUrl: opts.siteUrl,
    username: opts.username,
  });
  const refreshTokenBlob = opts.refreshToken
    ? secretStringToBlob(encryptSecret(opts.refreshToken))
    : null;
  await db.execute({
    sql: `UPDATE outlets
          SET username = ?, app_password_encrypted = ?, kind = ?,
              base_url = ?, display_name = COALESCE(?, display_name),
              connected_at = ?, last_error = NULL,
              wpcom_token_expires_at = ?,
              wpcom_refresh_token_encrypted = ?,
              wpcom_token_kid = ?
          WHERE id = ?`,
    args: [
      opts.username,
      secretStringToBlob(encryptSecret(`wpcom-oauth:${payload}`)),
      opts.kind,
      opts.siteUrl,
      opts.siteName,
      Date.now(),
      opts.expiresAt ?? null,
      refreshTokenBlob,
      WPCOM_TOKEN_KID,
      opts.outletId,
    ],
  });

  const outletRow = await db.execute({
    sql: `SELECT o.user_id, o.base_url, o.display_name,
                 (SELECT COUNT(*) FROM outlets
                  WHERE user_id = o.user_id AND app_password_encrypted IS NOT NULL) AS connected_count
          FROM outlets o WHERE o.id = ?`,
    args: [opts.outletId],
  });
  if (outletRow.rows.length === 0) return;
  const userId = String(outletRow.rows[0]!.user_id);
  const connectedCount = Number(outletRow.rows[0]!.connected_count ?? 0);
  const defaultRow = await db.execute({
    sql: `SELECT id FROM outlets WHERE user_id = ? AND is_default = 1`,
    args: [userId],
  });
  if (defaultRow.rows.length === 0) {
    await db.execute({
      sql: `UPDATE outlets SET is_default = 1 WHERE id = ?`,
      args: [opts.outletId],
    });
  }
  if (connectedCount === 1) {
    await notifyFirstSiteConnected({
      userId,
      outletId: opts.outletId,
      baseUrl: String(outletRow.rows[0]!.base_url ?? ""),
      displayName:
        outletRow.rows[0]!.display_name == null ? null : String(outletRow.rows[0]!.display_name),
      kind: opts.kind,
    });
  }
}

export async function recordOutletError(
  outletId: string,
  message: string,
  kind?: OutletKind,
): Promise<void> {
  await ensureSchema();
  await db.execute({
    sql: `UPDATE outlets SET last_error = ?, kind = COALESCE(?, kind) WHERE id = ?`,
    args: [message, kind ?? null, outletId],
  });
}

export async function setDefaultOutlet(outletId: string, userId: string): Promise<void> {
  await ensureSchema();
  await db.batch(
    [
      {
        sql: `UPDATE outlets SET is_default = 0 WHERE user_id = ?`,
        args: [userId],
      },
      {
        sql: `UPDATE outlets SET is_default = 1 WHERE id = ? AND user_id = ?`,
        args: [outletId, userId],
      },
    ],
    "write",
  );
}

/**
 * Disconnect an outlet. Removes credentials but keeps the row plus voice
 * profile so reconnect rebuilds in place. Returns the staged outlet so the
 * UI can immediately show a "reconnect" affordance.
 *
 * If `purge` is true, drop the outlet row and its voice profile entirely.
 */
export async function disconnectOutlet(
  outletId: string,
  opts: { purge?: boolean } = {},
  userId: string,
): Promise<void> {
  await ensureSchema();
  const outlet = await db.execute({
    sql: `SELECT is_default, app_password_encrypted, wpcom_refresh_token_encrypted
          FROM outlets WHERE id = ? AND user_id = ?`,
    args: [outletId, userId],
  });
  if (outlet.rows.length === 0) return;
  await revokeStoredWpcomTokens(outlet.rows[0]!);

  if (opts.purge) {
    const wasDefault = Number(outlet.rows[0]!.is_default ?? 0) === 1;

    await db.batch(
      [
        {
          sql: `DELETE FROM wp_authorize_states WHERE outlet_id = ? AND user_id = ?`,
          args: [outletId, userId],
        },
        {
          sql: `DELETE FROM outlet_sources WHERE outlet_id = ?`,
          args: [outletId],
        },
        {
          sql: `DELETE FROM voice_profiles WHERE outlet_id = ? AND user_id = ?`,
          args: [outletId, userId],
        },
        {
          sql: `DELETE FROM outlets WHERE id = ? AND user_id = ?`,
          args: [outletId, userId],
        },
      ],
      "write",
    );

    if (wasDefault) {
      const next = await db.execute({
        sql: `SELECT id FROM outlets
              WHERE user_id = ?
              ORDER BY app_password_encrypted IS NULL ASC, created_at ASC
              LIMIT 1`,
        args: [userId],
      });
      const nextId = next.rows[0]?.id ? String(next.rows[0].id) : "";
      if (nextId) {
        await db.execute({
          sql: `UPDATE outlets SET is_default = 1 WHERE id = ? AND user_id = ?`,
          args: [nextId, userId],
        });
      }
    }
    return;
  }
  await db.execute({
    sql: `UPDATE outlets
          SET app_password_encrypted = NULL,
              wpcom_token_expires_at = NULL,
              wpcom_refresh_token_encrypted = NULL,
              wpcom_token_kid = NULL,
              username = NULL,
              connected_at = NULL,
              last_error = NULL
          WHERE id = ? AND user_id = ?`,
    args: [outletId, userId],
  });
}

/**
 * Decrypt outlet credentials for the publish capability.
 */
export async function getOutletCredentials(outletId: string): Promise<WPCredentials | null> {
  await ensureSchema();
  const r = await db.execute({
    sql: `SELECT base_url, app_password_encrypted, wpcom_token_expires_at,
                 wpcom_refresh_token_encrypted
          FROM outlets WHERE id = ?`,
    args: [outletId],
  });
  if (r.rows.length === 0) return null;
  const blob = r.rows[0]!.app_password_encrypted as ArrayBuffer | Uint8Array | null;
  if (!blob) return null;
  const decoded = blobToSecretString(blob);
  const wasLegacyPlaintext = !isEncryptedSecret(decoded);
  const payload = wasLegacyPlaintext ? decoded : decryptSecret(decoded);
  const parsed = parseCredentialPayload(payload, String(r.rows[0]!.base_url));
  if (!parsed) return null;

  if (wasLegacyPlaintext) {
    await db.execute({
      sql: `UPDATE outlets SET app_password_encrypted = ? WHERE id = ?`,
      args: [secretStringToBlob(encryptSecret(payload)), outletId],
    });
  }

  if (parsed.authType === "wpcom-oauth") {
    return maybeRefreshWpcomCredentials(outletId, parsed, r.rows[0]!);
  }

  return parsed;
}

async function maybeRefreshWpcomCredentials(
  outletId: string,
  credentials: Extract<WPCredentials, { authType: "wpcom-oauth" }>,
  row: Record<string, unknown>,
): Promise<WPCredentials | null> {
  const expiresAt = row.wpcom_token_expires_at == null ? null : Number(row.wpcom_token_expires_at);
  if (!expiresAt || expiresAt - Date.now() > WPCOM_REFRESH_WINDOW_MS) return credentials;

  const refreshToken = readEncryptedToken(row.wpcom_refresh_token_encrypted);
  if (!refreshToken) {
    await recordOutletRefreshError(
      outletId,
      "WordPress.com token is expiring and no refresh token is available. Reconnect this outlet.",
    );
    return null;
  }

  try {
    const refreshed = await refreshWpcomAccessToken(refreshToken);
    const nextRefreshToken = refreshed.refreshToken ?? refreshToken;
    const nextCredentials = {
      ...credentials,
      accessToken: refreshed.accessToken,
    };
    const payload = stringifyWpcomPayload(nextCredentials);
    await db.execute({
      sql: `UPDATE outlets
            SET app_password_encrypted = ?,
                wpcom_token_expires_at = ?,
                wpcom_refresh_token_encrypted = ?,
                wpcom_token_kid = ?,
                last_error = NULL
            WHERE id = ?`,
      args: [
        secretStringToBlob(encryptSecret(`wpcom-oauth:${payload}`)),
        refreshed.expiresAt,
        secretStringToBlob(encryptSecret(nextRefreshToken)),
        WPCOM_TOKEN_KID,
        outletId,
      ],
    });
    return nextCredentials;
  } catch (err) {
    const message =
      err instanceof Error
        ? `WordPress.com token refresh failed: ${err.message}`
        : "WordPress.com token refresh failed.";
    await recordOutletRefreshError(outletId, message);
    return null;
  }
}

async function recordOutletRefreshError(outletId: string, message: string): Promise<void> {
  await db.execute({
    sql: `UPDATE outlets SET last_error = ? WHERE id = ?`,
    args: [message, outletId],
  });
}

async function revokeStoredWpcomTokens(row: Record<string, unknown>): Promise<void> {
  const accessPayload = readCredentialPayload(row.app_password_encrypted);
  const parsed = accessPayload ? parseCredentialPayload(accessPayload, "") : null;
  const tokens: string[] = [];
  if (parsed?.authType === "wpcom-oauth") tokens.push(parsed.accessToken);
  const refreshToken = readEncryptedToken(row.wpcom_refresh_token_encrypted);
  if (refreshToken) tokens.push(refreshToken);

  for (const token of tokens) {
    try {
      await revokeWpcomToken(token);
    } catch (err) {
      console.warn("WP.com token revoke failed:", err instanceof Error ? err.message : String(err));
    }
  }
}

function readCredentialPayload(blob: unknown): string | null {
  if (!blob) return null;
  try {
    const decoded = blobToSecretString(blob as ArrayBuffer | Uint8Array);
    return isEncryptedSecret(decoded) ? decryptSecret(decoded) : decoded;
  } catch (err) {
    console.warn(
      "WP.com token revoke skipped because stored credentials could not be decrypted:",
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }
}

function readEncryptedToken(blob: unknown): string | null {
  if (!blob) return null;
  try {
    const decoded = blobToSecretString(blob as ArrayBuffer | Uint8Array);
    return isEncryptedSecret(decoded) ? decryptSecret(decoded) : decoded;
  } catch {
    return null;
  }
}

function stringifyWpcomPayload(opts: {
  accessToken: string;
  siteId: string;
  siteUrl: string;
  username?: string | null;
}): string {
  return JSON.stringify({
    type: "wpcom-oauth",
    kid: WPCOM_TOKEN_KID,
    accessToken: opts.accessToken,
    siteId: opts.siteId,
    siteUrl: opts.siteUrl,
    username: opts.username ?? null,
  });
}

function parseCredentialPayload(payload: string, baseUrl: string): WPCredentials | null {
  if (payload.startsWith("wpcom-oauth:")) {
    try {
      const data = JSON.parse(payload.slice("wpcom-oauth:".length)) as {
        type?: string;
        accessToken?: string;
        siteId?: string;
        siteUrl?: string;
        username?: string | null;
      };
      if (data.type !== "wpcom-oauth" || !data.accessToken || !data.siteId || !data.siteUrl) {
        return null;
      }
      return {
        authType: "wpcom-oauth",
        baseUrl,
        accessToken: data.accessToken,
        siteId: data.siteId,
        siteUrl: data.siteUrl,
        username: data.username ?? null,
      };
    } catch {
      return null;
    }
  }
  const sep = payload.indexOf(":");
  if (sep < 0) return null;
  return {
    authType: "application-password",
    baseUrl,
    username: payload.slice(0, sep),
    appPassword: payload.slice(sep + 1),
  };
}

function secretStringToBlob(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, "utf8"));
}

function blobToSecretString(blob: ArrayBuffer | Uint8Array): string {
  if (blob instanceof Uint8Array) return Buffer.from(blob).toString("utf8");
  return Buffer.from(new Uint8Array(blob)).toString("utf8");
}

function hostFromUrl(s: string): string {
  try {
    return new URL(s).host.replace(/^www\./, "");
  } catch {
    return s;
  }
}

// ===== outlet ↔ source assignment =====
//
// An outlet with NO rows in outlet_sources reads from all the user's
// sources (zero-config default). Once you add a row, assignment narrows to
// the listed sources plus sources with no explicit outlet assignment. That
// keeps unassigned sources visible as "all outlets default" instead of
// letting them disappear behind an outlet filter.

/**
 * IDs of sources assigned to an outlet. Returns null if no assignment
 * rows exist, which means "all sources" default.
 */
export async function getAssignedSourceIds(outletId: string): Promise<string[] | null> {
  await ensureSchema();
  const r = await db.execute({
    sql: `SELECT source_id FROM outlet_sources WHERE outlet_id = ?`,
    args: [outletId],
  });
  if (r.rows.length === 0) return null;
  return r.rows.map((row) => String(row.source_id));
}

/**
 * Outlet IDs this source is explicitly assigned to. A source not in any
 * outlet_sources row is implicitly "in scope for all outlets"; surface that
 * in the UI as "All outlets (default)".
 */
export async function getOutletIdsForSource(sourceId: string): Promise<string[]> {
  await ensureSchema();
  const r = await db.execute({
    sql: `SELECT outlet_id FROM outlet_sources WHERE source_id = ?`,
    args: [sourceId],
  });
  return r.rows.map((row) => String(row.outlet_id));
}

/**
 * Replace a source's outlet assignment with the given list. If `outletIds`
 * is empty, the source falls back to "All outlets (default)".
 *
 * Tenancy: caller must pass the session userId. The source AND every
 * outlet in the list must belong to that user; otherwise the call throws
 * without mutating anything. Prevents cross-user assignment writes via a
 * known source/outlet id pair.
 */
export async function setSourceOutlets(
  sourceId: string,
  outletIds: string[],
  userId: string,
): Promise<void> {
  await ensureSchema();
  const owner = await db.execute({
    sql: `SELECT 1 FROM sources WHERE id = ? AND user_id = ?`,
    args: [sourceId, userId],
  });
  if (owner.rows.length === 0) throw new Error("Source not found.");

  if (outletIds.length > 0) {
    const placeholders = outletIds.map(() => "?").join(",");
    const ownedOutlets = await db.execute({
      sql: `SELECT id FROM outlets WHERE user_id = ? AND id IN (${placeholders})`,
      args: [userId, ...outletIds],
    });
    if (ownedOutlets.rows.length !== outletIds.length) {
      throw new Error("Outlet not found.");
    }
  }

  await db.execute({
    sql: `DELETE FROM outlet_sources
          WHERE source_id = ?
            AND source_id IN (SELECT id FROM sources WHERE user_id = ?)`,
    args: [sourceId, userId],
  });
  if (outletIds.length === 0) return;
  const now = Date.now();
  await db.batch(
    outletIds.map((oid) => ({
      sql: `INSERT OR IGNORE INTO outlet_sources (outlet_id, source_id, created_at)
            VALUES (?, ?, ?)`,
      args: [oid, sourceId, now],
    })),
    "write",
  );
}

/**
 * Resolve the actual source IDs an outlet reads from right now. If the
 * outlet has explicit assignments, returns those plus unassigned default
 * sources. If empty, returns ALL the user's source IDs (zero-config default).
 * Use this at draft time and for any per-outlet ranker query.
 */
export async function resolveOutletSourceIds(userId: string, outletId: string): Promise<string[]> {
  await ensureSchema();
  const explicit = await getAssignedSourceIds(outletId);
  if (explicit !== null) {
    const unassigned = await db.execute({
      sql: `SELECT s.id FROM sources s
            WHERE s.user_id = ?
              AND NOT EXISTS (
                SELECT 1 FROM outlet_sources os WHERE os.source_id = s.id
              )`,
      args: [userId],
    });
    return Array.from(new Set([...explicit, ...unassigned.rows.map((row) => String(row.id))]));
  }
  const all = await db.execute({
    sql: `SELECT id FROM sources WHERE user_id = ?`,
    args: [userId],
  });
  return all.rows.map((row) => String(row.id));
}

/**
 * Bulk lookup: outlet assignments for many sources at once. Returns a map
 * of `sourceId -> outletId[]`. Sources with no rows omit from the map.
 * Used by the sources index to render outlet chips on every row in one
 * query instead of N+1.
 */
export async function getOutletAssignmentsForSources(
  sourceIds: string[],
): Promise<Map<string, string[]>> {
  await ensureSchema();
  const map = new Map<string, string[]>();
  if (sourceIds.length === 0) return map;
  const placeholders = sourceIds.map(() => "?").join(",");
  const r = await db.execute({
    sql: `SELECT source_id, outlet_id FROM outlet_sources
          WHERE source_id IN (${placeholders})`,
    args: sourceIds,
  });
  for (const row of r.rows) {
    const sid = String(row.source_id);
    const oid = String(row.outlet_id);
    const arr = map.get(sid);
    if (arr) arr.push(oid);
    else map.set(sid, [oid]);
  }
  return map;
}
