import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { AuthRequiredError, requireSession, shouldShowAdminControls } from "@/lib/session";
import { EXTENSION_METADATA, findExtensionMetadata } from "@/extensions/registry";
import { loadAdminExtensionAccessSnapshot, type AdminExtensionAccessUserRow } from "@/lib/admin";
import { SubmitButton } from "../../../_components/SubmitButton";
import { SettingsSidebar } from "../../_components/SettingsSidebar";
import { toggleGlobalExtensionAction, toggleUserExtensionForAdminAction } from "../actions";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{
    error?: string;
    saved?: string;
    extension?: string;
    state?: string;
  }>;
}

export default async function AdminExtensionsPage({ searchParams }: PageProps) {
  let session;
  try {
    session = await requireSession();
  } catch (err) {
    if (err instanceof AuthRequiredError) redirect("/login");
    throw err;
  }
  if (!shouldShowAdminControls(session)) redirect("/settings");

  const sp = await searchParams;
  const access = await loadAdminExtensionAccessSnapshot();
  const globallyDisabled = new Set(access.globallyDisabledExtensionIds);

  return (
    <div className="fp-settings-shell">
      <SettingsSidebar active="admin-extensions" showAdmin />
      <div className="fp-settings-detail">
        <div className="space-y-8">
          <header className="space-y-4">
            <Link href="/settings/admin" className="fp-btn fp-btn-ghost">
              Back to admin
            </Link>
            <div>
              <div className="fp-eyebrow">Admin / Extensions</div>
              <h1
                className="mt-2 font-semibold tracking-tight"
                style={{ fontSize: "var(--type-h1)", lineHeight: 1.15 }}
              >
                Extensions
              </h1>
              <p className="mt-2 max-w-2xl text-sm" style={{ color: "var(--fg-muted)" }}>
                Disable an extension across the whole deployment, or block access for individual
                users. Admin blocks are enforced at runtime, so a user cannot re-enable a blocked
                extension from their own settings.
              </p>
            </div>
          </header>

          {sp.saved === "global_extension" &&
          sp.extension &&
          (sp.state === "enabled" || sp.state === "disabled") ? (
            <Banner kind="success">
              {sp.state === "enabled" ? "Enabled" : "Disabled"} {extensionLabelFor(sp.extension)}{" "}
              globally.
            </Banner>
          ) : null}
          {sp.saved === "extension_access" &&
          sp.extension &&
          (sp.state === "enabled" || sp.state === "disabled") ? (
            <Banner kind="success">
              {sp.state === "enabled" ? "Allowed access to" : "Blocked access to"}{" "}
              {extensionLabelFor(sp.extension)}.
            </Banner>
          ) : null}
          {sp.error === "invalid_extension" ? (
            <Banner kind="error">Unknown extension.</Banner>
          ) : null}
          {sp.error === "extension_locked_globally" ? (
            <Banner kind="error">That extension is disabled globally.</Banner>
          ) : null}

          <section className="space-y-3">
            <div>
              <h2 className="text-lg font-semibold tracking-tight">Deployment access</h2>
              <p className="mt-1 text-sm" style={{ color: "var(--fg-muted)" }}>
                A global block wins over every user-level setting.
              </p>
            </div>
            <div className="fp-card overflow-hidden">
              <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
                {EXTENSION_METADATA.map((extension) => {
                  const isGloballyDisabled = globallyDisabled.has(extension.id);
                  const adminBlockedCount = access.users.filter((user) =>
                    user.adminDisabledExtensionIds.includes(extension.id),
                  ).length;
                  const selfDisabledCount = access.users.filter((user) =>
                    user.selfDisabledExtensionIds.includes(extension.id),
                  ).length;
                  return (
                    <li
                      key={extension.id}
                      className="grid gap-4 px-5 py-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center"
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="truncate text-sm font-semibold">{extension.label}</span>
                          <span
                            className={
                              isGloballyDisabled
                                ? "fp-chip fp-chip-rose"
                                : "fp-chip fp-chip-emerald"
                            }
                          >
                            {isGloballyDisabled ? "Disabled globally" : "Available"}
                          </span>
                          {adminBlockedCount > 0 ? (
                            <span className="fp-chip">
                              {adminBlockedCount} user block
                              {adminBlockedCount === 1 ? "" : "s"}
                            </span>
                          ) : null}
                          {selfDisabledCount > 0 ? (
                            <span className="fp-chip">{selfDisabledCount} user disabled</span>
                          ) : null}
                        </div>
                        <p
                          className="mt-1 text-xs leading-relaxed"
                          style={{ color: "var(--fg-muted)" }}
                        >
                          {extension.description}
                        </p>
                      </div>
                      <form action={toggleGlobalExtensionAction} className="md:justify-self-end">
                        <input type="hidden" name="extensionId" value={extension.id} />
                        <input
                          type="hidden"
                          name="enabled"
                          value={isGloballyDisabled ? "1" : "0"}
                        />
                        <SubmitButton
                          className={
                            isGloballyDisabled ? "fp-btn fp-btn-primary" : "fp-btn fp-btn-ghost"
                          }
                          pendingLabel={isGloballyDisabled ? "Enabling" : "Disabling"}
                        >
                          {isGloballyDisabled ? "Enable globally" : "Disable globally"}
                        </SubmitButton>
                      </form>
                    </li>
                  );
                })}
              </ul>
            </div>
          </section>

          <UserAccessSection
            users={access.users}
            globallyDisabledExtensionIds={access.globallyDisabledExtensionIds}
          />
        </div>
      </div>
    </div>
  );
}

