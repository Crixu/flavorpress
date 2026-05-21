import Link from "next/link";
import type { AdminUserRow } from "@/lib/admin";
import { SubmitButton, PendingMessage } from "../../../_components/SubmitButton";
import { setUserAdminAction, setUserPlanAction, setUserStatusAction } from "../actions";

interface AdminUsersSectionProps {
  currentUserId: string;
  users: AdminUserRow[];
  returnTo?: "admin" | "users";
}

export function AdminUsersSection({
  currentUserId,
  users,
  returnTo = "admin",
}: AdminUsersSectionProps) {
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
          className="hidden border-b min-[1320px]:grid min-[1320px]:grid-cols-[minmax(220px,1fr)_minmax(320px,1.1fr)_minmax(360px,1.8fr)]"
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
              className="grid gap-5 px-5 py-5 min-[1320px]:grid-cols-[minmax(220px,1fr)_minmax(320px,1.1fr)_minmax(360px,1.8fr)]"
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
                <div className="mt-1 text-[11px]" style={{ color: "var(--fg-muted)" }}>
                  Last active {formatLastActiveDay(user.lastActiveAt)}
                </div>
              </div>
              <Usage user={user} />
              <UserControls user={user} isSelf={user.id === currentUserId} returnTo={returnTo} />
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function Usage({ user }: { user: AdminUserRow }) {
  return (
    <div className="grid grid-cols-2 gap-4 text-sm xl:grid-cols-4">
      <UsageCell label="Outlets" count={user.outletCount} limit={user.limits.outlets} />
      <UsageCell label="Sources" count={user.sourceCount} limit={user.limits.sources} />
      <UsageCell label="Folders" count={user.folderCount} limit={user.limits.folders} />
      <UsageCount label="WP Pushes" count={user.wpPushCount} />
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

function UsageCount({ label, count }: { label: string; count: number }) {
  return (
    <div>
      <div className="fp-eyebrow">{label}</div>
      <div className="mt-1 font-semibold tabular">{count}</div>
    </div>
  );
}

function UserControls({
  user,
  isSelf,
  returnTo,
}: {
  user: AdminUserRow;
  isSelf: boolean;
  returnTo: "admin" | "users";
}) {
  return (
    <div className="grid gap-3">
      <form action={setUserPlanAction} className="grid gap-3">
        <input type="hidden" name="returnTo" value={returnTo} />
        <input type="hidden" name="userId" value={user.id} />
        <div className="grid gap-3 min-[1400px]:grid-cols-[minmax(136px,0.6fr)_minmax(270px,1.4fr)]">
          <label className="grid gap-1.5">
            <span className="fp-eyebrow">Plan</span>
            <select name="plan" defaultValue={user.plan} className="fp-input">
              <option value="trial">Trial</option>
              <option value="pro">Pro</option>
              <option value="custom">Custom</option>
            </select>
          </label>
          <div className="grid grid-cols-3 gap-2">
            <LimitInput
              name="customOutletLimit"
              label="Outlets"
              defaultValue={user.limits.outlets}
            />
            <LimitInput
              name="customSourceLimit"
              label="Sources"
              defaultValue={user.limits.sources}
            />
            <LimitInput
              name="customFolderLimit"
              label="Folders"
              defaultValue={user.limits.folders}
            />
          </div>
        </div>
        <div className="grid gap-3 min-[1400px]:grid-cols-[minmax(0,1fr)_auto] min-[1400px]:items-start">
          <label className="flex min-h-11 items-start gap-2 rounded-md border px-3 py-2.5 text-sm">
            <input
              type="checkbox"
              name="pollAllEnabled"
              value="1"
              defaultChecked={user.pollAllEnabled}
              className="mt-1"
            />
            <span>
              <span className="font-medium">Allow Poll all</span>
              <span className="mt-0.5 block text-xs" style={{ color: "var(--fg-muted)" }}>
                Custom-plan users can poll every active source at once.
              </span>
            </span>
          </label>
          <div className="flex items-center gap-3 min-[1400px]:justify-end">
            <SubmitButton className="fp-btn fp-btn-ghost" pendingLabel="Saving">
              Save plan
            </SubmitButton>
            <PendingMessage>Saving plan limits.</PendingMessage>
          </div>
        </div>
      </form>
      <div
        className="flex flex-wrap gap-2 border-t pt-3 min-[1400px]:justify-end"
        style={{ borderColor: "var(--border)" }}
      >
        <Link href={`/settings/admin/users/${user.id}`} className="fp-btn fp-btn-ghost">
          View sources
        </Link>
        <form action={setUserAdminAction}>
          <input type="hidden" name="returnTo" value={returnTo} />
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
          <input type="hidden" name="returnTo" value={returnTo} />
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

function formatLastActiveDay(value: number | null) {
  return value == null ? "never" : formatDate(value);
}
