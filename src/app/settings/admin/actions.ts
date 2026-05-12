"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { issueInvite, revokeInvite } from "@/lib/invites";
import { db, ensureSchema } from "@/lib/db";
import { requireSession, shouldShowAdminControls } from "@/lib/session";
import { setUserPlan, type PlanKey } from "@/lib/plans";

async function requireAdmin() {
  const session = await requireSession();
  if (!shouldShowAdminControls(session)) redirect("/settings");
  return session;
}

function adminRedirect(params: Record<string, string>, path = "/settings/admin") {
  const sp = new URLSearchParams(params);
  redirect(`${path}?${sp.toString()}`);
}

export async function issueInviteAction(formData: FormData): Promise<void> {
  await ensureSchema();
  const session = await requireAdmin();
  const days = Number(formData.get("expiresInDays") ?? 14);
  const expiresAt = Number.isFinite(days) && days > 0 ? Date.now() + days * 24 * 3600 * 1000 : null;
  const invite = await issueInvite({ createdByUserId: session.userId, expiresAt });
  revalidatePath("/settings/admin");
  adminRedirect({ created_invite: invite.token });
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
  if (!userId) throw new Error("userId required.");
  if (userId === session.userId && !admin) adminRedirect({ error: "self_admin" });
  await db.execute({
    sql: `UPDATE users
          SET is_admin = ?, session_version = session_version + 1
          WHERE id = ?`,
    args: [admin ? 1 : 0, userId],
  });
  revalidatePath("/settings/admin");
  adminRedirect({ saved: "role" });
}

export async function setUserStatusAction(formData: FormData): Promise<void> {
  await ensureSchema();
  const session = await requireAdmin();
  const userId = String(formData.get("userId") ?? "");
  const status = String(formData.get("status") ?? "") === "suspended" ? "suspended" : "active";
  if (!userId) throw new Error("userId required.");
  if (userId === session.userId && status === "suspended") adminRedirect({ error: "self_status" });
  await db.execute({
    sql: `UPDATE users
          SET status = ?, session_version = session_version + 1
          WHERE id = ?`,
    args: [status, userId],
  });
  revalidatePath("/settings/admin");
  adminRedirect({ saved: "status" });
}

export async function setUserPlanAction(formData: FormData): Promise<void> {
  await ensureSchema();
  await requireAdmin();
  const userId = String(formData.get("userId") ?? "");
  const rawPlan = String(formData.get("plan") ?? "trial");
  const plan: PlanKey = rawPlan === "pro" || rawPlan === "custom" ? rawPlan : "trial";
  if (!userId) throw new Error("userId required.");
  await setUserPlan(userId, plan, {
    outlets: Number(formData.get("customOutletLimit") ?? 0),
    sources: Number(formData.get("customSourceLimit") ?? 0),
    folders: Number(formData.get("customFolderLimit") ?? 0),
  });
  revalidatePath("/settings/admin");
  adminRedirect({ saved: "plan" });
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
