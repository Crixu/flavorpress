/**
 * Today screen.
 *
 * Empty-state is a guided 3-step hero. Populated state is editorial cluster
 * cards with a typeset headline and a trust-strip footer.
 */

import Link from "next/link";
import { ensureSchema, ensureSingleUser, SINGLE_USER_ID, db } from "@/lib/db";
import { ensureRegisteredCapabilities } from "@/lib/v1/bootstrap";
import { topFiredClusters } from "@/lib/v1/ranker";
import { listOutlets } from "@/lib/v1/outlets";
import { ClusterActions } from "./_components/ClusterActions";

export const dynamic = "force-dynamic";

export default async function TodayPage() {
  await ensureSchema();
  await ensureSingleUser();
  await ensureRegisteredCapabilities();

  const clusters = await topFiredClusters(SINGLE_USER_ID, 3);

  const outlets = await listOutlets(SINGLE_USER_ID);
  const hasOutlet = outlets.some((o) => o.connected);

  const sourceCountR = await db.execute({
    sql: `SELECT COUNT(*) AS n FROM sources WHERE user_id = ? AND active = 1`,
    args: [SINGLE_USER_ID],
  });
  const sourceCount = Number(sourceCountR.rows[0]!.n);

  const voiceR = await db.execute({
    sql: `SELECT outlet_id FROM voice_profiles WHERE user_id = ?`,
    args: [SINGLE_USER_ID],
  });
  const hasVoice = voiceR.rows.length > 0;

  if (!hasOutlet || sourceCount < 5 || !hasVoice) {
    return (
      <Onboarding
        hasSite={hasOutlet}
        sourceCount={sourceCount}
        hasVoice={hasVoice}
      />
    );
  }

  const previews = await Promise.all(
    clusters.map(async (c) => {
      const r = await db.execute({
        sql: `SELECT i.title, s.url AS source_url, s.display_name
              FROM items i
              JOIN sources s ON s.id = i.source_id
              WHERE i.cluster_id = ?
              ORDER BY i.published_at DESC LIMIT 5`,
        args: [c.id],
      });
      // Existing draft for this cluster (latest). If present, the card
      // surfaces "Open draft" instead of regenerating from scratch.
      const draftR = await db.execute({
        sql: `SELECT id, voice_match_score, wp_post_id, wp_edit_link
              FROM drafts WHERE cluster_id = ? AND user_id = ?
              ORDER BY created_at DESC LIMIT 1`,
        args: [c.id, SINGLE_USER_ID],
      });
      const existingDraft = draftR.rows[0] ?? null;
      return {
        cluster: c,
        items: r.rows.map((row) => ({
          title: String(row.title),
          sourceUrl: String(row.source_url),
          displayName: String(row.display_name ?? ""),
        })),
        draft: existingDraft
          ? {
              id: String(existingDraft.id),
              voiceMatch: Number(existingDraft.voice_match_score ?? 0),
              wpEditLink: existingDraft.wp_edit_link
                ? String(existingDraft.wp_edit_link)
                : null,
            }
          : null,
      };
    }),
  );

  return (
    <div className="space-y-8">
      <header className="space-y-1.5">
        <div className="fp-eyebrow">{formatDate(Date.now())}</div>
        <h1 className="fp-h1 fp-h1-serif">
          {clusters.length === 0
            ? "No clusters yet"
            : clusters.length === 1
            ? "One cluster worth your attention"
            : `${clusters.length} clusters worth your attention`}
        </h1>
        <p className="text-sm" style={{ color: "var(--fg-muted)" }}>
          Three is the cap. Each cluster has crossed combined source-trust 1.0
          across 2+ domains in the last 72 hours. Rank, then write.
        </p>
      </header>

      {clusters.length === 0 ? (
        <EmptyClusters />
      ) : (
        <div className="space-y-4">
          {previews.map((preview, idx) => (
            <ClusterCard
              key={preview.cluster.id}
              preview={preview}
              rank={idx + 1}
              isTop={idx === 0}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface ClusterPreview {
  cluster: Awaited<ReturnType<typeof topFiredClusters>>[number];
  items: { title: string; sourceUrl: string; displayName: string }[];
  draft: {
    id: string;
    voiceMatch: number;
    wpEditLink: string | null;
  } | null;
}

function ClusterCard({
  preview,
  rank,
  isTop,
}: {
  preview: ClusterPreview;
  rank: number;
  isTop: boolean;
}) {
  const c = preview.cluster;
  const headline = preview.items[0]?.title ?? "Untitled cluster";
  const fit = c.signals?.composite ?? 0;
  return (
    <article className={`fp-card ${isTop ? "fp-card-feature" : "fp-card-hover"} relative p-6`}>
      {isTop ? (
        <div
          className="absolute -top-3 left-6 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-white"
          style={{
            background: "linear-gradient(135deg, var(--indigo) 0%, var(--rose) 130%)",
            boxShadow: "var(--shadow-sm)",
          }}
        >
          <span>★</span> Pre-rendered · instant
        </div>
      ) : null}

      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <div className="flex items-center gap-2 fp-eyebrow">
            <span>#{rank}</span>
            <span style={{ color: "var(--border-strong)" }}>·</span>
            <span style={{ textTransform: "none", fontWeight: 400 }}>
              {c.sourceCount} sources
            </span>
            <span style={{ color: "var(--border-strong)" }}>·</span>
            <span style={{ textTransform: "none", fontWeight: 400 }}>
              {relativeTime(c.firedAt ?? c.formedAt)}
            </span>
            <span className="fp-chip fp-chip-emerald ml-1">
              fit {fit.toFixed(2)}
            </span>
          </div>
          <h2
            className={`mt-2 leading-snug font-semibold ${
              isTop ? "text-2xl fp-h1-serif" : "text-lg"
            }`}
            style={{ letterSpacing: "-0.01em" }}
          >
            {headline}
          </h2>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-1.5">
        {preview.items.map((item, i) => (
          <span key={i} className="fp-chip">
            {item.displayName || hostFromUrl(item.sourceUrl)}
          </span>
        ))}
      </div>

      {c.signals ? (
        <div
          className="mt-4 grid grid-cols-3 gap-3 rounded-lg p-3"
          style={{ background: "var(--bg-subtle)" }}
        >
          <RankerSignal
            label="Archive overlap"
            value={c.signals.archiveOverlap}
          />
          <RankerSignal label="Beat match" value={c.signals.beatMatch} />
          <RankerSignal label="Source trust" value={c.signals.sourceTrust} />
        </div>
      ) : null}

      <div className="mt-5">
        <ClusterActions clusterId={c.id} draft={preview.draft} />
      </div>
    </article>
  );
}

function RankerSignal({ label, value }: { label: string; value: number }) {
  const pct = Math.round(value * 100);
  return (
    <div>
      <div className="flex items-center justify-between text-[11px]" style={{ color: "var(--fg-muted)" }}>
        <span>{label}</span>
        <span className="tabular font-medium" style={{ color: "var(--fg)" }}>
          {value.toFixed(2)}
        </span>
      </div>
      <div
        className="mt-1 h-1 overflow-hidden rounded-full"
        style={{ background: "var(--border)" }}
      >
        <div
          className="h-full rounded-full transition-all"
          style={{
            width: `${pct}%`,
            background:
              "linear-gradient(90deg, var(--indigo) 0%, var(--rose) 200%)",
          }}
        />
      </div>
    </div>
  );
}

function EmptyClusters() {
  return (
    <div
      className="fp-card-feature p-10 text-center"
      style={{ background: "var(--surface)" }}
    >
      <div className="mx-auto mb-4 inline-flex h-12 w-12 items-center justify-center rounded-2xl" style={{ background: "var(--indigo-tint)" }}>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--indigo)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.3-4.3" />
        </svg>
      </div>
      <h2 className="fp-h1-serif" style={{ fontSize: 22 }}>
        Sources are polling. Clusters fire automatically.
      </h2>
      <p className="mx-auto mt-2 max-w-md text-sm" style={{ color: "var(--fg-muted)" }}>
        A cluster fires when 3 or more sources cover the same story within 72
        hours, from at least 2 distinct domains. Want it now? Hit "Poll all"
        on Sources.
      </p>
      <div className="mt-5 flex justify-center gap-2">
        <Link href="/sources" className="fp-btn fp-btn-ghost">
          Manage sources
        </Link>
        <Link href="/voice" className="fp-btn fp-btn-primary">
          Voice & Publishing →
        </Link>
      </div>
    </div>
  );
}

function Onboarding({
  hasSite,
  sourceCount,
  hasVoice,
}: {
  hasSite: boolean;
  sourceCount: number;
  hasVoice: boolean;
}) {
  const steps = [
    {
      done: hasSite,
      number: 1,
      title: "Connect WordPress",
      description:
        "One click, no copy-pasting passwords. We open your site's authorize page; you click Approve; we get an Application Password back.",
      cta: hasSite ? "Reconnect" : "Connect WordPress",
      href: "/voice",
      icon: ConnectIcon,
    },
    {
      done: hasVoice,
      number: 2,
      title: "Build voice profile",
      description:
        "Pulls your last 50 published posts and extracts a stylometric fingerprint. Sentence rhythm, signature terms, banned vocabulary. Decay-weighted by recency.",
      cta: hasVoice ? "Re-train" : "Build profile",
      href: "/voice",
      icon: VoiceIcon,
    },
    {
      done: sourceCount >= 5,
      number: 3,
      title: `Add sources (${sourceCount}/5)`,
      description:
        "Bring 5+ feeds in your niche. RSS, Reddit, podcasts, YouTube. We poll continuously; clusters surface when 3+ outlets converge on the same story.",
      cta: sourceCount >= 5 ? "Add more" : "Add sources",
      href: "/sources",
      icon: SourceIcon,
    },
  ];
  const completed = steps.filter((s) => s.done).length;
  const progress = (completed / steps.length) * 100;

  return (
    <div className="space-y-10">
      {/* Hero */}
      <header className="space-y-3">
        <div className="fp-eyebrow">Welcome to FlavorPress</div>
        <h1 className="fp-h1 fp-h1-serif" style={{ maxWidth: "16ch" }}>
          Your reading turns into your writing.
        </h1>
        <p className="max-w-xl text-base leading-relaxed" style={{ color: "var(--fg-muted)" }}>
          Three steps. Connect your WordPress, train the voice, plug in your
          sources. Then every morning, three story clusters surface, ranked
          and ready to draft.
        </p>
      </header>

      {/* Progress */}
      <div className="fp-card p-5">
        <div className="flex items-center justify-between text-sm">
          <span className="font-medium">Setup progress</span>
          <span className="tabular" style={{ color: "var(--fg-muted)" }}>
            {completed} of {steps.length}
          </span>
        </div>
        <div
          className="mt-3 h-1.5 overflow-hidden rounded-full"
          style={{ background: "var(--border)" }}
        >
          <div
            className="h-full rounded-full transition-all"
            style={{
              width: `${progress}%`,
              background:
                "linear-gradient(90deg, var(--indigo) 0%, var(--rose) 100%)",
              transitionDuration: "400ms",
            }}
          />
        </div>
      </div>

      {/* Step cards */}
      <div className="grid gap-4 md:grid-cols-3">
        {steps.map((step) => (
          <Link
            key={step.number}
            href={step.href}
            className={`fp-card fp-card-hover fp-press p-5 group flex flex-col`}
            style={
              !step.done
                ? { borderColor: "var(--indigo-tint)" }
                : undefined
            }
          >
            <div className="flex items-start justify-between">
              <div
                className={`inline-flex h-10 w-10 items-center justify-center rounded-xl ${
                  step.done ? "" : "transition-transform group-hover:scale-105"
                }`}
                style={{
                  background: step.done ? "var(--emerald-tint)" : "var(--indigo-tint)",
                  color: step.done ? "var(--emerald)" : "var(--indigo)",
                }}
              >
                {step.done ? <CheckIcon /> : <step.icon />}
              </div>
              <span
                className={step.done ? "fp-chip fp-chip-emerald" : "fp-chip fp-chip-indigo"}
              >
                {step.done ? "Done" : `Step ${step.number}`}
              </span>
            </div>
            <h3 className="mt-4 text-base font-semibold tracking-tight">
              {step.title}
            </h3>
            <p className="mt-1 text-[13px] leading-relaxed flex-1" style={{ color: "var(--fg-muted)" }}>
              {step.description}
            </p>
            <div
              className="mt-4 inline-flex items-center gap-1 text-sm font-medium transition-transform group-hover:translate-x-0.5"
              style={{ color: step.done ? "var(--fg-muted)" : "var(--indigo)" }}
            >
              {step.cta} →
            </div>
          </Link>
        ))}
      </div>

      {/* What happens after */}
      <div
        className="fp-card-feature fp-gradient-surface p-6"
      >
        <div className="fp-eyebrow mb-2">What happens after setup</div>
        <div className="grid gap-4 md:grid-cols-3">
          <Step number="1" label="Sources poll continuously" detail="RSS / Reddit every 5 min; podcasts and YouTube every hour." />
          <Step number="2" label="Cluster engine fires" detail="3+ sources covering the same story within 72h triggers a cluster." />
          <Step number="3" label="Drafts surface ranked" detail="Top-3 pre-rendered for instant tap. Voice-matched, fact-checked, ready to publish." />
        </div>
      </div>
    </div>
  );
}

function Step({ number, label, detail }: { number: string; label: string; detail: string }) {
  return (
    <div>
      <div
        className="inline-flex h-7 w-7 items-center justify-center rounded-md text-xs font-semibold tabular"
        style={{ background: "var(--surface)", color: "var(--indigo)", border: "1px solid var(--border)" }}
      >
        {number}
      </div>
      <div className="mt-2 text-sm font-medium">{label}</div>
      <div className="mt-1 text-xs" style={{ color: "var(--fg-muted)" }}>
        {detail}
      </div>
    </div>
  );
}

function ConnectIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  );
}
function VoiceIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="22" />
    </svg>
  );
}
function SourceIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 11a9 9 0 0 1 9 9" />
      <path d="M4 4a16 16 0 0 1 16 16" />
      <circle cx="5" cy="19" r="1" />
    </svg>
  );
}
function CheckIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

function relativeTime(ms: number): string {
  const diff = Date.now() - ms;
  const min = Math.floor(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}

function hostFromUrl(s: string): string {
  try {
    return new URL(s).host.replace(/^www\./, "");
  } catch {
    return s;
  }
}
