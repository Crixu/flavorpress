/**
 * Right-pane detail for the master-detail voice layout.
 *
 * Receives the full outlet and profile data from the server component and
 * renders the same editor surfaces as the standalone /voice/[outletId] page.
 * All form actions wire through the same server actions - nothing changed here.
 */

import { HelpTrigger } from "@/components/Help";
import { PendingMessage, SubmitButton } from "@/app/_components/SubmitButton";
import {
  addVoiceTermAction,
  removeVoiceTermAction,
  buildVoiceProfileAction,
  saveBlogDescriptionAction,
  deriveBlogDescriptionAction,
} from "@/lib/v1/actions";
import { VoiceSetupPicker } from "@/app/voice/[outletId]/_components/VoiceSetupPicker";
import { MIN_VOICE_TRAIN_POSTS } from "@/lib/wordpress";
import type { Outlet } from "@/lib/v1/outlets";
import { DeleteOutletButton } from "./DeleteOutletButton";

interface ProfileData {
  archiveSize: number;
  sentenceMean: number;
  sentenceVar: number;
  emDash: number;
  hedge: number;
  quoteDensity: number;
  lastBuilt: number;
  seedLabel: string | null;
  hasFingerprint: boolean;
  banned: string[];
  signature: string[];
  description: string;
}

interface Props {
  outlet: Outlet;
  profile: ProfileData | null;
  isThinArchive: boolean;
  archivePostCount: number | null;
}

