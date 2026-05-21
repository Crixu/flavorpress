import "server-only";
import { db, ensureSchema } from "./db";
import { limitsForPlan, normalizePlanKey, type PlanKey, type PlanLimits } from "./plans";
import { loadReadingToWritingMetrics, type ReadingToWritingMetrics } from "./v1/analytics";
import {
  getAdminDisabledExtensionIds,
  getDisabledExtensionIds,
  getGloballyDisabledExtensionIds,
} from "./v1/settings";

export interface AdminUserRow {
  id: string;
  email: string;
  status: "active" | "suspended";
  isAdmin: boolean;
  createdAt: number;
  lastActiveAt: number | null;
  outletCount: number;
  sourceCount: number;
  folderCount: number;
  wpPushCount: number;
  plan: PlanKey;
  limits: PlanLimits;
  pollAllEnabled: boolean;
}

export interface AdminInviteRow {
  token: string;
  createdByEmail: string | null;
  usedByEmail: string | null;
  plan: PlanKey;
  createdAt: number;
  expiresAt: number | null;
  usedAt: number | null;
  revokedAt: number | null;
}

export interface AdminSourceRow {
  id: string;
  userId: string;
  userEmail: string;
  kind: string;
  url: string;
  displayName: string | null;
  folderName: string | null;
  active: boolean;
  pausedUntil: number | null;
  lastError: string | null;
  createdAt: number;
}

export interface AdminOutletRow {
  id: string;
  baseUrl: string;
  displayName: string | null;
  kind: string | null;
  connected: boolean;
  isDefault: boolean;
  lastError: string | null;
  createdAt: number;
}

export interface AdminOutletStats {
  total: number;
  connected: number;
  staged: number;
  withErrors: number;
  usersWithConnectedOutlets: number;
}

export interface AdminFolderRow {
  id: string;
  name: string;
  sourceCount: number;
  createdAt: number;
}

export interface AdminSnapshot {
  users: AdminUserRow[];
  invites: AdminInviteRow[];
  outletStats: AdminOutletStats;
  readingToWriting: ReadingToWritingMetrics;
  now: number;
}

export interface AdminExtensionAccessUserRow {
  id: string;
  email: string;
  status: "active" | "suspended";
  isAdmin: boolean;
  adminDisabledExtensionIds: string[];
  selfDisabledExtensionIds: string[];
}

export interface AdminExtensionAccessSnapshot {
  users: AdminExtensionAccessUserRow[];
  globallyDisabledExtensionIds: string[];
  now: number;
}

export interface AdminUserDetailSnapshot {
  user: AdminUserRow;
  outlets: AdminOutletRow[];
  folders: AdminFolderRow[];
  sources: AdminSourceRow[];
  disabledExtensionIds: string[];
  adminDisabledExtensionIds: string[];
  globallyDisabledExtensionIds: string[];
  now: number;
}

function mapAdminUserRow(row: Record<string, unknown>): AdminUserRow {
  const id = String(row.id);
  const plan = normalizePlanKey(row.plan);
  const limits = limitsForPlan(plan, {
    outlets: row.custom_outlet_limit,
    sources: row.custom_source_limit,
    folders: row.custom_folder_limit,
  });
  return {
    id,
    email: String(row.email),
    status: String(row.status) === "suspended" ? "suspended" : "active",
    isAdmin: Number(row.is_admin) === 1,
    createdAt: Number(row.created_at),
    lastActiveAt: row.last_active_at == null ? null : Number(row.last_active_at),
    outletCount: Number(row.outlet_count ?? 0),
    sourceCount: Number(row.source_count ?? 0),
    folderCount: Number(row.folder_count ?? 0),
    wpPushCount: Number(row.wp_push_count ?? 0),
    plan,
    limits,
    pollAllEnabled: plan === "custom" && Number(row.poll_all_enabled ?? 0) === 1,
  };
}

