/**
 * Today screen.
 *
 * Empty-state is a guided 3-step hero. Populated state is editorial cluster
 * cards with a typeset headline and a trust-strip footer.
 */

import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthRequiredError, requireSession } from "@/lib/session";
import { canPollAllSources } from "@/lib/plans";
import { TodayFolderStreams } from "./_components/TodayFolderStreams";
import { TopicSearch } from "./_components/TopicSearch/TopicSearch";
import { PollAllButton } from "./sources/_components/PollAllButton";
import { TodayStats } from "./_components/TodayStats";
import { LookForClustersButton } from "./_components/LookForClustersButton";
import { TodayCacheAutoRefresh } from "./_components/TodayCacheAutoRefresh";
import {
  getTodayCachedViewState,
  loadTodayFrame,
  needsTodayOnboarding,
  scheduleTodayCacheRefresh,
} from "@/lib/v1/today-view";

export const dynamic = "force-dynamic";

export default async function TodayPage() {
  let session;
  try {
    session = await requireSession();
  } catch (err) {
    if (err instanceof AuthRequiredError) redirect("/login");
    throw err;
  }

  const cache = await getTodayCachedViewState(session.userId);
  const frame = cache.payload?.frame ?? (await loadTodayFrame(session.userId));
  const showPollAll = await canPollAllSources(session.userId, session.isAdmin);
  if (needsTodayOnboarding(frame)) {
    return (
      <Onboarding
        hasSite={frame.hasOutlet}
        sourceCount={frame.sourceCount}
        hasVoice={frame.hasDraftableOutlet}
      />
    );
  }

  if (cache.status !== "fresh") {
    await scheduleTodayCacheRefresh(session.userId, cache);
  }
  const payload = cache.payload?.ready ?? null;
  const headline = !payload
    ? "Preparing today's reading lanes"
    : formatTodayHeadline(payload.totalPreviews, payload.streamsWithContent);

  return (
    <div className="space-y-8">
      <header className="space-y-1.5">
        <div className="fp-eyebrow">{formatDate(frame.renderedAt)}</div>
        <h1 className="fp-h1 fp-h1-serif">{headline}</h1>
        <p className="text-sm" style={{ color: "var(--fg-muted)" }}>
          Each folder is a reading lane. Open the strongest cluster, ask for more, or set that lane
          aside for now.
        </p>
      </header>

      <TodayStats
        newSinceLastVisit={frame.stats.newSinceLastVisit}
        draftsInProgress={frame.stats.draftsInProgress}
        sentThisMonth={frame.stats.sentThisMonth}
      />

      <TodayCacheStatus
        status={cache.status}
        computedAt={cache.computedAt}
        error={cache.error}
        hasPayload={Boolean(payload)}
        now={frame.renderedAt}
      />
      {cache.status !== "fresh" ? <TodayCacheAutoRefresh /> : null}

      <div className="flex items-center gap-3">
        <LookForClustersButton />
      </div>

      <TopicSearch outlets={frame.outletOptions} defaultOutletId={frame.defaultOutletId}>
        {!payload ? (
          <LoadingTodayView />
        ) : payload.totalPreviews === 0 ? (
          payload.emptyClusterStats ? (
            <EmptyClusters
              polledSourceCount={payload.emptyClusterStats.polledSourceCount}
              itemsTotal={payload.emptyClusterStats.itemsTotal}
              itemsTotalCapped={payload.emptyClusterStats.itemsTotalCapped}
              showPollAll={showPollAll}
            />
          ) : (
            <LoadingTodayView />
          )
        ) : (
          <TodayFolderStreams
            streams={payload.streams}
            outlets={frame.outletOptions}
            defaultOutletId={frame.defaultOutletId}
            renderedAt={frame.renderedAt}
          />
        )}
      </TopicSearch>
    </div>
  );
}

function formatTodayHeadline(totalPreviews: number, streamsWithContent: number): string {
  if (totalPreviews === 0) return "No clusters yet";
  if (totalPreviews === 1) return "One cluster worth your attention";
  return `${totalPreviews} clusters across ${streamsWithContent} ${
    streamsWithContent === 1 ? "stream" : "streams"
  }`;
}

