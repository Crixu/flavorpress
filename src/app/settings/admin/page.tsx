import { redirect } from "next/navigation";
import Link from "next/link";
import type { ReactNode } from "react";
import { AuthRequiredError, requireSession, shouldShowAdminControls } from "@/lib/session";
import { loadAdminSnapshot, type AdminUserRow } from "@/lib/admin";
import { PLAN_LIMITS } from "@/lib/plans";
import { PendingMessage, SubmitButton } from "../../_components/SubmitButton";
import { SettingsSidebar } from "../_components/SettingsSidebar";
import {
  issueInviteAction,
  setUserAdminAction,
  setUserPlanAction,
  setUserStatusAction,
} from "./actions";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{
    created_invite?: string;
    error?: string;
    saved?: string;
  }>;
}

export default async function AdminPage({ searchParams }: PageProps) {
  let session;
  try {
    session = await requireSession();
  } catch (err) {
    if (err instanceof AuthRequiredError) redirect("/login");
    throw err;
  }
  if (!shouldShowAdminControls(session)) redirect("/settings");

  const sp = await searchParams;
  const snapshot = await loadAdminSnapshot();

  return (
    <div className="fp-settings-shell">
      <SettingsSidebar active="admin" showAdmin />
      <div className="fp-settings-detail">
        <div className="space-y-8">
          <header className="flex flex-wrap items-end justify-between gap-6">
            <div>
              <div className="fp-eyebrow">Admin</div>
              <h1
                className="mt-2 font-semibold tracking-tight"
                style={{ fontSize: "var(--type-h1)", lineHeight: 1.15 }}
              >
                Deployment controls
              </h1>
              <p className="mt-2 max-w-2xl text-sm" style={{ color: "var(--fg-muted)" }}>
                Manage access, plan caps, and source health across the FlavorPress deployment.
              </p>
            </div>
            <InviteForm />
          </header>

          {sp.created_invite ? (
            <Banner kind="success">
              Invite created: <code>/signup?invite={sp.created_invite}</code>
            </Banner>
          ) : null}
          {sp.saved ? <Banner kind="success">Saved {savedLabel(sp.saved)}.</Banner> : null}
          {sp.error === "self_admin" ? (
            <Banner kind="error">You cannot remove your own admin access.</Banner>
          ) : null}
          {sp.error === "self_status" ? (
            <Banner kind="error">You cannot suspend your own account.</Banner>
          ) : null}

          <PlanCards />
          <UsersSection users={snapshot.users} currentUserId={session.userId} />
          <InvitesSection invites={snapshot.invites} now={snapshot.now} />
        </div>
      </div>
    </div>
  );
}

function InviteForm() {
  return (
    <form action={issueInviteAction} className="flex flex-wrap items-end gap-3">
      <label className="grid gap-1.5">
        <span className="fp-eyebrow">Expires</span>
        <select name="expiresInDays" defaultValue="14" className="fp-input min-w-36">
          <option value="7">7 days</option>
          <option value="14">14 days</option>
          <option value="30">30 days</option>
          <option value="0">Never</option>
        </select>
      </label>
      <SubmitButton className="fp-btn fp-btn-primary" pendingLabel="Creating">
        Create invite
      </SubmitButton>
    </form>
  );
}

function PlanCards() {
  const cards = [
    { name: "Trial", limits: PLAN_LIMITS.trial, hint: "Default for new signups." },
    { name: "Pro", limits: PLAN_LIMITS.pro, hint: "Paid tier." },
    { name: "Custom", limits: null, hint: null },
  ];
  return (
    <section className="grid gap-3 md:grid-cols-3" aria-label="Plan limits">
      {cards.map((card) => (
        <div key={card.name} className="fp-card p-5">
          <div className="fp-eyebrow">Plan tier</div>
          <div className="mt-1.5 flex items-baseline justify-between gap-2">
            <div className="text-lg font-semibold tracking-tight">{card.name}</div>
            {card.hint ? (
              <div className="text-[11px]" style={{ color: "var(--fg-subtle)" }}>
                {card.hint}
              </div>
            ) : null}
          </div>
          {card.limits ? (
            <dl
              className="mt-4 grid grid-cols-3 gap-3 border-t pt-4 text-sm"
              style={{ borderColor: "var(--border)" }}
            >
              <Limit label="Outlets" value={card.limits.outlets} />
              <Limit label="Sources" value={card.limits.sources} />
              <Limit label="Folders" value={card.limits.folders} />
            </dl>
          ) : (
            <p
              className="mt-4 border-t pt-4 text-sm leading-relaxed"
              style={{ borderColor: "var(--border)", color: "var(--fg-muted)" }}
            >
              Per-user limits set by an admin.
            </p>
          )}
        </div>
      ))}
    </section>
  );
}

