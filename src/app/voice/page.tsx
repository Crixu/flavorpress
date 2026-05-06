/**
 * Voice & Publishing - master-detail layout.
 *
 * Left sidebar: compact outlet rows (connected status, default badge).
 * Right pane: either a "select an outlet" prompt or the full editor when
 * auto-redirected to the default outlet.
 *
 * Zero-state (no outlets): renders the feature introduction without the
 * sidebar so the connect form is the only focus.
 */

import { redirect } from "next/navigation";
import { ensureSchema, ensureSingleUser, SINGLE_USER_ID } from "@/lib/db";
import { getOutlet, listOutlets } from "@/lib/v1/outlets";
import { canUseAuthorizeFlow } from "@/lib/v1/origin";
import { decodePreflight } from "@/lib/wordpress";
import { disconnectOutletAction, startWPAuthorizeAction } from "@/lib/v1/actions";
import { Notice } from "@/components/wpds";
import { SubmitButton } from "../_components/SubmitButton";
import { VoiceShell } from "./_components/VoiceShell";
import { ConnectPromptInline } from "./_components/ConnectPromptInline";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{
    wp_connected?: string;
    wp_error?: string;
    wp_rejected?: string;
    check?: string;
  }>;
}

export default async function VoicePage({ searchParams }: PageProps) {
  await ensureSchema();
  await ensureSingleUser();

  const sp = await searchParams;
  const outlets = await listOutlets(SINGLE_USER_ID);
  const authorizeAvailable = await canUseAuthorizeFlow();
  const hasStatus = Boolean(sp.wp_error || sp.wp_rejected || sp.check);

  if (sp.wp_connected) {
    redirect(`/voice/${sp.wp_connected}?wp_connected=1`);
  }

  // Auto-select the default connected outlet when one exists.
  const defaultOutlet = outlets.find((o) => o.isDefault && o.connected);
  if (defaultOutlet && !hasStatus) {
    redirect(`/voice/${defaultOutlet.id}`);
  }

  // If there are connected outlets but no default, redirect to the first one.
  const firstConnected = outlets.find((o) => o.connected);
  if (firstConnected && !hasStatus) {
    redirect(`/voice/${firstConnected.id}`);
  }

  // No outlets at all: zero-state with feature introduction and connect prompt.
  if (outlets.length === 0) {
    return <ZeroState authorizeAvailable={authorizeAvailable} status={sp} />;
  }

  const checkOutlet = sp.check ? await getOutlet(sp.check) : null;
  const preflight =
    checkOutlet && checkOutlet.userId === SINGLE_USER_ID && checkOutlet.lastError
      ? decodePreflight(checkOutlet.lastError)
      : null;

  // Outlets exist but none are connected: show sidebar with prompt to authorize.
  return (
    <VoiceShell outlets={outlets} selectedId={null} authorizeAvailable={authorizeAvailable}>
      <div className="space-y-4">
        <VoiceStatusMessages status={sp} />
        {preflight && checkOutlet ? (
          <PreflightCard
            baseUrl={checkOutlet.baseUrl}
            outletId={checkOutlet.id}
            result={preflight}
            authorizeAvailable={authorizeAvailable}
          />
        ) : (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              minHeight: 320,
              color: "var(--ink-muted)",
              gap: 8,
              textAlign: "center",
            }}
          >
            <div style={{ fontSize: 14, fontWeight: 500 }}>Select an outlet to edit its voice</div>
            <div style={{ fontSize: 12 }}>
              Finish connecting an outlet first, or use the + Connect button to add a new site.
            </div>
          </div>
        )}
      </div>
    </VoiceShell>
  );
}

function ZeroState({
  authorizeAvailable,
  status,
}: {
  authorizeAvailable: boolean;
  status: Awaited<PageProps["searchParams"]>;
}) {
  return (
    <div className="space-y-8">
      <VoiceStatusMessages status={status} />
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

      <section className="fp-card-feature fp-gradient-surface p-6">
        <div className="text-base font-semibold">Connect your first WordPress site</div>
        <p className="mt-1 text-sm" style={{ color: "var(--fg-muted)" }}>
          Use the + Connect button below to link a WordPress site. Once connected, build the voice
          profile and start generating drafts.
        </p>
        <ConnectPromptInline authorizeAvailable={authorizeAvailable} />
      </section>

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
    </div>
  );
}

function VoiceStatusMessages({ status }: { status: Awaited<PageProps["searchParams"]> }) {
  return (
    <>
      {status.wp_error ? (
        <Notice tone="error">WordPress authorization failed: {decodeURIComponent(status.wp_error)}</Notice>
      ) : null}
      {status.wp_rejected ? (
        <Notice tone="warn">
          You declined authorization on your WordPress site. No credentials were stored.
        </Notice>
      ) : null}
    </>
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
    <section className="fp-card p-5">
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
        <span className={`fp-chip ${overallOk ? "fp-chip-emerald" : "fp-chip-rose"}`}>
          {overallOk ? "All checks pass" : "Issues found"}
        </span>
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
          {result.errors.map((error, i) => (
            <div
              key={i}
              className="rounded-md p-2.5 text-[13px]"
              style={{ background: "var(--rose-tint)", color: "var(--rose)" }}
            >
              {error}
            </div>
          ))}
        </div>
      ) : null}

      {result.warnings.length > 0 ? (
        <div className="mt-4 space-y-1.5">
          <div className="text-xs uppercase tracking-wider" style={{ color: "var(--amber)" }}>
            Warnings
          </div>
          {result.warnings.map((warning, i) => (
            <div
              key={i}
              className="rounded-md p-2.5 text-[13px]"
              style={{ background: "var(--amber-tint)", color: "var(--amber)" }}
            >
              {warning}
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
              Authorize on WordPress
            </SubmitButton>
          </form>
        ) : null}
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
  const symbol = ok ? "OK" : warn ? "!" : "X";
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
