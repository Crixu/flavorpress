"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { issueInvite, revokeInvite } from "@/lib/invites";
import { db, ensureSchema } from "@/lib/db";
import { requireSession, shouldShowAdminControls } from "@/lib/session";
import { normalizePlanKey, setUserPlan } from "@/lib/plans";
import { findExtensionMetadata } from "@/extensions/registry";
import {
  getGloballyDisabledExtensionIds,
  setExtensionGloballyEnabled,
  setExtensionPaidPlanRequired,
  setUserExtensionAccess,
} from "@/lib/v1/settings";

async function requireAdmin() {
  const session = await requireSession();
  if (!shouldShowAdminControls(session)) redirect("/settings");
  return session;
}

function adminRedirect(params: Record<string, string>, path = "/settings/admin") {
  const sp = new URLSearchParams(params);
  redirect(`${path}?${sp.toString()}`);
}

function userAdminPath(formData: FormData): string {
  return String(formData.get("returnTo") ?? "") === "users"
    ? "/settings/admin/users"
    : "/settings/admin";
}

export async function issueInviteAction(formData: FormData): Promise<void> {
  await ensureSchema();
  const session = await requireAdmin();
  const days = Number(formData.get("expiresInDays") ?? 14);
  const plan = normalizePlanKey(String(formData.get("plan") ?? "trial"));
  const expiresAt = Number.isFinite(days) && days > 0 ? Date.now() + days * 24 * 3600 * 1000 : null;
  const invite = await issueInvite({ createdByUserId: session.userId, expiresAt, plan });
  revalidatePath("/settings/admin");
  adminRedirect({ created_invite: invite.token, created_plan: plan });
}

export async function revokeInviteAction(formData: FormData): Promise<void> {
  await ensureSchema();
  await requireAdmin();
  const token = String(formData.get("token") ?? "").trim();
  if (!token) throw new Error("token required.");
  await revokeInvite(token);
  revalidatePath("/settings/admin");
  adminRedirect({ revoked: "invite" });
}

export async function setUserAdminAction(formData: FormData): Promise<void> {
  await ensureSchema();
  const session = await requireAdmin();
  const userId = String(formData.get("userId") ?? "");
  const admin = String(formData.get("admin") ?? "") === "1";
  const path = userAdminPath(formData);
  if (!userId) throw new Error("userId required.");
  if (userId === session.userId && !admin) adminRedirect({ error: "self_admin" }, path);
  await db.execute({
    sql: `UPDATE users
          SET is_admin = ?, session_version = session_version + 1
          WHERE id = ?`,
    args: [admin ? 1 : 0, userId],
  });
  revalidatePath("/settings/admin");
  revalidatePath("/settings/admin/users");
  adminRedirect({ saved: "role" }, path);
}

export async function setUserStatusAction(formData: FormData): Promise<void> {
  await ensureSchema();
  const session = await requireAdmin();
  const userId = String(formData.get("userId") ?? "");
  const status = String(formData.get("status") ?? "") === "suspended" ? "suspended" : "active";
  const path = userAdminPath(formData);
  if (!userId) throw new Error("userId required.");
  if (userId === session.userId && status === "suspended") {
    adminRedirect({ error: "self_status" }, path);
  }
  await db.execute({
    sql: `UPDATE users
          SET status = ?, session_version = session_version + 1
          WHERE id = ?`,
    args: [status, userId],
  });
  revalidatePath("/settings/admin");
  revalidatePath("/settings/admin/users");
  adminRedirect({ saved: "status" }, path);
}

export async function setUserPlanAction(formData: FormData): Promise<void> {
  await ensureSchema();
  await requireAdmin();
  const userId = String(formData.get("userId") ?? "");
  const rawPlan = String(formData.get("plan") ?? "trial");
  const plan = normalizePlanKey(rawPlan);
  const path = userAdminPath(formData);
  if (!userId) throw new Error("userId required.");
  await setUserPlan(userId, plan, {
    outlets: Number(formData.get("customOutletLimit") ?? 0),
    sources: Number(formData.get("customSourceLimit") ?? 0),
    folders: Number(formData.get("customFolderLimit") ?? 0),
    pollAllEnabled: formData.get("pollAllEnabled") === "1",
  });
  revalidatePath("/settings/admin");
  revalidatePath("/settings/admin/users");
  revalidatePath(`/settings/admin/users/${userId}`);
  revalidatePath("/");
  revalidatePath("/sources");
  revalidatePath("/voice");
  revalidatePath("/voice/[outletId]", "page");
  adminRedirect({ saved: "plan" }, path);
}

export async function toggleGlobalExtensionAction(formData: FormData): Promise<void> {
  await ensureSchema();
  await requireAdmin();
  const extensionId = String(formData.get("extensionId") ?? "");
  const enabled = String(formData.get("enabled") ?? "") === "1";
  const path = "/settings/admin/extensions";
  if (!findExtensionMetadata(extensionId)) {
    adminRedirect({ error: "invalid_extension" }, path);
  }
  await setExtensionGloballyEnabled(extensionId, enabled);
  revalidatePath(path);
  revalidatePath("/settings");
  revalidatePath("/settings/admin");
  revalidatePath("/settings/admin/users/[userId]", "page");
  revalidatePath("/editor", "layout");
  adminRedirect(
    {
      saved: "global_extension",
      extension: extensionId,
      state: enabled ? "enabled" : "disabled",
    },
    path,
  );
}

