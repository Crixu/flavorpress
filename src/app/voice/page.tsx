/**
 * Voice & Publishing.
 *
 * One author, many outlets. Each outlet has its own voice profile (built
 * from that outlet's WP archive) and its own credentials. Drafts pick
 * which outlet to publish to.
 *
 * The connected check is gated on app_password_encrypted being non-null,
 * so a half-finished authorize flow never shows as "connected."
 */

import Link from "next/link";
import { ensureSchema, ensureSingleUser, SINGLE_USER_ID, db } from "@/lib/db";
import { listOutlets, getOutlet } from "@/lib/v1/outlets";
import {
  buildVoiceProfileAction,
  startWPAuthorizeAction,
  connectOutletManualAction,
  disconnectOutletAction,
  setDefaultOutletAction,
  preflightOutletAction,
} from "@/lib/v1/actions";
import { decodePreflight } from "@/lib/wordpress";
import { canUseAuthorizeFlow } from "@/lib/v1/origin";
import {
  DisableFormWhilePending,
  PendingMessage,
  PendingStages,
  SubmitButton,
} from "../_components/SubmitButton";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{
    wp_connected?: string;
    wp_error?: string;
    wp_rejected?: string;
    add?: string;
    manual?: string;
    check?: string;
    baseUrl?: string;
  }>;
}

