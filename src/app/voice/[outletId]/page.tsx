/**
 * Per-outlet voice profile detail.
 *
 * Two halves:
 *   - Auto-derived stats (read-only): archive size, sentence length stats,
 *     em-dash density, hedge frequency, quote density, top function words.
 *     These come from the archive analyzer; the user can rebuild but not
 *     edit individual values.
 *   - User-curated lists (editable): banned terms ("don't say 'leverage'")
 *     and signature terms ("we always use 'shipping' not 'launching'").
 *     Chip-input UI: type a term, press Add. Click X to remove.
 */

import Link from "next/link";
import { notFound } from "next/navigation";
import { ensureSchema, ensureSingleUser, db, SINGLE_USER_ID } from "@/lib/db";
import { getOutlet } from "@/lib/v1/outlets";
import { HelpTrigger } from "@/components/Help";
import {
  PendingMessage,
  SubmitButton,
} from "@/app/_components/SubmitButton";
import {
  addVoiceTermAction,
  removeVoiceTermAction,
  buildVoiceProfileAction,
  seedVoiceFromSamplesAction,
  saveBlogDescriptionAction,
  deriveBlogDescriptionAction,
} from "@/lib/v1/actions";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ outletId: string }>;
}

export default async function VoiceDetailPage({ params }: PageProps) {
  await ensureSchema();
  await ensureSingleUser();
  const { outletId } = await params;
  const outlet = await getOutlet(outletId);
  if (!outlet || outlet.userId !== SINGLE_USER_ID) notFound();

  const r = await db.execute({
    sql: `SELECT * FROM voice_profiles WHERE outlet_id = ?`,
    args: [outletId],
  });
  const profile = r.rows[0] ?? null;

  const banned: string[] = profile
    ? (JSON.parse(String(profile.banned_terms ?? "[]")) as string[])
    : [];
  const signature: string[] = profile
    ? (JSON.parse(String(profile.signature_terms ?? "[]")) as string[])
    : [];
  const styleYaml = profile ? String(profile.style_sheet_yaml ?? "") : "";
  const description = profile
    ? String((profile as Record<string, unknown>).description ?? "")
    : "";
  const archiveSize = profile ? Number(profile.archive_index_size ?? 0) : 0;
  const sentenceMean = profile
    ? Number(profile.sentence_length_mean ?? 0)
    : 0;
  const sentenceVar = profile
    ? Number(profile.sentence_length_variance ?? 0)
    : 0;
  const emDash = profile ? Number(profile.em_dash_density ?? 0) : 0;
  const hedge = profile ? Number(profile.hedge_frequency ?? 0) : 0;
  const quoteDensity = profile ? Number(profile.quote_density ?? 0) : 0;
  const lastBuilt = profile ? Number(profile.last_rebuilt_at ?? 0) : 0;

  // Top function words (best effort: stored as packed Float64Array; show top
  // 10 indices ranked by frequency). For now we render archive size + flag
  // that fingerprint exists; the per-word view is v1.1.
  const hasFingerprint =
    profile && (profile.function_word_distribution as unknown) !== null;

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/voice"
          className="text-xs font-medium transition hover:underline"
          style={{ color: "var(--fg-muted)" }}
        >
          ← All outlets
        </Link>
      </div>

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

      {!profile ? (
        <section className="fp-card-feature p-6">
          <div className="text-base font-semibold">No voice profile yet.</div>
          <p className="mt-1 text-sm" style={{ color: "var(--fg-muted)" }}>
            Build the profile from your last 50 published posts. Takes about
            30 seconds.
          </p>
          <form action={buildVoiceProfileAction} className="mt-4">
            <input type="hidden" name="outletId" value={outletId} />
            <SubmitButton
              className="fp-btn fp-btn-primary"
              pendingLabel="Building voice"
            >
              Build voice profile
            </SubmitButton>
            <PendingMessage>
              Pulling recent posts and extracting this outlet's voice.
            </PendingMessage>
          </form>
        </section>
      ) : (
        <>
          {/* Stats grid */}
          <section>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-base font-semibold tracking-tight">
                Fingerprint{" "}
                <span
                  className="ml-1 text-xs font-normal"
                  style={{ color: "var(--fg-subtle)" }}
                >
                  auto-derived · read-only
                </span>
              </h2>
              <form action={buildVoiceProfileAction}>
                <input type="hidden" name="outletId" value={outletId} />
                <SubmitButton
                  className="fp-btn fp-btn-ghost"
                  pendingLabel="Re-training"
                >
                  ↻ Re-train from archive
                </SubmitButton>
              </form>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <Stat
                label="Posts in archive"
                value={String(archiveSize)}
                hint="archive-overlap"
              />
              <Stat
                label="Avg sentence"
                value={`${sentenceMean.toFixed(1)}w`}
              />
              <Stat
                label="Sentence variance"
                value={sentenceVar.toFixed(1)}
              />
              <Stat
                label="Em-dash / 1k"
                value={emDash.toFixed(2)}
              />
              <Stat
                label="Hedge / 1k"
                value={hedge.toFixed(2)}
              />
              <Stat
                label="Quote / 1k"
                value={quoteDensity.toFixed(2)}
              />
            </div>
            <div
              className="mt-2 text-[11px]"
              style={{ color: "var(--fg-muted)" }}
            >
              Last built {lastBuilt ? new Date(lastBuilt).toLocaleString() : "—"}
              {hasFingerprint
                ? " · function-word distribution captured"
                : ""}
            </div>
          </section>

          {/* Editable: blog description */}
          <BlogDescriptionEditor
            outletId={outletId}
            description={description}
          />

          {/* Editable: signature terms */}
          <section>
            <h2 className="mb-2 text-base font-semibold tracking-tight">
              <HelpTrigger id="signature-terms">Signature terms</HelpTrigger>
              <span
                className="ml-2 text-xs font-normal"
                style={{ color: "var(--fg-muted)" }}
              >
                phrases this voice prefers
              </span>
            </h2>
            <p
              className="mb-3 text-[13px] leading-relaxed"
              style={{ color: "var(--fg-muted)" }}
            >
              Words and phrases drafts should reach for. The model nudges
              toward these when generating. Auto-detected from your archive;
              add or remove freely.
            </p>
            <ChipEditor
              outletId={outletId}
              list="signature"
              terms={signature}
              placeholder="add a signature term, e.g. shipping"
              variant="emerald"
            />
          </section>

          {/* Editable: banned terms */}
          <section>
            <h2 className="mb-2 text-base font-semibold tracking-tight">
              <HelpTrigger id="banned-terms">Banned terms</HelpTrigger>
              <span
                className="ml-2 text-xs font-normal"
                style={{ color: "var(--fg-muted)" }}
              >
                words drafts must avoid
              </span>
            </h2>
            <p
              className="mb-3 text-[13px] leading-relaxed"
              style={{ color: "var(--fg-muted)" }}
            >
              The model rewrites around these. Useful for AI-slop words
              ("leverage", "delve", "tapestry") or jargon you've outgrown.
            </p>
            <ChipEditor
              outletId={outletId}
              list="banned"
              terms={banned}
              placeholder="add a banned term, e.g. leverage"
              variant="rose"
            />
          </section>

          {/* Style YAML preview */}
          {styleYaml ? (
            <section>
              <h2 className="mb-2 text-base font-semibold tracking-tight">
                Style sheet (YAML)
                <span
                  className="ml-2 text-xs font-normal"
                  style={{ color: "var(--fg-muted)" }}
                >
                  what the model sees
                </span>
              </h2>
              <pre
                className="overflow-x-auto rounded-lg p-4 text-[12px] leading-relaxed"
                style={{
                  background: "var(--bg-subtle)",
                  border: "1px solid var(--border)",
                  fontFamily:
                    "ui-monospace, SFMono-Regular, Menlo, monospace",
                }}
              >
                {styleYaml}
              </pre>
            </section>
          ) : null}
        </>
      )}

      <SeedFromSamples outletId={outletId} hasProfile={!!profile} />
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
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
        <span
          className="ml-2 text-xs font-normal"
          style={{ color: "var(--fg-muted)" }}
        >
          two or three sentences the drafter sees
        </span>
      </h2>
      <p
        className="mb-3 text-[13px] leading-relaxed"
        style={{ color: "var(--fg-muted)" }}
      >
        What this blog is about. The model reads it before every draft so
        clusters get framed in context, not as generic news. Auto-derive
        pulls from your homepage; edit the result freely.
      </p>
      <form
        action={saveBlogDescriptionAction}
        className="space-y-3"
      >
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
          <SubmitButton
            className="fp-btn fp-btn-primary"
            pendingLabel="Saving"
          >
            Save description
          </SubmitButton>
        </div>
      </form>
      <form action={deriveBlogDescriptionAction} className="mt-2">
        <input type="hidden" name="outletId" value={outletId} />
        <SubmitButton
          className="fp-btn fp-btn-ghost"
          pendingLabel="Reading homepage"
        >
          ↻ Auto-derive from homepage
        </SubmitButton>
        <PendingMessage>
          Reading the site root and homepage to draft a description.
        </PendingMessage>
      </form>
    </section>
  );
}

