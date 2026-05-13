import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { AuthRequiredError, requireSession, shouldShowAdminControls } from "@/lib/session";
import {
  loadAdminUserDetailSnapshot,
  type AdminFolderRow,
  type AdminOutletRow,
  type AdminSourceRow,
} from "@/lib/admin";
import { SubmitButton } from "../../../../_components/SubmitButton";
import { SettingsSidebar } from "../../../_components/SettingsSidebar";
import {
  deleteSourceForAdminAction,
  pauseSourceForAdminAction,
  resumeSourceForAdminAction,
} from "../../actions";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ userId: string }>;
  searchParams: Promise<{
    saved?: string;
  }>;
}

export default async function AdminUserPage({ params, searchParams }: PageProps) {
  let session;
  try {
    session = await requireSession();
  } catch (err) {
    if (err instanceof AuthRequiredError) redirect("/login");
    throw err;
  }
  if (!shouldShowAdminControls(session)) redirect("/settings");

  const { userId } = await params;
  const sp = await searchParams;
  const snapshot = await loadAdminUserDetailSnapshot(userId);
  if (!snapshot) redirect("/settings/admin");

  return (
    <div className="fp-settings-shell">
      <SettingsSidebar active="admin" showAdmin />
      <div className="fp-settings-detail">
        <div className="space-y-8">
          <header className="space-y-4">
            <Link href="/settings/admin" className="fp-btn fp-btn-ghost">
              Back to admin
            </Link>
            <div>
              <div className="fp-eyebrow">Admin / User sources</div>
              <h1
                className="mt-2 font-semibold tracking-tight"
                style={{ fontSize: "var(--type-h1)", lineHeight: 1.15 }}
              >
                {snapshot.user.email}
              </h1>
              <p className="mt-2 max-w-2xl text-sm" style={{ color: "var(--fg-muted)" }}>
                Inspect one user's outlets, folders, and source health without mixing libraries
                across the deployment.
              </p>
            </div>
          </header>

          {sp.saved ? <Banner>Saved source change.</Banner> : null}

          <UserSummary snapshot={snapshot} />
          <OutletsSection outlets={snapshot.outlets} />
          <FoldersSection folders={snapshot.folders} />
          <SourcesSection sources={snapshot.sources} now={snapshot.now} />
        </div>
      </div>
    </div>
  );
}

function UserSummary({
  snapshot,
}: {
  snapshot: NonNullable<Awaited<ReturnType<typeof loadAdminUserDetailSnapshot>>>;
}) {
  return (
    <section className="grid gap-3 md:grid-cols-5">
      <Metric label="Plan" value={planLabel(snapshot.user.plan)} />
      <Metric label="Poll all" value={snapshot.user.pollAllEnabled ? "Enabled" : "Off"} />
      <Metric
        label="Outlets"
        value={`${snapshot.user.outletCount} / ${snapshot.user.limits.outlets}`}
        over={snapshot.user.outletCount > snapshot.user.limits.outlets}
      />
      <Metric
        label="Sources"
        value={`${snapshot.user.sourceCount} / ${snapshot.user.limits.sources}`}
        over={snapshot.user.sourceCount > snapshot.user.limits.sources}
      />
      <Metric
        label="Folders"
        value={`${snapshot.user.folderCount} / ${snapshot.user.limits.folders}`}
        over={snapshot.user.folderCount > snapshot.user.limits.folders}
      />
    </section>
  );
}

function Metric({ label, value, over = false }: { label: string; value: string; over?: boolean }) {
  return (
    <div className="fp-card p-5">
      <div className="fp-eyebrow">{label}</div>
      <div
        className="mt-2 text-xl font-semibold tabular"
        style={over ? { color: "var(--error-fg)" } : undefined}
      >
        {value}
      </div>
    </div>
  );
}