export function OutletDetail({ outlet, profile, isThinArchive, archivePostCount }: Props) {
  const outletId = outlet.id;

  return (
    <div className="space-y-6">
      <header className="space-y-1.5">
        <div className="fp-eyebrow">
          <HelpTrigger id="voice-profile">Voice profile</HelpTrigger>
        </div>
        <h1 className="fp-h1 fp-h1-serif" style={{ maxWidth: "26ch" }}>
          {outlet.displayName ?? outlet.baseUrl}
        </h1>
        <a
          href={outlet.baseUrl}
          target="_blank"
          rel="noreferrer"
          className="text-sm font-mono break-all hover:underline"
          style={{ color: "var(--fg-muted)" }}
        >
          {outlet.baseUrl}
        </a>
      </header>

      {profile && isThinArchive ? (
        <section className="fp-card-feature p-4">
          <div className="text-sm font-semibold">Archive still too thin to re-train.</div>
          <p className="mt-1 text-sm leading-relaxed" style={{ color: "var(--fg-muted)" }}>
            This outlet has {archivePostCount} {archivePostCount === 1 ? "post" : "posts"}. Archive
            re-training needs at least {MIN_VOICE_TRAIN_POSTS} published posts, so the current
            sample-seeded fingerprint is still active.
          </p>
        </section>
      ) : null}

      {!profile ? (
        isThinArchive ? (
          <ThinArchiveEmptyState outletId={outletId} postCount={archivePostCount ?? 0} />
        ) : (
          <section className="fp-card-feature p-6">
            <div className="text-base font-semibold">No voice profile yet.</div>
            <p className="mt-1 text-sm" style={{ color: "var(--fg-muted)" }}>
              Build the profile from your last 50 published posts. Takes about 30 seconds.
            </p>
            <form action={buildVoiceProfileAction} className="mt-4">
              <input type="hidden" name="outletId" value={outletId} />
              <SubmitButton className="fp-btn fp-btn-primary" pendingLabel="Building voice">
                Build voice profile
              </SubmitButton>
              <PendingMessage>
                Pulling recent posts and extracting this outlet&apos;s voice.
              </PendingMessage>
            </form>
            <details className="mt-6">
              <summary
                className="cursor-pointer text-sm font-medium"
                style={{ color: "var(--fg-muted)" }}
              >
                Or seed voice manually (free-write, interview, or paste)
              </summary>
              <div className="mt-4">
                <VoiceSetupPicker outletId={outletId} hasProfile={false} />
              </div>
            </details>
          </section>
        )
      ) : (
        <>
          <section>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-base font-semibold tracking-tight">
                Fingerprint{" "}
                <span className="ml-1 text-xs font-normal" style={{ color: "var(--fg-subtle)" }}>
                  auto-derived · read-only
                </span>
              </h2>
              <form action={buildVoiceProfileAction}>
                <input type="hidden" name="outletId" value={outletId} />
                <SubmitButton className="fp-btn fp-btn-ghost" pendingLabel="Re-training">
                  Re-train from archive
                </SubmitButton>
              </form>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <Stat
                label="Posts in archive"
                value={String(profile.archiveSize)}
                hint="archive-overlap"
              />
              <Stat label="Avg sentence" value={`${profile.sentenceMean.toFixed(1)}w`} />
              <Stat label="Sentence variance" value={profile.sentenceVar.toFixed(1)} />
              <Stat label="Em-dash / 1k" value={profile.emDash.toFixed(2)} />
              <Stat label="Hedge / 1k" value={profile.hedge.toFixed(2)} />
              <Stat label="Quote / 1k" value={profile.quoteDensity.toFixed(2)} />
            </div>
            <div className="mt-2 text-[11px]" style={{ color: "var(--fg-muted)" }}>
              Last built {profile.lastBuilt ? new Date(profile.lastBuilt).toLocaleString() : "—"}
              {profile.seedLabel ? ` · seed: ${profile.seedLabel}` : ""}
              {profile.hasFingerprint ? " · function-word distribution captured" : ""}
            </div>
          </section>

          <BlogDescriptionEditor outletId={outletId} description={profile.description} />

          <section>
            <h2 className="mb-2 text-base font-semibold tracking-tight">
              <HelpTrigger id="signature-terms">Signature terms</HelpTrigger>
              <span className="ml-2 text-xs font-normal" style={{ color: "var(--fg-muted)" }}>
                phrases this voice prefers
              </span>
            </h2>
            <p className="mb-3 text-[13px] leading-relaxed" style={{ color: "var(--fg-muted)" }}>
              Words and phrases drafts should reach for. The model nudges toward these when
              generating. Auto-detected from your archive; add or remove freely.
            </p>
            <ChipEditor
              outletId={outletId}
              list="signature"
              terms={profile.signature}
              placeholder="add a signature term, e.g. shipping"
              variant="emerald"
            />
          </section>

          <section>
            <h2 className="mb-2 text-base font-semibold tracking-tight">
              <HelpTrigger id="banned-terms">Banned terms</HelpTrigger>
              <span className="ml-2 text-xs font-normal" style={{ color: "var(--fg-muted)" }}>
                words drafts must avoid
              </span>
            </h2>
            <p className="mb-3 text-[13px] leading-relaxed" style={{ color: "var(--fg-muted)" }}>
              The model rewrites around these. Useful for AI-slop words (&quot;leverage&quot;,
              &quot;delve&quot;, &quot;tapestry&quot;) or jargon you&apos;ve outgrown.
            </p>
            <ChipEditor
              outletId={outletId}
              list="banned"
              terms={profile.banned}
              placeholder="add a banned term, e.g. leverage"
              variant="rose"
            />
          </section>
        </>
      )}

      {profile ? <RedoVoiceSetup outletId={outletId} /> : null}

      <section className="fp-danger-zone">
        <div className="fp-danger-zone-h">Delete Outlet</div>
        <p className="mb-3 text-sm leading-relaxed" style={{ color: "var(--fg-muted)" }}>
          Removes this Outlet and its voice profile from FlavorPress. Existing WordPress drafts and
          posts stay untouched.
        </p>
        <DeleteOutletButton outletId={outletId} outletName={outlet.displayName ?? outlet.baseUrl} />
      </section>
    </div>
  );
}

function ThinArchiveEmptyState({ outletId, postCount }: { outletId: string; postCount: number }) {
  const isEmpty = postCount === 0;
  return (
    <section className="fp-card-feature p-6">
      <div className="text-base font-semibold">
        {isEmpty
          ? "Brand-new site, no archive yet."
          : `Archive too thin to auto-train (${postCount} ${postCount === 1 ? "post" : "posts"}).`}
      </div>
      <p className="mt-1 text-sm leading-relaxed" style={{ color: "var(--fg-muted)" }}>
        Voice training needs at least {MIN_VOICE_TRAIN_POSTS} published posts to extract a stable
        fingerprint; below that the model nudges drafts toward generic prose. Pick a path below; we
        extract the same fingerprint either way. Re-train from the archive later once you have{" "}
        {MIN_VOICE_TRAIN_POSTS}+ posts on the site.
      </p>
      <div className="mt-4">
        <VoiceSetupPicker outletId={outletId} hasProfile={false} />
      </div>
    </section>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="fp-stat">
      <div className="text-2xl font-light tabular">{value}</div>
      <div className="text-[11px]" style={{ color: "var(--fg-muted)" }}>
        {hint ? <HelpTrigger id={hint}>{label}</HelpTrigger> : label}
      </div>
    </div>
  );
}

