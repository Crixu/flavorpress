/**
 * Outlets — a writer's WordPress publishing destinations.
 *
 * One author can have many outlets. Each outlet has its own voice profile
 * (built from that outlet's WP archive) and its own credentials. Drafts
 * pick an outlet at the moment of draft.
 *
 * The "is_default" flag picks which outlet a draft uses when the author
 * doesn't choose explicitly. There is at most one default per user.
 */

import { db, ensureSchema, SINGLE_USER_ID } from "../db";
import type { WPCredentials } from "../wordpress";

export type OutletKind =
  | "wp-org"
  | "wp-com"
  | "jetpack-managed"
  | "multisite"
  | "unknown"
  | null;

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
  };
}

const OUTLET_COLS = `id, user_id, base_url, display_name, username,
  app_password_encrypted, kind, is_default, last_error,
  connected_at, created_at, last_used_at`;

export async function listOutlets(userId = SINGLE_USER_ID): Promise<Outlet[]> {
  await ensureSchema();
  const r = await db.execute({
    sql: `SELECT ${OUTLET_COLS} FROM outlets WHERE user_id = ? ORDER BY is_default DESC, created_at ASC`,
    args: [userId],
  });
  return r.rows.map((row) => rowToOutlet(row as unknown as OutletRow));
}

export async function getOutlet(
  outletId: string,
  userId = SINGLE_USER_ID,
): Promise<Outlet | null> {
  await ensureSchema();
  const r = await db.execute({
    sql: `SELECT ${OUTLET_COLS} FROM outlets WHERE id = ? AND user_id = ?`,
    args: [outletId, userId],
  });
  if (r.rows.length === 0) return null;
  return rowToOutlet(r.rows[0] as unknown as OutletRow);
}

export async function getDefaultOutlet(
  userId = SINGLE_USER_ID,
): Promise<Outlet | null> {
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
  const id = crypto.randomUUID();
  await db.execute({
    sql: `INSERT INTO outlets (id, user_id, base_url, display_name, created_at)
          VALUES (?, ?, ?, ?, ?)`,
    args: [
      id,
      userId,
      baseUrl,
      displayName ?? hostFromUrl(baseUrl),
      Date.now(),
    ],
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
  const blob = new Uint8Array(Buffer.from(`${username}:${cleaned}`, "utf8"));
  await db.execute({
    sql: `UPDATE outlets
          SET username = ?, app_password_encrypted = ?, kind = ?,
              connected_at = ?, last_error = NULL
          WHERE id = ?`,
    args: [username, blob, kind, Date.now(), outletId],
  });

  // First-connected becomes default.
  const outletRow = await db.execute({
    sql: `SELECT user_id FROM outlets WHERE id = ?`,
    args: [outletId],
  });
  if (outletRow.rows.length === 0) return;
  const userId = String(outletRow.rows[0]!.user_id);
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

export async function setDefaultOutlet(
  outletId: string,
  userId = SINGLE_USER_ID,
): Promise<void> {
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
  userId = SINGLE_USER_ID,
): Promise<void> {
  await ensureSchema();
  if (opts.purge) {
    await db.batch(
      [
        {
          sql: `DELETE FROM voice_profiles WHERE outlet_id = ?`,
          args: [outletId],
        },
        {
          sql: `DELETE FROM outlets WHERE id = ? AND user_id = ?`,
          args: [outletId, userId],
        },
      ],
      "write",
    );
    return;
  }
  await db.execute({
    sql: `UPDATE outlets
          SET app_password_encrypted = NULL,
              username = NULL,
              connected_at = NULL,
              last_error = NULL
          WHERE id = ? AND user_id = ?`,
    args: [outletId, userId],
  });
}

/**
 * Decrypt outlet credentials for the publish capability.
 *
 * v1 alpha stores the credential bytes as `username:password` UTF-8.
 * Envelope encryption (KMS-backed DEK) ships in week 2.
 */
export async function getOutletCredentials(
  outletId: string,
): Promise<WPCredentials | null> {
  await ensureSchema();
  const r = await db.execute({
    sql: `SELECT base_url, app_password_encrypted FROM outlets WHERE id = ?`,
    args: [outletId],
  });
  if (r.rows.length === 0) return null;
  const blob = r.rows[0]!.app_password_encrypted as ArrayBuffer | null;
  if (!blob) return null;
  const decoded = Buffer.from(new Uint8Array(blob)).toString("utf8");
  const sep = decoded.indexOf(":");
  if (sep < 0) return null;
  const username = decoded.slice(0, sep);
  const appPassword = decoded.slice(sep + 1);
  return {
    baseUrl: String(r.rows[0]!.base_url),
    username,
    appPassword,
  };
}

function hostFromUrl(s: string): string {
  try {
    return new URL(s).host.replace(/^www\./, "");
  } catch {
    return s;
  }
}