function OutletsSection({ outlets }: { outlets: AdminOutletRow[] }) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Outlets</h2>
        <p className="mt-1 text-sm" style={{ color: "var(--fg-muted)" }}>
          Publishing destinations for this user.
        </p>
      </div>
      <div className="fp-card overflow-hidden">
        {outlets.length === 0 ? (
          <EmptyState>No outlets connected.</EmptyState>
        ) : (
          <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
            {outlets.map((outlet) => (
              <li key={outlet.id} className="grid gap-2 px-5 py-4 md:grid-cols-[1fr_auto]">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-semibold">
                      {outlet.displayName ?? hostFromUrl(outlet.baseUrl)}
                    </span>
                    {outlet.isDefault ? (
                      <span className="fp-chip fp-chip-indigo">Default</span>
                    ) : null}
                    <span className={outlet.connected ? "fp-chip fp-chip-emerald" : "fp-chip"}>
                      {outlet.connected ? "Connected" : "Staged"}
                    </span>
                  </div>
                  <div className="mt-1 truncate text-xs" style={{ color: "var(--fg-muted)" }}>
                    {outlet.baseUrl}
                  </div>
                  {outlet.lastError ? (
                    <div className="mt-1 truncate text-xs" style={{ color: "var(--error-fg)" }}>
                      {outlet.lastError}
                    </div>
                  ) : null}
                </div>
                <div className="text-xs" style={{ color: "var(--fg-muted)" }}>
                  {outlet.kind ?? "unknown"}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function FoldersSection({ folders }: { folders: AdminFolderRow[] }) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Folders</h2>
        <p className="mt-1 text-sm" style={{ color: "var(--fg-muted)" }}>
          Source grouping for this user's reading lanes.
        </p>
      </div>
      <div className="fp-card overflow-hidden">
        {folders.length === 0 ? (
          <EmptyState>No folders yet.</EmptyState>
        ) : (
          <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
            {folders.map((folder) => (
              <li
                key={folder.id}
                className="grid gap-2 px-5 py-4 md:grid-cols-[1fr_auto] md:items-center"
              >
                <div className="truncate text-sm font-semibold">{folder.name}</div>
                <div className="text-xs tabular" style={{ color: "var(--fg-muted)" }}>
                  {folder.sourceCount} {folder.sourceCount === 1 ? "source" : "sources"}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function SourcesSection({ sources, now }: { sources: AdminSourceRow[]; now: number }) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Sources</h2>
        <p className="mt-1 text-sm" style={{ color: "var(--fg-muted)" }}>
          Manage this user's feeds in their own context.
        </p>
      </div>
      <div className="fp-card overflow-hidden">
        {sources.length === 0 ? (
          <EmptyState>No sources yet.</EmptyState>
        ) : (
          <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
            {sources.map((source) => (
              <SourceRow key={source.id} source={source} now={now} />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function SourceRow({ source, now }: { source: AdminSourceRow; now: number }) {
  const paused = source.pausedUntil !== null && source.pausedUntil > now;
  return (
    <li className="grid gap-4 px-5 py-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate text-sm font-semibold">
            {source.displayName ?? hostFromUrl(source.url)}
          </span>
          <span className="fp-chip">{source.kind}</span>
          <span
            className={
              paused
                ? "fp-chip fp-chip-amber"
                : source.active
                  ? "fp-chip fp-chip-emerald"
                  : "fp-chip"
            }
          >
            {paused ? "Paused" : source.active ? "Active" : "Inactive"}
          </span>
        </div>
        <div className="mt-1 truncate text-xs" style={{ color: "var(--fg-muted)" }}>
          {source.folderName ?? "ungrouped"}
        </div>
        <div className="mt-1 truncate text-xs" style={{ color: "var(--fg-muted)" }}>
          {source.url}
        </div>
        {source.lastError ? (
          <div className="mt-1 truncate text-xs" style={{ color: "var(--error-fg)" }}>
            {source.lastError}
          </div>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-2 md:justify-end">
        {paused ? (
          <form action={resumeSourceForAdminAction}>
            <input type="hidden" name="sourceId" value={source.id} />
            <input type="hidden" name="userId" value={source.userId} />
            <SubmitButton className="fp-btn fp-btn-ghost" pendingLabel="Resuming">
              Resume
            </SubmitButton>
          </form>
        ) : (
          <form action={pauseSourceForAdminAction}>
            <input type="hidden" name="sourceId" value={source.id} />
            <input type="hidden" name="userId" value={source.userId} />
            <input type="hidden" name="days" value="7" />
            <SubmitButton className="fp-btn fp-btn-ghost" pendingLabel="Pausing">
              Pause 7d
            </SubmitButton>
          </form>
        )}
        <form action={deleteSourceForAdminAction}>
          <input type="hidden" name="sourceId" value={source.id} />
          <input type="hidden" name="userId" value={source.userId} />
          <SubmitButton className="fp-btn fp-btn-ghost" pendingLabel="Deleting">
            Delete
          </SubmitButton>
        </form>
      </div>
    </li>
  );
}

function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="px-5 py-8 text-center text-sm" style={{ color: "var(--fg-muted)" }}>
      {children}
    </div>
  );
}

function Banner({ children }: { children: ReactNode }) {
  return (
    <div
      className="rounded-lg px-4 py-3 text-sm"
      style={{ background: "var(--emerald-tint)", color: "var(--emerald)" }}
    >
      {children}
    </div>
  );
}

function planLabel(plan: string) {
  if (plan === "pro") return "Pro";
  if (plan === "custom") return "Custom";
  return "Trial";
}

function hostFromUrl(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