function BlogDescriptionEditor({
  outletId,
  description,
}: {
  outletId: string;
  description: string;
}) {
  return (
    <section>
      <h2 className="mb-2 text-base font-semibold tracking-tight">
        Blog description
        <span className="ml-2 text-xs font-normal" style={{ color: "var(--fg-muted)" }}>
          two or three sentences the drafter sees
        </span>
      </h2>
      <p className="mb-3 text-[13px] leading-relaxed" style={{ color: "var(--fg-muted)" }}>
        What this blog is about. The model reads it before every draft so clusters get framed in
        context, not as generic news. Auto-derive pulls from your homepage; edit the result freely.
      </p>
      <form action={saveBlogDescriptionAction} className="space-y-3">
        <input type="hidden" name="outletId" value={outletId} />
        <textarea
          name="description"
          rows={4}
          maxLength={1000}
          defaultValue={description}
          placeholder="e.g. A blog about distributed systems and the people who run them, written by a former SRE who left the on-call rotation and kept the opinions."
          className="fp-input w-full"
          style={{ fontSize: "14px", lineHeight: "1.5" }}
        />
        <div className="flex flex-wrap gap-2">
          <SubmitButton className="fp-btn fp-btn-primary" pendingLabel="Saving">
            Save description
          </SubmitButton>
        </div>
      </form>
      <form action={deriveBlogDescriptionAction} className="mt-2">
        <input type="hidden" name="outletId" value={outletId} />
        <SubmitButton className="fp-btn fp-btn-ghost" pendingLabel="Reading homepage">
          Auto-derive from homepage
        </SubmitButton>
        <PendingMessage>Reading the site root and homepage to draft a description.</PendingMessage>
      </form>
    </section>
  );
}

function RedoVoiceSetup({ outletId }: { outletId: string }) {
  return (
    <section className="fp-card p-6">
      <div className="text-base font-semibold">Re-do voice setup.</div>
      <p className="mt-1 text-sm leading-relaxed" style={{ color: "var(--fg-muted)" }}>
        Replace the current fingerprint by writing fresh prose, answering a short interview, or
        pasting samples. Your signature and banned terms get recomputed.
      </p>
      <div className="mt-4">
        <VoiceSetupPicker outletId={outletId} hasProfile={true} />
      </div>
    </section>
  );
}

function ChipEditor({
  outletId,
  list,
  terms,
  placeholder,
  variant,
}: {
  outletId: string;
  list: "banned" | "signature";
  terms: string[];
  placeholder: string;
  variant: "emerald" | "rose";
}) {
  const chipClass = variant === "emerald" ? "fp-chip fp-chip-emerald" : "fp-chip fp-chip-rose";
  const chipStyle = variant === "rose" ? { textDecoration: "line-through" as const } : undefined;
  return (
    <div className="space-y-3">
      <form action={addVoiceTermAction} className="flex flex-wrap gap-2">
        <input type="hidden" name="outletId" value={outletId} />
        <input type="hidden" name="list" value={list} />
        <input
          type="text"
          name="term"
          required
          maxLength={64}
          placeholder={placeholder}
          className="fp-input flex-1 min-w-[240px]"
        />
        <SubmitButton className="fp-btn fp-btn-ghost" pendingLabel="Adding">
          + Add
        </SubmitButton>
      </form>
      {terms.length === 0 ? (
        <div
          className="rounded-md border border-dashed p-3 text-xs"
          style={{ borderColor: "var(--border)", color: "var(--fg-muted)" }}
        >
          None yet.
        </div>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {terms.map((t) => (
            <form action={removeVoiceTermAction} key={`${list}-${t}`} className="inline-flex">
              <input type="hidden" name="outletId" value={outletId} />
              <input type="hidden" name="list" value={list} />
              <input type="hidden" name="term" value={t} />
              <SubmitButton
                className={`${chipClass} inline-flex items-center gap-1 transition hover:opacity-80`}
                style={{ ...chipStyle, cursor: "pointer" }}
                title={`Remove "${t}"`}
                pendingLabel="Removing"
              >
                <span>{t}</span>
                <span style={{ opacity: 0.6 }}>x</span>
              </SubmitButton>
            </form>
          ))}
        </div>
      )}
    </div>
  );
}
