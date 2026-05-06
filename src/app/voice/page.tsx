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
import { listOutlets } from "@/lib/v1/outlets";
import { canUseAuthorizeFlow } from "@/lib/v1/origin";
import { VoiceShell } from "./_components/VoiceShell";
import { ConnectPromptInline } from "./_components/ConnectPromptInline";

export const dynamic = "force-dynamic";

export default async function VoicePage() {
  await ensureSchema();
  await ensureSingleUser();

  const outlets = await listOutlets(SINGLE_USER_ID);
  const authorizeAvailable = await canUseAuthorizeFlow();

  // Auto-select the default connected outlet when one exists.
  const defaultOutlet = outlets.find((o) => o.isDefault && o.connected);
  if (defaultOutlet) {
    redirect(`/voice/${defaultOutlet.id}`);
  }

  // If there are connected outlets but no default, redirect to the first one.
  const firstConnected = outlets.find((o) => o.connected);
  if (firstConnected) {
    redirect(`/voice/${firstConnected.id}`);
  }

  // No outlets at all: zero-state with feature introduction and connect prompt.
  if (outlets.length === 0) {
    return <ZeroState authorizeAvailable={authorizeAvailable} />;
  }

  // Outlets exist but none are connected: show sidebar with prompt to authorize.
  return (
    <VoiceShell outlets={outlets} selectedId={null} authorizeAvailable={authorizeAvailable}>
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
    </VoiceShell>
  );
}

function ZeroState({ authorizeAvailable }: { authorizeAvailable: boolean }) {
  return (
    <div className="space-y-8">
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
