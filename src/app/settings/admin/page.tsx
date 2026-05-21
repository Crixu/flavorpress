import { redirect } from "next/navigation";
import Link from "next/link";
import type { ReactNode } from "react";
import { AuthRequiredError, requireSession, shouldShowAdminControls } from "@/lib/session";
import { loadAdminSnapshot } from "@/lib/admin";
import type { ReadingToWritingMetrics } from "@/lib/v1/analytics";
import { PLAN_LIMITS } from "@/lib/plans";
import { getOrigin } from "@/lib/v1/origin";
import { SubmitButton } from "../../_components/SubmitButton";
import { SettingsSidebar } from "../_components/SettingsSidebar";
import { AdminUsersSection } from "./_components/AdminUsersSection";
import { issueInviteAction, revokeInviteAction } from "./actions";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{
    created_invite?: string;
    created_plan?: string;
    error?: string;
    saved?: string;
    revoked?: string;
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
  const [snapshot, origin] = await Promise.all([loadAdminSnapshot(), getOrigin()]);
  const createdInviteUrl = sp.created_invite ? inviteUrl(origin, sp.created_invite) : null;

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

          {createdInviteUrl ? (
            <Banner kind="success">
              {planLabel(sp.created_plan ?? "trial")} invite created:{" "}
              <code className="break-all">{createdInviteUrl}</code>
            </Banner>
          ) : null}
          {sp.saved ? <Banner kind="success">Saved {savedLabel(sp.saved)}.</Banner> : null}
          {sp.revoked === "invite" ? <Banner kind="success">Invite revoked.</Banner> : null}
          {sp.error === "self_admin" ? (
            <Banner kind="error">You cannot remove your own admin access.</Banner>
          ) : null}
          {sp.error === "self_status" ? (
            <Banner kind="error">You cannot suspend your own account.</Banner>
          ) : null}

          <AdminLinks />
          <PlanCards />
          <OutletStatsWidget stats={snapshot.outletStats} />
          <ReadingToWritingSection metrics={snapshot.readingToWriting} />
          <AdminUsersSection users={snapshot.users} currentUserId={session.userId} />
          <InvitesSection invites={snapshot.invites} now={snapshot.now} origin={origin} />
        </div>
      </div>
    </div>
  );
}

function AdminLinks() {
  return (
    <section className="grid gap-3 md:grid-cols-2" aria-label="Admin sections">
      <Link href="/settings/admin/users" className="fp-card block p-5 transition hover:shadow-sm">
        <div className="fp-eyebrow">Admin / Users</div>
        <div className="mt-1.5 text-lg font-semibold tracking-tight">Users</div>
        <p className="mt-2 text-sm" style={{ color: "var(--fg-muted)" }}>
          Manage roles, status, plan caps, and per-user source libraries.
        </p>
      </Link>
      <Link
        href="/settings/admin/extensions"
        className="fp-card block p-5 transition hover:shadow-sm"
      >
        <div className="fp-eyebrow">Admin / Extensions</div>
        <div className="mt-1.5 text-lg font-semibold tracking-tight">Extensions</div>
        <p className="mt-2 text-sm" style={{ color: "var(--fg-muted)" }}>
          Control deployment-wide extension access and user-level blocks.
        </p>
      </Link>
    </section>
  );
}