export async function loadAdminSnapshot(): Promise<AdminSnapshot> {
  await ensureSchema();
  const now = Date.now();
  const [adminRows, readingToWriting] = await Promise.all([
    db.batch(
      [
        {
          sql: `SELECT u.id, u.email, u.status, u.is_admin, u.created_at, u.last_active_at,
                       COUNT(DISTINCT o.id) AS outlet_count,
                       COUNT(DISTINCT s.id) AS source_count,
                       COUNT(DISTINCT f.id) AS folder_count,
                       COUNT(DISTINCT e.idempotency_key) AS wp_push_count,
                       p.plan AS plan,
                       p.custom_outlet_limit AS custom_outlet_limit,
                       p.custom_source_limit AS custom_source_limit,
                       p.custom_folder_limit AS custom_folder_limit,
                       p.poll_all_enabled AS poll_all_enabled
                FROM users u
                LEFT JOIN outlets o ON o.user_id = u.id
                LEFT JOIN sources s ON s.user_id = u.id
                LEFT JOIN source_folders f ON f.user_id = u.id
                LEFT JOIN event_log e ON e.user_id = u.id AND e.type = 'wordpress.pushed'
                LEFT JOIN user_plans p ON p.user_id = u.id
                GROUP BY u.id
                ORDER BY u.created_at DESC`,
          args: [],
        },
        {
          sql: `SELECT i.token, i.plan, i.created_at, i.expires_at, i.used_at, i.revoked_at,
                       creator.email AS created_by_email,
                       used.email AS used_by_email
                FROM (
                  SELECT token, created_by_user_id, used_by_user_id, plan, created_at,
                         expires_at, used_at, revoked_at, 0 AS sort_bucket, created_at AS sort_at
                  FROM invites
                  WHERE used_at IS NULL
                  UNION ALL
                  SELECT token, created_by_user_id, used_by_user_id, plan, created_at,
                         expires_at, used_at, revoked_at, 1 AS sort_bucket, used_at AS sort_at
                  FROM (
                    SELECT token, created_by_user_id, used_by_user_id, plan, created_at,
                           expires_at, used_at, revoked_at
                    FROM invites
                    WHERE used_at IS NOT NULL
                    ORDER BY used_at DESC
                    LIMIT 5
                  )
                ) i
                LEFT JOIN users creator ON creator.id = i.created_by_user_id
                LEFT JOIN users used ON used.id = i.used_by_user_id
                ORDER BY i.sort_bucket ASC, i.sort_at DESC`,
          args: [],
        },
        {
          sql: `SELECT COUNT(*) AS total,
                       SUM(CASE WHEN app_password_encrypted IS NOT NULL THEN 1 ELSE 0 END) AS connected,
                       SUM(CASE WHEN app_password_encrypted IS NULL THEN 1 ELSE 0 END) AS staged,
                       SUM(CASE WHEN last_error IS NOT NULL AND TRIM(last_error) <> '' THEN 1 ELSE 0 END) AS with_errors,
                       COUNT(DISTINCT CASE WHEN app_password_encrypted IS NOT NULL THEN user_id END) AS users_with_connected_outlets
                FROM outlets`,
          args: [],
        },
      ],
      "read",
    ),
    loadReadingToWritingMetrics(),
  ]);
  const [usersR, invitesR, outletStatsR] = adminRows;

  const users = (usersR.rows as Record<string, unknown>[]).map(mapAdminUserRow);

  const invites = (invitesR.rows as Record<string, unknown>[]).map((row) => ({
    token: String(row.token),
    createdByEmail: row.created_by_email == null ? null : String(row.created_by_email),
    usedByEmail: row.used_by_email == null ? null : String(row.used_by_email),
    plan: normalizePlanKey(row.plan),
    createdAt: Number(row.created_at),
    expiresAt: row.expires_at == null ? null : Number(row.expires_at),
    usedAt: row.used_at == null ? null : Number(row.used_at),
    revokedAt: row.revoked_at == null ? null : Number(row.revoked_at),
  }));

  const outletStatsRow = (outletStatsR.rows as Record<string, unknown>[])[0] ?? {};
  const outletStats: AdminOutletStats = {
    total: Number(outletStatsRow.total ?? 0),
    connected: Number(outletStatsRow.connected ?? 0),
    staged: Number(outletStatsRow.staged ?? 0),
    withErrors: Number(outletStatsRow.with_errors ?? 0),
    usersWithConnectedOutlets: Number(outletStatsRow.users_with_connected_outlets ?? 0),
  };

  return { users, invites, outletStats, readingToWriting, now };
}