function TodayCacheStatus({
  status,
  computedAt,
  error,
  hasPayload,
  now,
}: {
  status: "fresh" | "stale" | "missing";
  computedAt: number | null;
  error: string | null;
  hasPayload: boolean;
  now: number;
}) {
  if (status === "fresh" && computedAt) {
    return (
      <p className="text-xs" style={{ color: "var(--fg-subtle)" }}>
        Updated {relativeTime(computedAt, now)}.
      </p>
    );
  }

  const copy = hasPayload
    ? `Showing cached lanes from ${
        computedAt ? relativeTime(computedAt, now) : "an earlier visit"
      } while today's view refreshes.`
    : "Building today's lanes in the background. This page will refresh as soon as they are ready.";

  return (
    <div
      className="rounded-lg px-3 py-2 text-xs"
      style={{
        background: "var(--bg-subtle)",
        border: "1px solid var(--border)",
        color: "var(--fg-muted)",
      }}
      role="status"
      aria-live="polite"
    >
      <span className="inline-flex items-center gap-1.5">
        <span className="fp-spinner" aria-hidden />
        <span>{error ? `${copy} Last refresh failed: ${error}` : copy}</span>
      </span>
    </div>
  );
}

function LoadingTodayView() {
  return (
    <div className="fp-card-feature p-10 text-center" style={{ background: "var(--surface)" }}>
      <div
        className="mx-auto mb-4 inline-flex h-12 w-12 items-center justify-center rounded-2xl"
        style={{ background: "var(--indigo-tint)" }}
      >
        <span className="fp-spinner" aria-hidden />
      </div>
      <h2 className="fp-h1-serif" style={{ fontSize: 22 }}>
        Building today&apos;s lanes.
      </h2>
      <p className="mx-auto mt-2 max-w-md text-sm" style={{ color: "var(--fg-muted)" }}>
        You can leave this page open. Fresh clusters will appear when the background refresh
        finishes.
      </p>
    </div>
  );
}

function EmptyClusters({
  polledSourceCount,
  itemsTotal,
  itemsTotalCapped,
  showPollAll,
}: {
  polledSourceCount: number;
  itemsTotal: number;
  itemsTotalCapped: boolean;
  showPollAll: boolean;
}) {
  // Three distinct waiting states. Each gets one action so the user is
  // never asked to pick between "manage" and "publish" in a moment that
  // is just about getting the first cluster on screen.
  const stage =
    polledSourceCount === 0 ? "first-poll" : itemsTotal === 0 ? "no-items" : "no-cluster-yet";

  const copy = {
    "first-poll": {
      title: "Polling your feeds for the first time.",
      body: "Items appear as the first fetch completes. A cluster fires when 3 sources converge on the same story within 72 hours.",
    },
    "no-items": {
      title: "Polls done. No items came back yet.",
      body: "A few sources may be returning errors. Open the source list to see which feeds are stuck.",
    },
    "no-cluster-yet": {
      title: `${formatItemCount(itemsTotal, itemsTotalCapped)} ${
        itemsTotal === 1 && !itemsTotalCapped ? "item" : "items"
      } in. No cluster yet.`,
      body: "A cluster fires when 3 sources cover the same story within 72 hours, from at least 2 distinct domains. Add another feed in this beat to bring convergence forward.",
    },
  }[stage];

  return (
    <div className="fp-card-feature p-10 text-center" style={{ background: "var(--surface)" }}>
      <div
        className="mx-auto mb-4 inline-flex h-12 w-12 items-center justify-center rounded-2xl"
        style={{ background: "var(--indigo-tint)" }}
      >
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="var(--indigo)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.3-4.3" />
        </svg>
      </div>
      <h2 className="fp-h1-serif" style={{ fontSize: 22 }}>
        {copy.title}
      </h2>
      <p className="mx-auto mt-2 max-w-md text-sm" style={{ color: "var(--fg-muted)" }}>
        {copy.body}
      </p>
      <div className="mt-5 flex justify-center">
        {stage === "first-poll" && showPollAll ? (
          <PollAllButton />
        ) : (
          <Link href="/sources" className="fp-btn fp-btn-primary">
            {stage === "no-cluster-yet" ? "Add a source →" : "Open sources →"}
          </Link>
        )}
      </div>
    </div>
  );
}