function InviteForm() {
  return (
    <form action={issueInviteAction} className="flex flex-wrap items-end gap-3">
      <label className="grid gap-1.5">
        <span className="fp-eyebrow">Plan</span>
        <select name="plan" defaultValue="trial" className="fp-input min-w-32">
          <option value="trial">Trial</option>
          <option value="pro">Pro</option>
          <option value="custom">Custom</option>
        </select>
      </label>
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

function OutletStatsWidget({
  stats,
}: {
  stats: Awaited<ReturnType<typeof loadAdminSnapshot>>["outletStats"];
}) {
  const connectionRate =
    stats.total === 0 ? "0%" : `${Math.round((stats.connected / stats.total) * 100)}%`;
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Connected outlets</h2>
        <p className="mt-1 text-sm" style={{ color: "var(--fg-muted)" }}>
          WordPress destinations ready to receive drafts across this deployment.
        </p>
      </div>
      <div className="fp-card p-5">
        <div className="grid gap-5 md:grid-cols-[minmax(180px,0.9fr)_1fr] md:items-end">
          <div>
            <div className="fp-eyebrow">Ready outlets</div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-4xl font-semibold tabular tracking-tight">
                {stats.connected}
              </span>
              <span className="text-sm tabular" style={{ color: "var(--fg-muted)" }}>
                / {stats.total}
              </span>
            </div>
            <div className="mt-2 text-xs" style={{ color: "var(--fg-muted)" }}>
              {connectionRate} connected
            </div>
          </div>
          <dl
            className="grid grid-cols-3 gap-3 border-t pt-4 md:border-l md:border-t-0 md:pl-5 md:pt-0"
            style={{ borderColor: "var(--border)" }}
          >
            <OutletStat label="Staged" value={stats.staged} />
            <OutletStat label="Errors" value={stats.withErrors} danger={stats.withErrors > 0} />
            <OutletStat label="Writers" value={stats.usersWithConnectedOutlets} />
          </dl>
        </div>
      </div>
    </section>
  );
}

function OutletStat({
  label,
  value,
  danger = false,
}: {
  label: string;
  value: number;
  danger?: boolean;
}) {
  return (
    <div>
      <dt className="fp-eyebrow">{label}</dt>
      <dd
        className="mt-1 text-xl font-semibold tabular"
        style={danger ? { color: "var(--error-fg)" } : undefined}
      >
        {value}
      </dd>
    </div>
  );
}

function PlanCards() {
  const cards = [
    { name: "Trial", limits: PLAN_LIMITS.trial, hint: "Default for new signups." },
    { name: "Pro", limits: PLAN_LIMITS.pro, hint: "Paid tier." },
    { name: "Custom", limits: null, hint: "Per-user caps and Poll all access." },
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

function ReadingToWritingSection({ metrics }: { metrics: ReadingToWritingMetrics }) {
  const cards = [
    { label: "Sources added", value: metrics.sourcesAdded },
    { label: "Clusters created", value: metrics.clustersCreated },
    { label: "Clusters surfaced", value: metrics.clustersSurfaced },
    { label: "Drafts rendered", value: metrics.draftsRendered },
    { label: "WP pushes", value: metrics.wordpressPushes },
  ];
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Reading to writing</h2>
        <p className="mt-1 text-sm" style={{ color: "var(--fg-muted)" }}>
          First-party event counts for the source to WordPress path. Counts start when tracking
          landed.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {cards.map((card) => (
          <div key={card.label} className="fp-card p-5">
            <div className="fp-eyebrow">{card.label}</div>
            <div className="mt-2 text-3xl font-semibold tabular tracking-tight">{card.value}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

function InvitesSection({
  invites,
  now,
  origin,
}: {
  invites: Awaited<ReturnType<typeof loadAdminSnapshot>>["invites"];
  now: number;
  origin: string;
}) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Invites</h2>
        <p className="mt-1 text-sm" style={{ color: "var(--fg-muted)" }}>
          Pending invitation links and the five most recent used links.
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
                className="grid gap-3 px-5 py-4 md:grid-cols-[minmax(0,1fr)_96px_120px_180px_112px] md:items-center"
              >
                <div className="min-w-0">
                  <code
                    className="block break-all text-xs"
                    style={{ color: "var(--ink-secondary)" }}
                  >
                    {inviteUrl(origin, invite.token)}
                  </code>
                  <div className="mt-1 text-[11px]" style={{ color: "var(--fg-muted)" }}>
                    Created by {invite.createdByEmail ?? "system"} on {formatDate(invite.createdAt)}
                  </div>
                </div>
                <div>
                  <span className="fp-chip">{planLabel(invite.plan)}</span>
                </div>
                <div>
                  <span
                    className={
                      invite.usedAt
                        ? "fp-chip"
                        : invite.revokedAt
                          ? "fp-chip"
                          : invite.expiresAt && invite.expiresAt <= now
                            ? "fp-chip fp-chip-rose"
                            : "fp-chip fp-chip-emerald"
                    }
                  >
                    {invite.usedAt
                      ? "Used"
                      : invite.revokedAt
                        ? "Revoked"
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
                <div className="flex md:justify-end">
                  {invite.usedAt || invite.revokedAt ? null : (
                    <form action={revokeInviteAction}>
                      <input type="hidden" name="token" value={invite.token} />
                      <SubmitButton className="fp-btn fp-btn-ghost" pendingLabel="Revoking">
                        Revoke
                      </SubmitButton>
                    </form>
                  )}
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

function inviteUrl(origin: string, token: string): string {
  return `${origin}/signup?invite=${encodeURIComponent(token)}`;
}