export async function togglePaidExtensionAction(formData: FormData): Promise<void> {
  await ensureSchema();
  await requireAdmin();
  const extensionId = String(formData.get("extensionId") ?? "");
  const paidRequired = String(formData.get("paidRequired") ?? "") === "1";
  const path = "/settings/admin/extensions";
  if (!findExtensionMetadata(extensionId)) {
    adminRedirect({ error: "invalid_extension" }, path);
  }
  await setExtensionPaidPlanRequired(extensionId, paidRequired);
  revalidatePath(path);
  revalidatePath("/settings");
  revalidatePath("/settings/admin");
  revalidatePath("/settings/admin/users/[userId]", "page");
  revalidatePath("/editor", "layout");
  adminRedirect(
    {
      saved: "extension_plan",
      extension: extensionId,
      state: paidRequired ? "paid" : "included",
    },
    path,
  );
}

export async function toggleUserExtensionForAdminAction(formData: FormData): Promise<void> {
  await ensureSchema();
  await requireAdmin();
  const userId = String(formData.get("userId") ?? "");
  const extensionId = String(formData.get("extensionId") ?? "");
  const enabled = String(formData.get("enabled") ?? "") === "1";
  const returnTo = String(formData.get("returnTo") ?? "");
  if (!userId) throw new Error("userId required.");
  const path =
    returnTo === "extensions" ? "/settings/admin/extensions" : `/settings/admin/users/${userId}`;
  if (!findExtensionMetadata(extensionId)) {
    adminRedirect({ error: "invalid_extension" }, path);
  }

  const userR = await db.execute({ sql: `SELECT id FROM users WHERE id = ?`, args: [userId] });
  if (userR.rows.length === 0) redirect("/settings/admin");

  const globallyDisabled = await getGloballyDisabledExtensionIds();
  if (globallyDisabled.has(extensionId)) {
    adminRedirect({ error: "extension_locked_globally" }, path);
  }

  await setUserExtensionAccess(extensionId, userId, enabled);
  revalidatePath("/settings/admin");
  revalidatePath("/settings/admin/extensions");
  revalidatePath(path);
  revalidatePath("/settings");
  revalidatePath("/editor", "layout");
  adminRedirect(
    {
      saved: "extension_access",
      extension: extensionId,
      state: enabled ? "enabled" : "disabled",
    },
    path,
  );
}

export async function pauseSourceForAdminAction(formData: FormData): Promise<void> {
  await ensureSchema();
  await requireAdmin();
  const sourceId = String(formData.get("sourceId") ?? "");
  const userId = String(formData.get("userId") ?? "");
  const days = Number(formData.get("days") ?? 7);
  if (!sourceId || !userId) throw new Error("sourceId and userId required.");
  const pausedUntil =
    Date.now() + (Number.isFinite(days) && days > 0 ? days : 7) * 24 * 3600 * 1000;
  await db.execute({
    sql: `UPDATE sources SET paused_until = ? WHERE id = ? AND user_id = ?`,
    args: [pausedUntil, sourceId, userId],
  });
  revalidatePath("/settings/admin");
  revalidatePath(`/settings/admin/users/${userId}`);
  revalidatePath("/sources");
  adminRedirect({ saved: "source" }, `/settings/admin/users/${userId}`);
}

export async function resumeSourceForAdminAction(formData: FormData): Promise<void> {
  await ensureSchema();
  await requireAdmin();
  const sourceId = String(formData.get("sourceId") ?? "");
  const userId = String(formData.get("userId") ?? "");
  if (!sourceId || !userId) throw new Error("sourceId and userId required.");
  await db.execute({
    sql: `UPDATE sources SET paused_until = NULL WHERE id = ? AND user_id = ?`,
    args: [sourceId, userId],
  });
  revalidatePath("/settings/admin");
  revalidatePath(`/settings/admin/users/${userId}`);
  revalidatePath("/sources");
  adminRedirect({ saved: "source" }, `/settings/admin/users/${userId}`);
}

export async function deleteSourceForAdminAction(formData: FormData): Promise<void> {
  await ensureSchema();
  await requireAdmin();
  const sourceId = String(formData.get("sourceId") ?? "");
  const userId = String(formData.get("userId") ?? "");
  if (!sourceId || !userId) throw new Error("sourceId and userId required.");
  await db.batch(
    [
      { sql: `DELETE FROM outlet_sources WHERE source_id = ?`, args: [sourceId] },
      { sql: `DELETE FROM items WHERE source_id = ? AND user_id = ?`, args: [sourceId, userId] },
      { sql: `DELETE FROM sources WHERE id = ? AND user_id = ?`, args: [sourceId, userId] },
    ],
    "write",
  );
  revalidatePath("/settings/admin");
  revalidatePath(`/settings/admin/users/${userId}`);
  revalidatePath("/sources");
  adminRedirect({ saved: "source" }, `/settings/admin/users/${userId}`);
}