function formatItemCount(itemsTotal: number, capped: boolean): string {
  if (capped) return "1,000+";
  return new Intl.NumberFormat("en-US").format(itemsTotal);
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
  type GuideStep = {
    id: number;
    shortLabel: string;
    title: string;
    blurb: string;
    detail: string;
    cta: string;
    href: string;
    icon: () => React.ReactElement;
    done: boolean;
  };

  const steps: GuideStep[] = [
    {
      id: 1,
      shortLabel: "Connect",
      title: "Connect your WordPress",
      blurb:
        "One click, no copy-pasting passwords. Your site's authorize page opens; you click Approve; we get an Application Password back.",
      detail:
        "We never see your login. Drafts always land as drafts; nothing publishes without you clicking the button.",
      cta: hasSite ? "Manage outlets" : "Connect WordPress",
      href: "/voice",
      icon: ConnectIcon,
      done: hasSite,
    },
    {
      id: 2,
      shortLabel: "Voice",
      title: "Train your voice",
      blurb:
        "Your last 50 published posts get pulled and turned into a stylometric fingerprint. Sentence rhythm, signature terms, banned vocabulary, decay-weighted by recency.",
      detail:
        "Drafts are voice-matched against this profile. Edit it any time and re-train after a stylistic shift.",
      cta: hasVoice ? "Review profile" : "Build voice profile",
      href: "/voice",
      icon: VoiceIcon,
      done: hasVoice,
    },
    {
      id: 3,
      shortLabel: "Sources",
      title: "Plug in your sources",
      blurb:
        "Bring 5 or more feeds in your niche. RSS, newsletters, Reddit, podcasts, YouTube. We poll continuously and group items into clusters when 3+ feeds converge on the same story within 72 hours.",
      detail:
        sourceCount >= 5
          ? `${sourceCount} added. Polish folders, prune sources, or import an OPML file.`
          : `${sourceCount} of 5 added. Use a starter pack for a fast start, paste URLs by hand, or import an OPML from your existing reader.`,
      cta: sourceCount >= 5 ? "Manage sources" : "Add sources",
      href: "/sources",
      icon: SourceIcon,
      done: sourceCount >= 5,
    },
  ];

  const currentStep = steps.find((s) => !s.done) ?? steps[steps.length - 1]!;
  const completed = steps.filter((s) => s.done).length;
  const progress = (completed / steps.length) * 100;
  const upcoming = steps.filter((s) => !s.done && s.id !== currentStep.id);
  const FocusIcon = currentStep.icon;

  return (
    <div className="space-y-8">
      {/* Hero */}
      <header className="space-y-3">
        <div className="fp-eyebrow">Welcome to FlavorPress</div>
        <h1 className="fp-h1 fp-h1-serif" style={{ maxWidth: "18ch" }}>
          Your reading turns into your writing.
        </h1>
        <p className="max-w-xl text-base leading-relaxed" style={{ color: "var(--fg-muted)" }}>
          Three steps from a blank slate to your first draft. Connect a WordPress site, train the
          voice, plug in the feeds you already read. Clusters surface when those feeds converge; you
          choose which to draft.
        </p>
      </header>

      {/* Progress strip with step labels */}
      <div className="fp-card p-5">
        <div className="flex items-center justify-between text-sm">
          <span className="font-medium">Welcome guide</span>
          <span className="tabular" style={{ color: "var(--fg-muted)" }}>
            {completed} of {steps.length} done
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
              background: "linear-gradient(90deg, var(--indigo) 0%, var(--rose) 100%)",
              transitionDuration: "400ms",
            }}
          />
        </div>
        <ol className="mt-3 grid grid-cols-3 gap-2 text-xs">
          {steps.map((s) => {
            const isCurrent = s.id === currentStep.id;
            const tone = s.done
              ? "var(--emerald)"
              : isCurrent
                ? "var(--indigo)"
                : "var(--fg-subtle)";
            return (
              <li key={s.id} className="flex items-center gap-1.5" style={{ color: tone }}>
                <span
                  className="inline-flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-semibold tabular"
                  style={{
                    background: s.done
                      ? "var(--emerald-tint)"
                      : isCurrent
                        ? "var(--indigo)"
                        : "var(--bg-subtle)",
                    color: s.done ? "var(--emerald)" : isCurrent ? "#fff" : "var(--fg-subtle)",
                  }}
                >
                  {s.done ? "✓" : s.id}
                </span>
                <span className={isCurrent ? "font-medium" : ""}>{s.shortLabel}</span>
              </li>
            );
          })}
        </ol>
      </div>

      {/* Focus card: the one step the user should do next */}
      <div className="fp-card-feature p-7 md:p-9">
        <div className="grid gap-6 md:grid-cols-[auto_1fr] items-start">
          <div
            className="inline-flex h-14 w-14 items-center justify-center rounded-2xl shrink-0"
            style={{
              background: "var(--indigo)",
              color: "#fff",
            }}
          >
            <FocusIcon />
          </div>
          <div>
            <div className="fp-eyebrow">
              Step {currentStep.id} of {steps.length}
            </div>
            <h2 className="fp-h1-serif mt-2" style={{ fontSize: 26, lineHeight: 1.15 }}>
              {currentStep.title}
            </h2>
            <p className="mt-3 max-w-2xl text-base leading-relaxed">{currentStep.blurb}</p>
            <p className="mt-2 max-w-2xl text-sm" style={{ color: "rgba(0,0,0,0.62)" }}>
              {currentStep.detail}
            </p>
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <Link href={currentStep.href} className="fp-btn fp-btn-primary">
                {currentStep.cta} →
              </Link>
              <span className="text-xs" style={{ color: "rgba(0,0,0,0.55)" }}>
                Takes about a minute.
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Up next: muted previews of remaining steps */}
      {upcoming.length > 0 ? (
        <section className="space-y-3">
          <div className="fp-eyebrow">Up next</div>
          <div className="grid gap-3 md:grid-cols-2">
            {upcoming.map((s) => {
              const Icon = s.icon;
              return (
                <div
                  key={s.id}
                  className="fp-card p-5 flex items-start gap-3"
                  style={{ opacity: 0.78 }}
                >
                  <div
                    className="inline-flex h-9 w-9 items-center justify-center rounded-lg shrink-0"
                    style={{
                      background: "var(--bg-subtle)",
                      color: "var(--fg-muted)",
                    }}
                  >
                    <Icon />
                  </div>
                  <div>
                    <div className="text-xs tabular" style={{ color: "var(--fg-subtle)" }}>
                      Step {s.id}
                    </div>
                    <div className="mt-0.5 text-sm font-medium">{s.title}</div>
                    <div
                      className="mt-1 text-xs leading-relaxed"
                      style={{ color: "var(--fg-muted)" }}
                    >
                      {s.blurb}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      {/* What happens once the guide is done */}
      <div className="fp-card p-6">
        <div className="fp-eyebrow mb-3">After the guide</div>
        <div className="grid gap-4 md:grid-cols-3">
          <Step
            number="1"
            label="Sources poll continuously"
            detail="RSS / Reddit every 5 min; podcasts and YouTube every hour."
          />
          <Step
            number="2"
            label="Cluster engine fires"
            detail="3+ sources covering the same story within 72h triggers a cluster."
          />
          <Step
            number="3"
            label="You draft from a cluster"
            detail="Tap into any cluster to draft from it; voice-matched, fact-checked, your call to publish."
          />
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
        style={{
          background: "var(--surface)",
          color: "var(--indigo)",
          border: "1px solid var(--border)",
        }}
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
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  );
}
function VoiceIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="22" />
    </svg>
  );
}
function SourceIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 11a9 9 0 0 1 9 9" />
      <path d="M4 4a16 16 0 0 1 16 16" />
      <circle cx="5" cy="19" r="1" />
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

function relativeTime(ms: number, now: number): string {
  const diff = now - ms;
  const min = Math.floor(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}