export default async function VoicePage({ searchParams }: PageProps) {
  await ensureSchema();
  await ensureSingleUser();
  const sp = await searchParams;
  const outlets = await listOutlets(SINGLE_USER_ID);

  // If the user just ran a preflight, surface the result inline.
  const checkOutlet = sp.check ? await getOutlet(sp.check) : null;
  const preflight =
    checkOutlet && checkOutlet.lastError ? decodePreflight(checkOutlet.lastError) : null;

  const profilesR = await db.execute({
    sql: `SELECT * FROM voice_profiles WHERE user_id = ?`,
    args: [SINGLE_USER_ID],
  });
  const profilesByOutlet = new Map<string, (typeof profilesR.rows)[0]>();
  for (const row of profilesR.rows) {
    profilesByOutlet.set(String(row.outlet_id), row);
  }

  const showAddForm = sp.add === "1" || outlets.length === 0;
  const authorizeAvailable = await canUseAuthorizeFlow();
  // When the authorize flow can't work (http origin → HTTPS WP rejects the
  // callback), manual paste is the only option; force it regardless of ?manual.
  const useManual = !authorizeAvailable || sp.manual === "1";

  return (
    <div className="space-y-8">
      {/* Hero */}
      <header className="space-y-2">
        <div className="fp-eyebrow">Voice & Publishing</div>
        <h1 className="fp-h1 fp-h1-serif" style={{ maxWidth: "20ch" }}>
          One author. Many outlets. Many voices.
        </h1>
        <p className="max-w-2xl text-sm leading-relaxed" style={{ color: "var(--fg-muted)" }}>
          Each WordPress site you connect becomes an outlet with its own voice profile. Drafts pick
          which outlet to publish to.
        </p>
      </header>

      {/* Banners */}
      {sp.wp_connected ? (
        <Banner kind="success">✓ WordPress connected. Build the voice profile next.</Banner>
      ) : null}
      {sp.wp_error ? <Banner kind="error">⚠ {decodeURIComponent(sp.wp_error)}</Banner> : null}
      {sp.wp_rejected ? (
        <Banner kind="warn">
          You declined authorization on your WordPress site. No credentials stored. You can try
          again below.
        </Banner>
      ) : null}

      {/* Preflight result card */}
      {preflight && checkOutlet ? (
        <PreflightCard
          baseUrl={checkOutlet.baseUrl}
          outletId={checkOutlet.id}
          result={preflight}
          authorizeAvailable={authorizeAvailable}
        />
      ) : null}

      {/* Outlets list */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold tracking-tight">
            Your outlets · {outlets.length}
          </h2>
          {outlets.length > 0 && !showAddForm ? (
            <Link href="/voice?add=1" className="fp-btn fp-btn-ghost">
              + Add another outlet
            </Link>
          ) : null}
        </div>

        {outlets.length === 0 ? null : (
          <div className="grid gap-4 lg:grid-cols-2">
            {outlets.map((outlet) => (
              <OutletCard
                key={outlet.id}
                outlet={outlet}
                profile={profilesByOutlet.get(outlet.id)}
                authorizeAvailable={authorizeAvailable}
              />
            ))}
          </div>
        )}
      </section>

      {/* Add outlet form */}
      {showAddForm ? (
        <section className="fp-card-feature fp-gradient-surface p-6">
          <div className="flex items-start gap-3">
            <div className="flex-1">
              <div className="text-base font-semibold">Connect a WordPress site</div>
              <p className="mt-1 text-sm" style={{ color: "var(--fg-muted)" }}>
                {authorizeAvailable
                  ? "One click via your site's authorize page. WordPress generates the Application Password and sends you back here."
                  : "Create an Application Password in your WordPress admin and paste it here. The one-click authorize flow needs FlavorPress to be reachable over HTTPS, so it isn't available in this build."}
              </p>
            </div>
          </div>

          {!useManual ? (
            <div className="mt-5 space-y-4">
              <form className="space-y-3">
                <div className="flex flex-wrap gap-2">
                  <input
                    type="url"
                    name="baseUrl"
                    required
                    defaultValue={checkOutlet?.baseUrl ?? ""}
                    placeholder="https://yourblog.com"
                    className="fp-input flex-1 min-w-[280px]"
                  />
                  <button
                    type="submit"
                    formAction={preflightOutletAction}
                    className="fp-btn fp-btn-ghost"
                  >
                    Check site
                  </button>
                  <button
                    type="submit"
                    formAction={startWPAuthorizeAction}
                    className="fp-btn fp-btn-primary"
                  >
                    Authorize on WordPress →
                  </button>
                </div>
                <PendingStages
                  title="Checking WordPress"
                  stages={[
                    "Testing site reachability",
                    "Checking WordPress REST",
                    "Checking Application Passwords",
                    "Preparing authorize handoff",
                  ]}
                />
                <DisableFormWhilePending />
              </form>
              <p className="text-[12px]" style={{ color: "var(--fg-muted)" }}>
                <strong>Check site</strong> runs a preflight against your site (REST API reachable,
                Application Passwords enabled, callback scheme compatible) and reports findings
                before you leave the app. <strong>Authorize</strong> runs the same preflight, then
                redirects to your site if everything passes.
              </p>
              <details className="text-xs" style={{ color: "var(--fg-muted)" }}>
                <summary className="cursor-pointer hover:text-[color:var(--fg)]">
                  Authorize flow won't redirect back?
                </summary>
                <p className="mt-2 leading-relaxed">
                  WordPress requires the callback to be reachable from the browser. If you're
                  running FlavorPress at{" "}
                  <code className="rounded bg-[color:var(--bg-subtle)] px-1">
                    http://localhost:3000
                  </code>{" "}
                  and your WP is HTTPS, some installs block the http:// callback.{" "}
                  <Link
                    href="/voice?add=1&manual=1"
                    className="text-[color:var(--indigo)] hover:underline"
                  >
                    Use the manual paste flow instead →
                  </Link>
                </p>
              </details>
            </div>
          ) : (
            <ManualConnect
              authorizeAvailable={authorizeAvailable}
              prefillBaseUrl={sp.baseUrl ?? checkOutlet?.baseUrl}
            />
          )}
        </section>
      ) : null}

      {/* What an outlet does */}
      {outlets.length === 0 ? (
        <section className="fp-card-feature p-6 fp-gradient-surface">
          <div className="fp-eyebrow mb-3">What you get with an outlet</div>
          <div className="grid gap-4 md:grid-cols-3">
            <FeatureBlock
              title="Voice profile"
              detail="We pull your last 50 posts and extract a stylometric fingerprint. Drafts inherit it."
            />
            <FeatureBlock
              title="Drafts go back here"
              detail="Generated drafts publish to this site as WordPress drafts you can edit and ship."
            />
            <FeatureBlock
              title="Per-outlet ranking"
              detail="Add a side blog and FlavorPress treats it as a different voice; clusters surface for both."
            />
          </div>
        </section>
      ) : null}
    </div>
  );
}

function OutletCard({
  outlet,
  profile,
  authorizeAvailable,
}: {
  outlet: Awaited<ReturnType<typeof listOutlets>>[number];
  profile?: ReturnType<Map<string, unknown>["get"]>;
  authorizeAvailable: boolean;
}) {
  const archiveSize = profile
    ? Number((profile as Record<string, unknown>).archive_index_size ?? 0)
    : 0;
  const sentenceMean = profile
    ? Number((profile as Record<string, unknown>).sentence_length_mean ?? 0)
    : 0;
  const emDash = profile ? Number((profile as Record<string, unknown>).em_dash_density ?? 0) : 0;
  const lastBuilt = profile ? Number((profile as Record<string, unknown>).last_rebuilt_at ?? 0) : 0;
  const banned: string[] = profile
    ? (JSON.parse(String((profile as Record<string, unknown>).banned_terms ?? "[]")) as string[])
    : [];
  const signature: string[] = profile
    ? (JSON.parse(String((profile as Record<string, unknown>).signature_terms ?? "[]")) as string[])
    : [];

  return (
    <div
      className={`fp-card ${outlet.connected ? "" : "border-dashed"} p-5`}
      style={outlet.isDefault && outlet.connected ? { borderColor: "var(--indigo)" } : undefined}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <div
            className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl text-sm font-semibold"
            style={{
              background: outlet.connected ? "var(--indigo-tint)" : "var(--bg-subtle)",
              color: outlet.connected ? "var(--indigo)" : "var(--fg-muted)",
            }}
          >
            {outletInitial(outlet.displayName, outlet.baseUrl)}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <a
                href={outlet.baseUrl}
                target="_blank"
                rel="noreferrer"
                className="font-semibold hover:underline truncate"
              >
                {outlet.displayName ?? outlet.baseUrl}
              </a>
              {outlet.isDefault && outlet.connected ? (
                <span className="fp-chip fp-chip-indigo">Default</span>
              ) : null}
              {outlet.connected ? (
                <span className="fp-chip fp-chip-emerald">Connected</span>
              ) : (
                <span className="fp-chip fp-chip-amber">Awaiting auth</span>
              )}
              {outlet.kind === "jetpack-managed" ? (
                <span className="fp-chip fp-chip-amber">Jetpack-managed (v1.1)</span>
              ) : null}
            </div>
            <div className="mt-0.5 truncate text-[12px]" style={{ color: "var(--fg-muted)" }}>
              {outlet.baseUrl}
              {outlet.username ? ` · ${outlet.username}` : ""}
            </div>
          </div>
        </div>
      </div>

      {outlet.lastError ? (
        <div
          className="mt-3 rounded-lg p-2.5 text-[12px]"
          style={{ background: "var(--rose-tint)", color: "var(--rose)" }}
        >
          ⚠ {outlet.lastError}
        </div>
      ) : null}

      {outlet.connected ? (
        <div className="mt-4">
          <div className="mb-2 flex items-center justify-between">
            <div className="fp-eyebrow">Voice profile</div>
            <Link
              href={`/voice/${outlet.id}`}
              className="text-[11px] font-medium transition hover:underline"
              style={{ color: "var(--indigo)" }}
            >
              {profile ? "View & edit →" : "Edit →"}
            </Link>
          </div>
          {profile ? (
            <>
              <div className="grid grid-cols-3 gap-2">
                <MiniStat label="Posts" value={String(archiveSize)} />
                <MiniStat label="Avg sentence" value={`${sentenceMean.toFixed(1)}w`} />
                <MiniStat label="Em-dash/1k" value={emDash.toFixed(2)} />
              </div>
              <div className="mt-3 flex flex-wrap gap-1">
                {signature.slice(0, 8).map((t) => (
                  <span key={t} className="fp-chip fp-chip-emerald">
                    {t}
                  </span>
                ))}
                {banned.slice(0, 4).map((t) => (
                  <span
                    key={t}
                    className="fp-chip fp-chip-rose"
                    style={{ textDecoration: "line-through" }}
                  >
                    {t}
                  </span>
                ))}
              </div>
              <div className="mt-2 text-[11px]" style={{ color: "var(--fg-muted)" }}>
                last built {lastBuilt ? new Date(lastBuilt).toLocaleDateString() : "—"}
              </div>
            </>
          ) : (
            <div
              className="rounded-lg border border-dashed p-3 text-[12px]"
              style={{ borderColor: "var(--border)", color: "var(--fg-muted)" }}
            >
              Voice profile not built yet. Pulls your last 50 posts and extracts a stylometric
              fingerprint, or seed from a writing sample.
            </div>
          )}
        </div>
      ) : null}

      <div className="mt-5 flex flex-wrap gap-2">
        {outlet.connected ? (
          <>
            <form action={buildVoiceProfileAction}>
              <input type="hidden" name="outletId" value={outlet.id} />
              <SubmitButton
                className="fp-btn fp-btn-primary"
                pendingLabel={profile ? "Re-training voice" : "Building voice"}
              >
                {profile ? "Re-train voice" : "Build voice profile"}
              </SubmitButton>
              <PendingMessage>
                Pulling recent posts and extracting the outlet voice profile.
              </PendingMessage>
            </form>
            {!profile ? (
              <Link href={`/voice/${outlet.id}`} className="fp-btn fp-btn-ghost">
                Seed from samples →
              </Link>
            ) : null}
            {!outlet.isDefault ? (
              <form action={setDefaultOutletAction}>
                <input type="hidden" name="outletId" value={outlet.id} />
                <SubmitButton className="fp-btn fp-btn-ghost" pendingLabel="Setting default">
                  Set as default
                </SubmitButton>
              </form>
            ) : null}
            <form action={disconnectOutletAction}>
              <input type="hidden" name="outletId" value={outlet.id} />
              <SubmitButton className="fp-btn fp-btn-ghost" pendingLabel="Disconnecting">
                Disconnect
              </SubmitButton>
            </form>
          </>
        ) : (
          <>
            {authorizeAvailable ? (
              <form action={startWPAuthorizeAction}>
                <input type="hidden" name="baseUrl" value={outlet.baseUrl} />
                <SubmitButton className="fp-btn fp-btn-primary" pendingLabel="Opening WordPress">
                  Reconnect →
                </SubmitButton>
              </form>
            ) : (
              <Link
                href={`/voice?add=1&manual=1&baseUrl=${encodeURIComponent(outlet.baseUrl)}`}
                className="fp-btn fp-btn-primary"
              >
                Reconnect manually
              </Link>
            )}
            <form action={disconnectOutletAction}>
              <input type="hidden" name="outletId" value={outlet.id} />
              <input type="hidden" name="purge" value="1" />
              <SubmitButton className="fp-btn fp-btn-danger" pendingLabel="Removing">
                Remove
              </SubmitButton>
            </form>
          </>
        )}
      </div>
    </div>
  );
}

function ManualConnect({
  authorizeAvailable,
  prefillBaseUrl,
}: {
  authorizeAvailable: boolean;
  prefillBaseUrl?: string;
}) {
  return (
    <div className="mt-5 space-y-3">
      <p className="text-xs leading-relaxed" style={{ color: "var(--fg-muted)" }}>
        Open{" "}
        <code className="rounded bg-[color:var(--bg-subtle)] px-1">
          /wp-admin/users.php?page=profile
        </code>{" "}
        on your site. In Application Passwords, name the new password "FlavorPress" and click Add
        New. Copy the 24-character password and paste it here.
      </p>
      <form action={connectOutletManualAction} className="space-y-2">
        <div className="grid gap-2 md:grid-cols-2">
          <input
            type="url"
            name="baseUrl"
            required
            defaultValue={prefillBaseUrl ?? ""}
            placeholder="https://yourblog.com"
            className="fp-input"
          />
          <input name="username" required placeholder="WordPress username" className="fp-input" />
        </div>
        <input
          name="appPassword"
          required
          placeholder="xxxx xxxx xxxx xxxx xxxx xxxx"
          className="fp-input font-mono text-xs"
        />
        <div className="flex gap-2">
          <SubmitButton className="fp-btn fp-btn-primary" pendingLabel="Connecting">
            Connect manually
          </SubmitButton>
          {authorizeAvailable ? (
            <Link href="/voice?add=1" className="fp-btn fp-btn-ghost">
              ← Back to one-click
            </Link>
          ) : null}
        </div>
        <PendingMessage>
          Testing the WordPress credentials before saving this outlet.
        </PendingMessage>
      </form>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md px-2 py-1.5 text-center" style={{ background: "var(--bg-subtle)" }}>
      <div className="text-sm font-medium tabular">{value}</div>
      <div className="text-[10px]" style={{ color: "var(--fg-muted)" }}>
        {label}
      </div>
    </div>
  );
}

function outletInitial(displayName: string | null | undefined, baseUrl: string): string {
  const source = displayName?.trim() || baseUrl;
  try {
    const host = new URL(baseUrl).host.replace(/^www\./, "");
    return (displayName?.trim().charAt(0) || host.charAt(0) || "W").toUpperCase();
  } catch {
    return (source.charAt(0) || "W").toUpperCase();
  }
}

function FeatureBlock({ title, detail }: { title: string; detail: string }) {
  return (
    <div>
      <div className="text-sm font-semibold">{title}</div>
      <div className="mt-0.5 text-[12px]" style={{ color: "var(--fg-muted)" }}>
        {detail}
      </div>
    </div>
  );
}

function PreflightCard({
  baseUrl,
  outletId,
  result,
  authorizeAvailable,
}: {
  baseUrl: string;
  outletId: string;
  result: ReturnType<typeof decodePreflight>;
  authorizeAvailable: boolean;
}) {
  if (!result) return null;
  const overallOk = result.ok && result.errors.length === 0;
  return (
    <section
      className={`fp-card p-5 ${overallOk ? "" : ""}`}
      style={{
        borderColor: overallOk
          ? "color-mix(in srgb, var(--emerald) 30%, var(--border))"
          : "color-mix(in srgb, var(--rose) 30%, var(--border))",
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="fp-eyebrow">Preflight result</div>
          <div className="mt-1 text-base font-semibold">
            {result.siteName ? `${result.siteName} · ` : ""}
            <span className="break-all">{baseUrl}</span>
          </div>
          {result.hint ? (
            <p className="mt-1 text-sm" style={{ color: "var(--fg-muted)" }}>
              {result.hint}
            </p>
          ) : null}
        </div>
        {overallOk ? (
          <span className="fp-chip fp-chip-emerald">All checks pass</span>
        ) : (
          <span className="fp-chip fp-chip-rose">Issues found</span>
        )}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <PreflightCheck label="Reachable" ok={result.reachable} />
        <PreflightCheck label="WordPress REST" ok={result.isWordPress} />
        <PreflightCheck label="App Passwords" ok={result.hasApplicationPasswords} />
        <PreflightCheck
          label="Callback scheme"
          ok={result.callbackSchemeMatch}
          warn={!result.callbackSchemeMatch && result.ok}
        />
      </div>

      {result.errors.length > 0 ? (
        <div className="mt-4 space-y-1.5">
          <div className="text-xs uppercase tracking-wider" style={{ color: "var(--rose)" }}>
            Errors
          </div>
          {result.errors.map((e, i) => (
            <div
              key={i}
              className="rounded-md p-2.5 text-[13px]"
              style={{ background: "var(--rose-tint)", color: "var(--rose)" }}
            >
              {e}
            </div>
          ))}
        </div>
      ) : null}

      {result.warnings.length > 0 ? (
        <div className="mt-4 space-y-1.5">
          <div className="text-xs uppercase tracking-wider" style={{ color: "var(--amber)" }}>
            Warnings
          </div>
          {result.warnings.map((w, i) => (
            <div
              key={i}
              className="rounded-md p-2.5 text-[13px]"
              style={{ background: "var(--amber-tint)", color: "var(--amber)" }}
            >
              {w}
            </div>
          ))}
        </div>
      ) : null}

      <div className="mt-5 flex flex-wrap gap-2">
        {overallOk && authorizeAvailable ? (
          <form action={startWPAuthorizeAction}>
            <input type="hidden" name="baseUrl" value={baseUrl} />
            <input type="hidden" name="skipPreflight" value="1" />
            <SubmitButton className="fp-btn fp-btn-primary" pendingLabel="Opening WordPress">
              Authorize on WordPress →
            </SubmitButton>
          </form>
        ) : null}
        <Link
          href="/voice?add=1&manual=1"
          className={`fp-btn ${authorizeAvailable ? "fp-btn-ghost" : "fp-btn-primary"}`}
        >
          {authorizeAvailable ? "Use manual paste flow" : "Connect manually"}
        </Link>
        <form action={disconnectOutletAction}>
          <input type="hidden" name="outletId" value={outletId} />
          <input type="hidden" name="purge" value="1" />
          <SubmitButton className="fp-btn fp-btn-ghost" pendingLabel="Discarding">
            Discard
          </SubmitButton>
        </form>
      </div>
    </section>
  );
}

function PreflightCheck({ label, ok, warn }: { label: string; ok: boolean; warn?: boolean }) {
  const color = ok ? "var(--emerald)" : warn ? "var(--amber)" : "var(--rose)";
  const bg = ok ? "var(--emerald-tint)" : warn ? "var(--amber-tint)" : "var(--rose-tint)";
  const symbol = ok ? "✓" : warn ? "!" : "✗";
  return (
    <div
      className="flex items-center gap-2 rounded-md px-3 py-2 text-xs font-medium"
      style={{ background: bg, color }}
    >
      <span className="font-bold">{symbol}</span>
      <span>{label}</span>
    </div>
  );
}

function Banner({
  kind,
  children,
}: {
  kind: "success" | "warn" | "error";
  children: React.ReactNode;
}) {
  const palette =
    kind === "success"
      ? {
          bg: "var(--emerald-tint)",
          fg: "var(--emerald)",
          border: "color-mix(in srgb, var(--emerald) 25%, var(--border))",
        }
      : kind === "warn"
        ? {
            bg: "var(--amber-tint)",
            fg: "var(--amber)",
            border: "color-mix(in srgb, var(--amber) 25%, var(--border))",
          }
        : {
            bg: "var(--rose-tint)",
            fg: "var(--rose)",
            border: "color-mix(in srgb, var(--rose) 25%, var(--border))",
          };
  return (
    <div
      className="rounded-lg px-4 py-3 text-sm"
      style={{
        background: palette.bg,
        color: palette.fg,
        border: `1px solid ${palette.border}`,
      }}
    >
      {children}
    </div>
  );
}