function Limit({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt className="fp-eyebrow">{label}</dt>
      <dd className="mt-1 text-xl font-semibold tabular">{value}</dd>
    </div>
  );
}

function UsersSection({ users, currentUserId }: { users: AdminUserRow[]; currentUserId: string }) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Users</h2>
        <p className="mt-1 text-sm" style={{ color: "var(--fg-muted)" }}>
          Roles, account status, plan caps, and per-user source libraries.
        </p>
      </div>
      <div className="fp-card overflow-hidden">
        <div
          className="hidden border-b md:grid md:grid-cols-[minmax(240px,1.4fr)_minmax(260px,1fr)_minmax(360px,1.8fr)]"
          style={{ borderColor: "var(--border)", background: "var(--surface-subtle)" }}
        >
          <div className="fp-eyebrow px-5 py-3">User</div>
          <div className="fp-eyebrow px-5 py-3">Usage</div>
          <div className="fp-eyebrow px-5 py-3">Controls</div>
        </div>
        <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
          {users.map((user) => (
            <li
              key={user.id}
              className="grid gap-5 px-5 py-5 md:grid-cols-[minmax(240px,1.4fr)_minmax(260px,1fr)_minmax(360px,1.8fr)]"
            >
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold">{user.email}</div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <span className={user.isAdmin ? "fp-chip fp-chip-indigo" : "fp-chip"}>
                    {user.isAdmin ? "Admin" : "Writer"}
                  </span>
                  <span
                    className={
                      user.status === "active" ? "fp-chip fp-chip-emerald" : "fp-chip fp-chip-rose"
                    }
                  >
                    {user.status}
                  </span>
                  <span className="fp-chip">{planLabel(user.plan)}</span>
                </div>
                <div className="mt-2 text-[11px]" style={{ color: "var(--fg-muted)" }}>
                  Joined {formatDate(user.createdAt)}
                </div>
              </div>
              <Usage user={user} />
              <UserControls user={user} isSelf={user.id === currentUserId} />
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function Usage({ user }: { user: AdminUserRow }) {
  return (
    <div className="grid grid-cols-3 gap-4 text-sm">
      <UsageCell label="Outlets" count={user.outletCount} limit={user.limits.outlets} />
      <UsageCell label="Sources" count={user.sourceCount} limit={user.limits.sources} />
      <UsageCell label="Folders" count={user.folderCount} limit={user.limits.folders} />
    </div>
  );
}

function UsageCell({ label, count, limit }: { label: string; count: number; limit: number }) {
  const over = count > limit;
  return (
    <div>
      <div className="fp-eyebrow">{label}</div>
      <div
        className="mt-1 font-semibold tabular"
        style={over ? { color: "var(--error-fg)" } : undefined}
      >
        {count}
        <span className="font-normal" style={{ color: "var(--fg-subtle)" }}>
          {" / "}
          {limit}
        </span>
      </div>
    </div>
  );
}

function UserControls({ user, isSelf }: { user: AdminUserRow; isSelf: boolean }) {
  return (
    <div className="grid gap-4">
      <form action={setUserPlanAction} className="grid gap-3">
        <input type="hidden" name="userId" value={user.id} />
        <label className="grid gap-1.5">
          <span className="fp-eyebrow">Plan</span>
          <select name="plan" defaultValue={user.plan} className="fp-input">
            <option value="trial">Trial</option>
            <option value="pro">Pro</option>
            <option value="custom">Custom</option>
          </select>
        </label>
        <div className="grid grid-cols-3 gap-2">
          <LimitInput name="customOutletLimit" label="Outlets" defaultValue={user.limits.outlets} />
          <LimitInput name="customSourceLimit" label="Sources" defaultValue={user.limits.sources} />
          <LimitInput name="customFolderLimit" label="Folders" defaultValue={user.limits.folders} />
        </div>
        <div className="flex items-center gap-3">
          <SubmitButton className="fp-btn fp-btn-ghost" pendingLabel="Saving">
            Save plan
          </SubmitButton>
          <PendingMessage>Saving plan limits.</PendingMessage>
        </div>
      </form>
      <div className="flex flex-wrap gap-2 border-t pt-3" style={{ borderColor: "var(--border)" }}>
        <Link href={`/settings/admin/users/${user.id}`} className="fp-btn fp-btn-ghost">
          View sources
        </Link>
        <form action={setUserAdminAction}>
          <input type="hidden" name="userId" value={user.id} />
          <input type="hidden" name="admin" value={user.isAdmin ? "0" : "1"} />
          <SubmitButton
            className="fp-btn fp-btn-ghost"
            pendingLabel="Saving"
            disabled={isSelf && user.isAdmin}
          >
            {user.isAdmin ? "Remove admin" : "Promote"}
          </SubmitButton>
        </form>
        <form action={setUserStatusAction}>
          <input type="hidden" name="userId" value={user.id} />
          <input
            type="hidden"
            name="status"
            value={user.status === "active" ? "suspended" : "active"}
          />
          <SubmitButton
            className={user.status === "active" ? "fp-btn fp-btn-ghost" : "fp-btn fp-btn-primary"}
            pendingLabel="Saving"
            disabled={isSelf && user.status === "active"}
          >
            {user.status === "active" ? "Suspend" : "Reactivate"}
          </SubmitButton>
        </form>
      </div>
    </div>
  );
}

function LimitInput({
  name,
  label,
  defaultValue,
}: {
  name: string;
  label: string;
  defaultValue: number;
}) {
  return (
    <label className="grid gap-1.5">
      <span className="fp-eyebrow">{label}</span>
      <input
        name={name}
        type="number"
        min="1"
        defaultValue={defaultValue}
        className="fp-input tabular"
        aria-label={`Custom ${label.toLowerCase()} limit`}
      />
    </label>
  );
}

function InvitesSection({
  invites,
  now,
}: {
  invites: Awaited<ReturnType<typeof loadAdminSnapshot>>["invites"];
  now: number;
}) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Invites</h2>
        <p className="mt-1 text-sm" style={{ color: "var(--fg-muted)" }}>
          Recent invitation links and who used them.
        </p>
      </div>
      <div className="fp-card overflow-hidden">
        {invites.length === 0 ? (
          <div className="px-5 py-8 text-center text-sm" style={{ color: "var(--fg-muted)" }}>
            No invites yet. Use the form above to create one.
          </div>
        ) : (
          <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
            {invites.map((invite) => (
              <li
                key={invite.token}
                className="grid gap-3 px-5 py-4 md:grid-cols-[1fr_120px_180px] md:items-center"
              >
                <div className="min-w-0">
                  <code
                    className="block truncate text-xs"
                    style={{ color: "var(--ink-secondary)" }}
                  >
                    /signup?invite={invite.token}
                  </code>
                  <div className="mt-1 text-[11px]" style={{ color: "var(--fg-muted)" }}>
                    Created by {invite.createdByEmail ?? "system"} on {formatDate(invite.createdAt)}
                  </div>
                </div>
                <div>
                  <span
                    className={
                      invite.usedAt
                        ? "fp-chip"
                        : invite.expiresAt && invite.expiresAt <= now
                          ? "fp-chip fp-chip-rose"
                          : "fp-chip fp-chip-emerald"
                    }
                  >
                    {invite.usedAt
                      ? "Used"
                      : invite.expiresAt && invite.expiresAt <= now
                        ? "Expired"
                        : "Open"}
                  </span>
                </div>
                <div className="text-xs" style={{ color: "var(--fg-muted)" }}>
                  {invite.usedByEmail
                    ? `Used by ${invite.usedByEmail}`
                    : invite.expiresAt
                      ? `Expires ${formatDate(invite.expiresAt)}`
                      : "No expiration"}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
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
  return "source";
}

function planLabel(plan: string) {
  if (plan === "pro") return "Pro";
  if (plan === "custom") return "Custom";
  return "Trial";
}

function formatDate(value: number) {
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" }).format(
    new Date(value),
  );
}