function SeedFromSamples({
  outletId,
  hasProfile,
}: {
  outletId: string;
  hasProfile: boolean;
}) {
  return (
    <section className="fp-card p-6">
      <div className="text-base font-semibold">
        {hasProfile
          ? "Reseed from sample writing."
          : "Brand-new site? Seed from sample writing."}
      </div>
      <p
        className="mt-1 text-sm leading-relaxed"
        style={{ color: "var(--fg-muted)" }}
      >
        {hasProfile
          ? "Replace the current fingerprint by pasting fresh prose; an old post, a draft, an essay. Your signature and banned terms are recomputed from the new sample."
          : "Paste at least 200 words of your prose from anywhere; an old post, a draft, an essay. We extract the same fingerprint we would build from your archive."}{" "}
        Separate multiple samples with a line containing only{" "}
        <code className="rounded bg-[color:var(--bg-subtle)] px-1">---</code>.
      </p>
      <form action={seedVoiceFromSamplesAction} className="mt-4 space-y-3">
        <input type="hidden" name="outletId" value={outletId} />
        <textarea
          name="samples"
          required
          rows={10}
          placeholder={
            "Paste your prose here. Aim for 500+ words for a stable fingerprint."
          }
          className="fp-input w-full"
          style={{
            fontFamily:
              "ui-monospace, SFMono-Regular, Menlo, monospace",
            fontSize: "12px",
            lineHeight: "1.5",
          }}
        />
        <SubmitButton
          className="fp-btn fp-btn-primary"
          pendingLabel={hasProfile ? "Reseeding voice" : "Seeding voice"}
        >
          {hasProfile ? "Reseed voice from samples" : "Seed voice from samples"}
        </SubmitButton>
        <PendingMessage>
          {hasProfile
            ? "Replacing the fingerprint with one extracted from your pasted samples."
            : "Extracting a voice fingerprint from your pasted samples."}
        </PendingMessage>
      </form>
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
  const chipClass =
    variant === "emerald" ? "fp-chip fp-chip-emerald" : "fp-chip fp-chip-rose";
  const chipStyle =
    variant === "rose" ? { textDecoration: "line-through" as const } : undefined;
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
        <SubmitButton
          className="fp-btn fp-btn-ghost"
          pendingLabel="Adding"
        >
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
            <form
              action={removeVoiceTermAction}
              key={`${list}-${t}`}
              className="inline-flex"
            >
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
                <span style={{ opacity: 0.6 }}>×</span>
              </SubmitButton>
            </form>
          ))}
        </div>
      )}
    </div>
  );
}