export async function loadAdminExtensionAccessSnapshot(): Promise<AdminExtensionAccessSnapshot> {
  await ensureSchema();
  const [rows, globallyDisabled] = await Promise.all([
    db.batch(
      [
        {
          sql: `SELECT id, email, status, is_admin
                FROM users
                ORDER BY email ASC`,
          args: [],
        },
        {
          sql: `SELECT user_id, extension_id
                FROM user_extension_access
                WHERE enabled = 0
                ORDER BY user_id ASC, extension_id ASC`,
          args: [],
        },
        {
          sql: `SELECT user_id, value
                FROM user_settings
                WHERE key = 'disabled_extensions'`,
          args: [],
        },
      ],
      "read",
    ),
    getGloballyDisabledExtensionIds(),
  ]);
  const [usersR, accessR, selfSettingsR] = rows;
  const adminDisabledByUser = new Map<string, string[]>();
  for (const row of accessR.rows as Record<string, unknown>[]) {
    const userId = String(row.user_id);
    const list = adminDisabledByUser.get(userId) ?? [];
    list.push(String(row.extension_id));
    adminDisabledByUser.set(userId, list);
  }

  const selfDisabledByUser = new Map<string, string[]>();
  for (const row of selfSettingsR.rows as Record<string, unknown>[]) {
    const userId = String(row.user_id);
    let parsed: unknown;
    try {
      parsed = JSON.parse(String(row.value ?? ""));
    } catch {
      continue;
    }
    if (!Array.isArray(parsed)) continue;
    selfDisabledByUser.set(
      userId,
      parsed.filter((id): id is string => typeof id === "string").sort(),
    );
  }

  const users: AdminExtensionAccessUserRow[] = (usersR.rows as Record<string, unknown>[]).map(
    (row) => ({
      id: String(row.id),
      email: String(row.email),
      status: String(row.status) === "suspended" ? "suspended" : "active",
      isAdmin: Number(row.is_admin) === 1,
      adminDisabledExtensionIds: (adminDisabledByUser.get(String(row.id)) ?? []).sort(),
      selfDisabledExtensionIds: selfDisabledByUser.get(String(row.id)) ?? [],
    }),
  );

  return {
    users,
    globallyDisabledExtensionIds: [...globallyDisabled].sort(),
    now: Date.now(),
  };
}