function UserAccessSection({
  users,
  globallyDisabledExtensionIds,
}: {
  users: AdminExtensionAccessUserRow[];
  globallyDisabledExtensionIds: string[];
}) {
  const globallyDisabled = new Set(globallyDisabledExtensionIds);
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">User access</h2>
        <p className="mt-1 text-sm" style={{ color: "var(--fg-muted)" }}>
          Block an extension for one user without hiding it from the rest of the deployment.
        </p>
      </div>
      {users.length === 0 ? (
        <div className="fp-card px-5 py-8 text-center text-sm" style={{ color: "var(--fg-muted)" }}>
          No users yet.
        </div>
      ) : (
        <div className="space-y-4">
          {EXTENSION_METADATA.map((extension) => {
            const isGloballyDisabled = globallyDisabled.has(extension.id);
            return (
              <div key={extension.id} className="fp-card overflow-hidden">
                <div
                  className="flex flex-wrap items-start justify-between gap-3 border-b px-5 py-4"
                  style={{ borderColor: "var(--border)" }}
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-semibold">{extension.label}</h3>
                      {isGloballyDisabled ? (
                        <span className="fp-chip fp-chip-rose">Disabled globally</span>
                      ) : (
                        <span className="fp-chip fp-chip-emerald">Available</span>
                      )}
                    </div>
                    <p
                      className="mt-1 max-w-2xl text-xs leading-relaxed"
                      style={{ color: "var(--fg-muted)" }}
                    >
                      {extension.description}
                    </p>
                  </div>
                </div>
                <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
                  {users.map((user) => (
                    <UserAccessRow
                      key={`${extension.id}:${user.id}`}
                      user={user}
                      extensionId={extension.id}
                      isGloballyDisabled={isGloballyDisabled}
                    />
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function UserAccessRow({
  user,
  extensionId,
  isGloballyDisabled,
}: {
  user: AdminExtensionAccessUserRow;
  extensionId: string;
  isGloballyDisabled: boolean;
}) {
  const isAdminDisabled = user.adminDisabledExtensionIds.includes(extensionId);
  const isSelfDisabled = user.selfDisabledExtensionIds.includes(extensionId);
  return (
    <li className="grid gap-4 px-5 py-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate text-sm font-medium">{user.email}</span>
          {user.isAdmin ? <span className="fp-chip fp-chip-indigo">Admin</span> : null}
          {user.status === "suspended" ? (
            <span className="fp-chip fp-chip-rose">Suspended</span>
          ) : null}
          {isGloballyDisabled ? (
            <span className="fp-chip fp-chip-rose">Globally blocked</span>
          ) : isAdminDisabled ? (
            <span className="fp-chip fp-chip-rose">Access blocked</span>
          ) : (
            <span className="fp-chip fp-chip-emerald">Access allowed</span>
          )}
          {!isGloballyDisabled && !isAdminDisabled && isSelfDisabled ? (
            <span className="fp-chip fp-chip-amber">User disabled</span>
          ) : null}
        </div>
      </div>
      {isGloballyDisabled ? (
        <button type="button" className="fp-btn fp-btn-ghost md:justify-self-end" disabled>
          Locked
        </button>
      ) : (
        <form action={toggleUserExtensionForAdminAction} className="md:justify-self-end">
          <input type="hidden" name="returnTo" value="extensions" />
          <input type="hidden" name="userId" value={user.id} />
          <input type="hidden" name="extensionId" value={extensionId} />
          <input type="hidden" name="enabled" value={isAdminDisabled ? "1" : "0"} />
          <SubmitButton
            className={isAdminDisabled ? "fp-btn fp-btn-primary" : "fp-btn fp-btn-ghost"}
            pendingLabel={isAdminDisabled ? "Allowing" : "Blocking"}
          >
            {isAdminDisabled ? "Allow access" : "Block access"}
          </SubmitButton>
        </form>
      )}
    </li>
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

function extensionLabelFor(id: string) {
  return findExtensionMetadata(id)?.label ?? "extension";
}
