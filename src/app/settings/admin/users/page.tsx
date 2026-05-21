import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { AuthRequiredError, requireSession, shouldShowAdminControls } from "@/lib/session";
import { loadAdminSnapshot } from "@/lib/admin";
import { SettingsSidebar } from "../../_components/SettingsSidebar";
import { AdminUsersSection } from "../_components/AdminUsersSection";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{
    error?: string;
    saved?: string;
  }>;
}

export default async function AdminUsersPage({ searchParams }: PageProps) {
  let session;
  try {
    session = await requireSession();
  } catch (err) {
    if (err instanceof AuthRequiredError) redirect("/login");
    throw err;
  }
  if (!shouldShowAdminControls(session)) redirect("/settings");

  const [sp, snapshot] = await Promise.all([searchParams, loadAdminSnapshot()]);

  return (
    <div className="fp-settings-shell">
      <SettingsSidebar active="admin-users" showAdmin />
      <div className="fp-settings-detail">
        <div className="space-y-8">
          <header className="space-y-4">
            <Link href="/settings/admin" className="fp-btn fp-btn-ghost">
              Back to admin
            </Link>
            <div>
              <div className="fp-eyebrow">Admin / Users</div>
              <h1
                className="mt-2 font-semibold tracking-tight"
                style={{ fontSize: "var(--type-h1)", lineHeight: 1.15 }}
              >
                Users
              </h1>
              <p className="mt-2 max-w-2xl text-sm" style={{ color: "var(--fg-muted)" }}>
                Manage writer access, plan caps, and source libraries across this deployment.
              </p>
            </div>
          </header>

          {sp.saved ? <Banner kind="success">Saved {savedLabel(sp.saved)}.</Banner> : null}
          {sp.error === "self_admin" ? (
            <Banner kind="error">You cannot remove your own admin access.</Banner>
          ) : null}
          {sp.error === "self_status" ? (
            <Banner kind="error">You cannot suspend your own account.</Banner>
          ) : null}

          <AdminUsersSection
            users={snapshot.users}
            currentUserId={session.userId}
            returnTo="users"
          />
        </div>
      </div>
    </div>
  );
}

function Banner({ kind, children }: { kind: "success" | "error"; children: ReactNode }) {
  const palette =
    kind === "success"
      ? { bg: "var(--emerald-tint)", fg: "var(--emerald)" }
      : { bg: "var(--rose-tint)", fg: "var(--rose)" };
  return (
    <div
      className="rounded-lg px-4 py-3 text-sm"
      style={{ background: palette.bg, color: palette.fg }}
    >
      {children}
    </div>
  );
}

function savedLabel(key: string): string {
  if (key === "role") return "role";
  if (key === "status") return "status";
  if (key === "plan") return "plan";
  return "user";
}
