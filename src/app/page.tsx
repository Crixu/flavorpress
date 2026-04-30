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
import {
  TodayFolderStreams,
  type TodayClusterPreview,
} from "./_components/TodayFolderStreams";

export const dynamic = "force-dynamic";

export default async function TodayPage() {
  await ensureSchema();
  await ensureSingleUser();
  await ensureRegisteredCapabilities();

  const clusters = await topFiredClusters(SINGLE_USER_ID, 18);

  const outlets = await listOutlets(SINGLE_USER_ID);
  const connectedOutlets = outlets.filter((o) => o.connected);
  const hasOutlet = connectedOutlets.length > 0;

  const sourceCountR = await db.execute({
    sql: `SELECT COUNT(*) AS n FROM sources
          WHERE user_id = ? AND active = 1
            AND (paused_until IS NULL OR paused_until <= ?)`,
    args: [SINGLE_USER_ID, Date.now()],
  });
  const sourceCount = Number(sourceCountR.rows[0]!.n);

  const voiceR = await db.execute({
    sql: `SELECT outlet_id FROM voice_profiles WHERE user_id = ?`,
    args: [SINGLE_USER_ID],
  });
  const profiledOutletIds = new Set(
    voiceR.rows.map((row) => String(row.outlet_id)),
  );

  // Picker only offers outlets that are both connected AND have a voice
  // profile. Without a profile, the draft generator falls back to a generic
  // style sheet, breaking the "voice-matched draft" promise. Without a
  // connection, the WP publish step has nothing to push to. A profile from
  // a since-disconnected outlet is preserved on disk for reconnect, but
  // doesn't count as draftable until that outlet is connected again.
  const draftableOutlets = connectedOutlets.filter((o) =>
    profiledOutletIds.has(o.id),
  );
  const hasDraftableOutlet = draftableOutlets.length > 0;
  const defaultOutletId =
    draftableOutlets.find((o) => o.isDefault)?.id ??
    draftableOutlets[0]?.id ??
    null;
  const outletOptions = draftableOutlets.map((o) => ({
    id: o.id,
    displayName: o.displayName ?? o.baseUrl,
  }));

  if (!hasOutlet || sourceCount < 5 || !hasDraftableOutlet) {
    return (
      <Onboarding
        hasSite={hasOutlet}
        sourceCount={sourceCount}
        hasVoice={hasDraftableOutlet}
      />
    );
  }

  const allPreviews: TodayClusterPreview[] = await Promise.all(
    clusters.map(async (c) => {
      const r = await db.execute({
        sql: `SELECT i.title, s.id AS source_id, s.url AS source_url, s.display_name,
                     s.folder_id, sf.name AS folder_name
              FROM items i
              JOIN sources s ON s.id = i.source_id
              LEFT JOIN source_folders sf ON sf.id = s.folder_id
              WHERE i.cluster_id = ?
              ORDER BY i.published_at DESC LIMIT 8`,
        args: [c.id],
      });
      // Existing drafts for this cluster, keyed by outlet. The card uses
      // the per-outlet draft to decide between "Open draft" and "Draft this"
      // for the selected outlet.
      const draftR = await db.execute({
        sql: `SELECT id, outlet_id, voice_match_score, wp_post_id, wp_edit_link
              FROM drafts WHERE cluster_id = ? AND user_id = ?
              ORDER BY created_at DESC`,
        args: [c.id, SINGLE_USER_ID],
      });
      const draftsByOutlet: Record<
        string,
        { id: string; voiceMatch: number; wpEditLink: string | null }
      > = {};
      for (const row of draftR.rows) {
        const oid = row.outlet_id ? String(row.outlet_id) : "";
        if (!oid || draftsByOutlet[oid]) continue;
        draftsByOutlet[oid] = {
          id: String(row.id),
          voiceMatch: Number(row.voice_match_score ?? 0),
          wpEditLink: row.wp_edit_link ? String(row.wp_edit_link) : null,
        };
      }
      const items = r.rows.map((row) => ({
        title: String(row.title),
        sourceId: String(row.source_id),
        sourceUrl: String(row.source_url),
        displayName: String(row.display_name ?? ""),
        folderId: row.folder_id ? String(row.folder_id) : null,
        folderName: row.folder_name ? String(row.folder_name) : "Ungrouped",
      }));
      const folder = dominantFolder(items);
      return {
        cluster: {
          id: c.id,
          formedAt: c.formedAt,
          firedAt: c.firedAt,
          latestPublishedAt: c.latestPublishedAt,
          sourceCount: c.sourceCount,
          signals: c.signals
            ? {
                archiveOverlap: c.signals.archiveOverlap,
                beatMatch: c.signals.beatMatch,
                sourceTrust: c.signals.sourceTrust,
                composite: c.signals.composite,
              }
            : null,
        },
        folder,
        items: items.map((item) => ({
          title: item.title,
          sourceId: item.sourceId,
          sourceUrl: item.sourceUrl,
          displayName: item.displayName,
        })),
        draftsByOutlet,
      };
    }),
  );

  // Today is a writing surface; an "Ungrouped" reading lane has no shape to
  // brief from, so we hide those clusters here. They still appear under
  // Ungrouped in the Sources view.
  const previews = allPreviews.filter((p) => p.folder.id !== null);

  return (
    <div className="space-y-8">
      <header className="space-y-1.5">
        <div className="fp-eyebrow">{formatDate(Date.now())}</div>
        <h1 className="fp-h1 fp-h1-serif">
          {previews.length === 0
            ? "No clusters yet"
            : previews.length === 1
            ? "One cluster worth your attention"
            : `${previews.length} clusters across ${countFolders(previews)} streams`}
        </h1>
        <p className="text-sm" style={{ color: "var(--fg-muted)" }}>
          Each folder is a reading lane. Open the strongest cluster, ask for
          more, or set that lane aside for now.
        </p>
      </header>

      {previews.length === 0 ? (
        <EmptyClusters />
      ) : (
        <TodayFolderStreams
          previews={previews}
          outlets={outletOptions}
          defaultOutletId={defaultOutletId}
        />
      )}
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

function countFolders(previews: TodayClusterPreview[]): number {
  return new Set(previews.map((preview) => preview.folder.id ?? "ungrouped")).size;
}

function dominantFolder(
  items: Array<{ folderId: string | null; folderName: string }>,
): { id: string | null; name: string } {
  const counts = new Map<string, { id: string | null; name: string; count: number }>();
  for (const item of items) {
    const key = item.folderId ?? "ungrouped";
    const current = counts.get(key);
    if (current) {
      current.count += 1;
    } else {
      counts.set(key, {
        id: item.folderId,
        name: item.folderName,
        count: 1,
      });
    }
  }
  return (
    Array.from(counts.values()).sort((a, b) => b.count - a.count)[0] ?? {
      id: null,
      name: "Ungrouped",
    }
  );
}
