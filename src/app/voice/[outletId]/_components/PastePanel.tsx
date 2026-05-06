"use client";
import { PendingMessage, SubmitButton } from "@/app/_components/SubmitButton";
import { seedVoiceFromSamplesAction } from "@/lib/v1/actions";

export function PastePanel({ outletId, hasProfile }: { outletId: string; hasProfile: boolean }) {
  return (
    <form action={seedVoiceFromSamplesAction} className="space-y-3">
      <input type="hidden" name="outletId" value={outletId} />
      <input type="hidden" name="method" value="paste" />
      <p className="text-[13px] leading-relaxed" style={{ color: "var(--fg-muted)" }}>
        Paste 500+ words of your prose; an old post, a draft, an essay. Separate multiple samples
        with a line containing only{" "}
        <code className="rounded bg-[color:var(--bg-subtle)] px-1">---</code>.
      </p>
      <textarea
        name="samples"
        required
        rows={10}
        placeholder="Paste your prose here. Aim for 500+ words for a stable fingerprint."
        className="fp-input w-full"
        style={{
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
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
      <PendingMessage>Extracting a voice fingerprint from your pasted samples.</PendingMessage>
    </form>
  );
}