export async function loadAdminUserDetailSnapshot(
  userId: string,
): Promise<AdminUserDetailSnapshot | null> {
  await ensureSchema();

  const [
    detailRows,
    disabledExtensionIds,
    adminDisabledExtensionIds,
    globallyDisabledExtensionIds,
  ] = await Promise.all([
    db.batch(
      [
        {
          sql: `SELECT u.id, u.email, u.status, u.is_admin, u.created_at, u.last_active_at,
                       COUNT(DISTINCT o.id) AS outlet_count,
                       COUNT(DISTINCT s.id) AS source_count,
                       COUNT(DISTINCT f.id) AS folder_count,
                       COUNT(DISTINCT e.idempotency_key) AS wp_push_count,
                       p.plan AS plan,
                       p.custom_outlet_limit AS custom_outlet_limit,
                       p.custom_source_limit AS custom_source_limit,
                       p.custom_folder_limit AS custom_folder_limit,
                       p.poll_all_enabled AS poll_all_enabled
                FROM users u
                LEFT JOIN outlets o ON o.user_id = u.id
                LEFT JOIN sources s ON s.user_id = u.id
                LEFT JOIN source_folders f ON f.user_id = u.id
                LEFT JOIN event_log e ON e.user_id = u.id AND e.type = 'wordpress.pushed'
                LEFT JOIN user_plans p ON p.user_id = u.id
                WHERE u.id = ?
                GROUP BY u.id`,
          args: [userId],
        },
        {
          sql: `SELECT id, base_url, display_name, kind, app_password_encrypted,
                       is_default, last_error, created_at
                FROM outlets
                WHERE user_id = ?
                ORDER BY is_default DESC, created_at DESC`,
          args: [userId],
        },
        {
          sql: `SELECT f.id, f.name, f.created_at, COUNT(s.id) AS source_count
                FROM source_folders f
                LEFT JOIN sources s ON s.folder_id = f.id AND s.user_id = f.user_id
                WHERE f.user_id = ?
                GROUP BY f.id
                ORDER BY f.sort_order ASC, f.name ASC`,
          args: [userId],
        },
        {
          sql: `SELECT s.id, s.user_id, u.email AS user_email, s.kind, s.url,
                       s.display_name, f.name AS folder_name, s.active,
                       s.paused_until, s.last_error, s.created_at
                FROM sources s
                JOIN users u ON u.id = s.user_id
                LEFT JOIN source_folders f ON f.id = s.folder_id
                WHERE s.user_id = ?
                ORDER BY f.name IS NULL ASC, f.name ASC, s.created_at DESC`,
          args: [userId],
        },
      ],
      "read",
    ),
    getDisabledExtensionIds(userId),
    getAdminDisabledExtensionIds(userId),
    getGloballyDisabledExtensionIds(),
  ]);
  const [userR, outletsR, foldersR, sourcesR] = detailRows;

  const userRow = (userR.rows as Record<string, unknown>[])[0];
  if (!userRow) return null;
  const user = mapAdminUserRow(userRow);

  const outlets = (outletsR.rows as Record<string, unknown>[]).map((row) => ({
    id: String(row.id),
    baseUrl: String(row.base_url),
    displayName: row.display_name == null ? null : String(row.display_name),
    kind: row.kind == null ? null : String(row.kind),
    connected: row.app_password_encrypted != null,
    isDefault: Number(row.is_default ?? 0) === 1,
    lastError: row.last_error == null ? null : String(row.last_error),
    createdAt: Number(row.created_at),
  }));

  const folders = (foldersR.rows as Record<string, unknown>[]).map((row) => ({
    id: String(row.id),
    name: String(row.name),
    sourceCount: Number(row.source_count ?? 0),
    createdAt: Number(row.created_at),
  }));

  const sources = (sourcesR.rows as Record<string, unknown>[]).map((row) => ({
    id: String(row.id),
    userId: String(row.user_id),
    userEmail: String(row.user_email),
    kind: String(row.kind),
    url: String(row.url),
    displayName: row.display_name == null ? null : String(row.display_name),
    folderName: row.folder_name == null ? null : String(row.folder_name),
    active: Number(row.active ?? 0) === 1,
    pausedUntil: row.paused_until == null ? null : Number(row.paused_until),
    lastError: row.last_error == null ? null : String(row.last_error),
    createdAt: Number(row.created_at),
  }));

  return {
    user,
    outlets,
    folders,
    sources,
    disabledExtensionIds: [...disabledExtensionIds].sort(),
    adminDisabledExtensionIds: [...adminDisabledExtensionIds].sort(),
    globallyDisabledExtensionIds: [...globallyDisabledExtensionIds].sort(),
    now: Date.now(),
  };
}
