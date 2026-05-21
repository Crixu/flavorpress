import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { AuthRequiredError, requireSession, shouldShowAdminControls } from "@/lib/session";
import { EXTENSION_METADATA, findExtensionMetadata } from "@/extensions/registry";
import { getGloballyDisabledExtensionIds } from "@/lib/v1/settings";
import { db, ensureSchema } from "@/lib/db";
import { SubmitButton } from "../../../_components/SubmitButton";
import { SettingsSidebar } from "../../_components/SettingsSidebar";
import { toggleGlobalExtensionAction } from "../actions";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{
    error?: string;
    saved?: string;
    extension?: string;
    state?: string;
  }>;
}

interface UserOverrideCounts {
  perExtensionDisabledUsers: Record<string, number>;
}

async function loadUserOverrideCounts(): Promise<UserOverrideCounts> {
  await ensureSchema();
  const r = await db.execute({
    sql: `SELECT value FROM user_settings WHERE key = 'disabled_extensions'`,
  });
  const counts: Record<string, number> = {};
  for (const row of r.rows) {
    const raw = row.value;
    if (raw === null || raw === undefined) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(String(raw));
    } catch {
      continue;
    }
    if (!Array.isArray(parsed)) continue;
    for (const id of parsed) {
      if (typeof id !== "string") continue;
      counts[id] = (counts[id] ?? 0) + 1;
    }
  }
  return { perExtensionDisabledUsers: counts };
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
  const [globallyDisabled, overrides] = await Promise.all([
    getGloballyDisabledExtensionIds(),
    loadUserOverrideCounts(),
  ]);

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
                Disable an extension across the whole deployment. A globally-disabled extension
                stops loading for every user and locks their per-user toggle. Use the per-user admin
                view to manage individual overrides for everything that is still globally enabled.
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
          {sp.error === "invalid_extension" ? (
            <Banner kind="error">Unknown extension.</Banner>
          ) : null}

          <section className="space-y-3">
            <div className="fp-card overflow-hidden">
              <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
                {EXTENSION_METADATA.map((extension) => {
                  const isGloballyDisabled = globallyDisabled.has(extension.id);
                  const overrideCount = overrides.perExtensionDisabledUsers[extension.id] ?? 0;
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
                          {overrideCount > 0 ? (
                            <span className="fp-chip">
                              {overrideCount} per-user override
                              {overrideCount === 1 ? "" : "s"}
                            </span>
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

function extensionLabelFor(id: string) {
  return findExtensionMetadata(id)?.label ?? "extension";
}
