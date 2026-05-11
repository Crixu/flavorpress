"use client";

import { useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { runTopicSearchAction } from "./actions";
import { generateDraftAction } from "@/lib/v1/actions";
import type { TopicSearchOutcome } from "@/lib/v1/topic-search";
import type { TopicClusterResult } from "@/lib/v1/find-clusters";

interface OutletOption {
  id: string;
  displayName: string;
}

interface Props {
  /** The default Today surface; rendered when no topic is active. */
  children: ReactNode;
  outlets: OutletOption[];
  defaultOutletId: string | null;
}

const HISTORY_KEY = "flavorpress.topicHistory";
const HISTORY_LIMIT = 8;

export function TopicSearch({ children, outlets, defaultOutletId }: Props) {
  const [topic, setTopic] = useState("");
  const [outcome, setOutcome] = useState<TopicSearchOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [history, setHistory] = useState<string[]>([]);
  const [entityFilters, setEntityFilters] = useState<Set<string>>(new Set());
  const [domainFilters, setDomainFilters] = useState<Set<string>>(new Set());

  // Hydrate topic history from localStorage on mount. The setState in an
  // effect is intentional: SSR cannot read localStorage, so the initial
  // render is empty and we sync once after mount.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(HISTORY_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return;
      const cleaned = parsed
        .filter((v): v is string => typeof v === "string")
        .map((v) => v.trim())
        .filter((v) => v.length >= 3)
        .slice(0, HISTORY_LIMIT);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setHistory(cleaned);
    } catch {
      // ignore corrupt history; leave empty
    }
  }, []);

  const persistHistory = (next: string[]) => {
    setHistory(next);
    try {
      window.localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
    } catch {
      // ignore quota / private mode failures
    }
  };

  const recordTopic = (entry: string) => {
    const trimmed = entry.trim();
    if (trimmed.length < 3) return;
    const next = [
      trimmed,
      ...history.filter((h) => h.toLowerCase() !== trimmed.toLowerCase()),
    ].slice(0, HISTORY_LIMIT);
    persistHistory(next);
  };

  const removeFromHistory = (entry: string) => {
    persistHistory(history.filter((h) => h !== entry));
  };

  const runSearch = (rawTopic: string) => {
    const trimmed = rawTopic.trim();
    if (trimmed.length < 3) return;
    setError(null);
    setEntityFilters(new Set());
    setDomainFilters(new Set());
    startTransition(async () => {
      const r = await runTopicSearchAction(trimmed);
      if (r.ok && r.outcome) {
        setOutcome(r.outcome);
        recordTopic(trimmed);
      } else {
        setOutcome(null);
        setError(r.error ?? "Topic search failed.");
      }
    });
  };

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    runSearch(topic);
  };

  const onClear = () => {
    setTopic("");
    setOutcome(null);
    setError(null);
    setEntityFilters(new Set());
    setDomainFilters(new Set());
  };

  const toggleEntityFilter = (e: string) => {
    setEntityFilters((prev) => {
      const next = new Set(prev);
      if (next.has(e)) next.delete(e);
      else next.add(e);
      return next;
    });
  };

  const toggleDomainFilter = (d: string) => {
    setDomainFilters((prev) => {
      const next = new Set(prev);
      if (next.has(d)) next.delete(d);
      else next.add(d);
      return next;
    });
  };

  const hasResults = outcome !== null;
  const showHistory = !hasResults && !isPending && history.length > 0 && topic.trim().length === 0;

  return (
    <div className="space-y-6">
      <form
        onSubmit={onSubmit}
        className="fp-card flex items-center gap-3 px-5 py-4"
        aria-label="Topic search"
      >
        <span
          className="text-[10px] uppercase tracking-wider px-2 py-1 rounded-full"
          style={{ background: "var(--plum-tint)", color: "var(--fg)" }}
        >
          DIG
        </span>
        <input
          type="text"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder="Ask about a topic, e.g. the new WordPress release"
          className="flex-1 bg-transparent text-base outline-none"
          style={{ color: "var(--fg)" }}
          disabled={isPending}
        />
        {hasResults ? (
          <button
            type="button"
            onClick={onClear}
            className="fp-btn"
            style={{ background: "transparent", border: "1px solid var(--border-strong)" }}
          >
            Clear topic
          </button>
        ) : (
          <button
            type="submit"
            className="fp-btn"
            style={{ background: "var(--indigo)", color: "var(--bg)" }}
            disabled={isPending || topic.trim().length < 3}
          >
            {isPending ? "Searching" : "Search"}
          </button>
        )}
      </form>

      {showHistory ? (
        <TopicHistoryStrip
          history={history}
          onPick={(t) => {
            setTopic(t);
            runSearch(t);
          }}
          onRemove={removeFromHistory}
        />
      ) : null}

      {error ? (
        <div
          className="fp-card px-5 py-4 text-sm"
          style={{ background: "var(--amber-tint)", color: "var(--fg)" }}
          role="alert"
        >
          {error}
        </div>
      ) : null}

      {hasResults ? (
        <TopicResults
          outcome={outcome!}
          entityFilters={entityFilters}
          domainFilters={domainFilters}
          onToggleEntity={toggleEntityFilter}
          onToggleDomain={toggleDomainFilter}
          onClearFilters={() => {
            setEntityFilters(new Set());
            setDomainFilters(new Set());
          }}
          outlets={outlets}
          defaultOutletId={defaultOutletId}
        />
      ) : (
        children
      )}
    </div>
  );
}

function TopicHistoryStrip({
  history,
  onPick,
  onRemove,
}: {
  history: string[];
  onPick: (t: string) => void;
  onRemove: (t: string) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="text-[10px] uppercase tracking-wider" style={{ color: "var(--fg-muted)" }}>
        Recent topics
      </div>
      <div className="flex flex-wrap gap-2">
        {history.map((t) => (
          <span
            key={t}
            className="inline-flex items-center gap-1 text-xs rounded-full pl-3 pr-1 py-1"
            style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
          >
            <button
              type="button"
              onClick={() => onPick(t)}
              className="text-left"
              style={{ color: "var(--fg)" }}
            >
              {t}
            </button>
            <button
              type="button"
              onClick={() => onRemove(t)}
              aria-label={`Remove "${t}" from history`}
              className="rounded-full w-5 h-5 inline-flex items-center justify-center"
              style={{ color: "var(--fg-subtle)" }}
            >
              ×
            </button>
          </span>
        ))}
      </div>
    </div>
  );
}

function TopicResults({
  outcome,
  entityFilters,
  domainFilters,
  onToggleEntity,
  onToggleDomain,
  onClearFilters,
  outlets,
  defaultOutletId,
}: {
  outcome: TopicSearchOutcome;
  entityFilters: Set<string>;
  domainFilters: Set<string>;
  onToggleEntity: (e: string) => void;
  onToggleDomain: (d: string) => void;
  onClearFilters: () => void;
  outlets: OutletOption[];
  defaultOutletId: string | null;
}) {
  const { results, extraction, topic } = outcome;

  const filtered = useMemo(() => {
    if (entityFilters.size === 0 && domainFilters.size === 0) return results;
    return results.filter((c) => {
      for (const e of entityFilters) {
        if (!c.entities.includes(e)) return false;
      }
      for (const d of domainFilters) {
        if (!c.domains.some((have) => have === d || have.endsWith(`.${d}`))) return false;
      }
      return true;
    });
  }, [results, entityFilters, domainFilters]);

  if (results.length === 0) {
    return (
      <div className="space-y-3">
        <ExtractionStrip extraction={extraction} />
        <div className="fp-card px-6 py-8 text-center" style={{ background: "var(--surface)" }}>
          <div className="fp-h1-serif" style={{ fontSize: "1.25rem", lineHeight: 1.25 }}>
            No clusters matched “{topic}”
          </div>
          <p className="mt-2 text-sm" style={{ color: "var(--fg-muted)" }}>
            Topic search only finds clusters in the last 72 hours of your sources. Try a broader
            phrasing, or wait for more items to come in.
          </p>
        </div>
      </div>
    );
  }

  const facets = buildFacets(results);
  const hasActiveFilter = entityFilters.size + domainFilters.size > 0;

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between gap-3">
        <ExtractionStrip extraction={extraction} />
        {hasActiveFilter ? (
          <ActiveFilterStrip
            entityFilters={entityFilters}
            domainFilters={domainFilters}
            onToggleEntity={onToggleEntity}
            onToggleDomain={onToggleDomain}
            onClearAll={onClearFilters}
            visible={filtered.length}
            total={results.length}
          />
        ) : null}
      </div>
      <div className="fp-topic-results-grid">
        <div className="fp-topic-card-grid">
          {filtered.length === 0 ? (
            <div
              className="fp-card px-6 py-8 text-center"
              style={{ gridColumn: "1 / -1", background: "var(--surface)" }}
            >
              <div className="text-sm" style={{ color: "var(--fg-muted)" }}>
                No clusters match the active filters.
              </div>
              <button
                type="button"
                onClick={onClearFilters}
                className="fp-btn mt-3"
                style={{ background: "transparent", border: "1px solid var(--border-strong)" }}
              >
                Clear filters
              </button>
            </div>
          ) : (
            filtered.map((c) => (
              <ClusterCard
                key={c.id}
                cluster={c}
                outlets={outlets}
                defaultOutletId={defaultOutletId}
              />
            ))
          )}
        </div>
        <FacetsSidebar
          facets={facets}
          entityFilters={entityFilters}
          domainFilters={domainFilters}
          onToggleEntity={onToggleEntity}
          onToggleDomain={onToggleDomain}
        />
      </div>
    </div>
  );
}

function ActiveFilterStrip({
  entityFilters,
  domainFilters,
  onToggleEntity,
  onToggleDomain,
  onClearAll,
  visible,
  total,
}: {
  entityFilters: Set<string>;
  domainFilters: Set<string>;
  onToggleEntity: (e: string) => void;
  onToggleDomain: (d: string) => void;
  onClearAll: () => void;
  visible: number;
  total: number;
}) {
  const chips: { label: string; kind: "entity" | "domain" }[] = [];
  for (const e of entityFilters) chips.push({ label: e, kind: "entity" });
  for (const d of domainFilters) chips.push({ label: d, kind: "domain" });
  return (
    <div className="flex flex-wrap items-center gap-2 justify-end">
      <span className="text-xs tabular" style={{ color: "var(--fg-muted)" }}>
        {visible}/{total}
      </span>
      {chips.map((c) => (
        <button
          key={`${c.kind}:${c.label}`}
          type="button"
          onClick={() => (c.kind === "entity" ? onToggleEntity(c.label) : onToggleDomain(c.label))}
          className="text-xs rounded-full inline-flex items-center gap-1 pl-3 pr-2 py-1"
          style={{ background: "var(--indigo)", color: "var(--bg)" }}
        >
          <span style={{ opacity: 0.7 }}>{c.kind === "entity" ? "@" : "·"}</span>
          {c.label}
          <span style={{ opacity: 0.7 }}>×</span>
        </button>
      ))}
      <button
        type="button"
        onClick={onClearAll}
        className="text-xs underline"
        style={{ color: "var(--fg-muted)" }}
      >
        Clear filters
      </button>
    </div>
  );
}

function ExtractionStrip({ extraction }: { extraction: TopicSearchOutcome["extraction"] }) {
  const parts: string[] = [];
  if (extraction.entities.length > 0) parts.push(`entities: ${extraction.entities.join(", ")}`);
  if (extraction.keywords.length > 0) parts.push(`keywords: ${extraction.keywords.join(", ")}`);
  if (extraction.domains.length > 0) parts.push(`domains: ${extraction.domains.join(", ")}`);
  if (extraction.sinceHours) parts.push(`last ${extraction.sinceHours}h`);
  if (parts.length === 0) return <div />;
  return (
    <div className="text-xs" style={{ color: "var(--fg-muted)" }}>
      Searching {parts.join(" · ")}
    </div>
  );
}

function ClusterCard({
  cluster,
  outlets,
  defaultOutletId,
}: {
  cluster: TopicClusterResult;
  outlets: OutletOption[];
  defaultOutletId: string | null;
}) {
  const headline = cluster.topItem?.title ?? "Untitled cluster";
  const sourceUrl = cluster.topItem?.sourceUrl ?? null;
  const [isPending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const canDraft = outlets.length > 0;
  const outletId =
    defaultOutletId && outlets.some((o) => o.id === defaultOutletId)
      ? defaultOutletId
      : (outlets[0]?.id ?? null);

  const onDraft = () => {
    if (!outletId || !formRef.current) return;
    const fd = new FormData(formRef.current);
    fd.set("clusterId", cluster.id);
    fd.set("outletId", outletId);
    fd.set("mode", "researcher");
    startTransition(async () => {
      // generateDraftAction redirects to /editor/[id] on success; the
      // transition resolves on navigation. Errors throw and surface as
      // the Next.js error boundary; that matches ClusterActions' behavior.
      await generateDraftAction(fd);
    });
  };

  return (
    <div className="fp-card p-4">
      {sourceUrl ? (
        <a
          href={sourceUrl}
          target="_blank"
          rel="noreferrer"
          className="fp-h1-serif"
          style={{
            fontSize: "1.05rem",
            lineHeight: 1.3,
            display: "block",
            color: "inherit",
            textDecoration: "none",
          }}
        >
          {headline}
        </a>
      ) : (
        <div className="fp-h1-serif" style={{ fontSize: "1.05rem", lineHeight: 1.3 }}>
          {headline}
        </div>
      )}

      {cluster.matchedEntities.length + cluster.matchedKeywords.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-1" aria-label="Match reasons">
          {cluster.matchedEntities.map((e) => (
            <span
              key={`me:${e}`}
              className="text-[11px] px-2 py-0.5 rounded-full"
              style={{ background: "var(--emerald-tint)", color: "var(--fg)" }}
              title="Matched entity"
            >
              {e}
            </span>
          ))}
          {cluster.matchedKeywords.map((k) => (
            <span
              key={`mk:${k}`}
              className="text-[11px] px-2 py-0.5 rounded-full"
              style={{ background: "var(--rose-tint)", color: "var(--fg)" }}
              title="Matched keyword"
            >
              {k}
            </span>
          ))}
        </div>
      ) : null}

      {cluster.entities.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1">
          {cluster.entities
            .filter((e) => !cluster.matchedEntities.includes(e))
            .slice(0, 5)
            .map((e) => (
              <span
                key={e}
                className="text-[11px] px-2 py-0.5 rounded-full"
                style={{ background: "var(--bg-subtle)", color: "var(--fg-muted)" }}
              >
                {e}
              </span>
            ))}
        </div>
      ) : null}

      <div
        className="mt-3 text-xs tabular flex flex-wrap gap-3"
        style={{ color: "var(--fg-muted)" }}
      >
        <span>
          {cluster.sourceCount} {cluster.sourceCount === 1 ? "source" : "sources"}
        </span>
        <span>
          {cluster.domainCount} {cluster.domainCount === 1 ? "domain" : "domains"}
        </span>
        <span>{formatAge(cluster.latestPublishedAt)}</span>
        {cluster.composite !== null ? <span>composite {cluster.composite.toFixed(2)}</span> : null}
      </div>

      <form ref={formRef} action={generateDraftAction} className="mt-4">
        <button
          type="button"
          onClick={onDraft}
          disabled={isPending || !canDraft}
          className="fp-btn w-full"
          style={{
            background: canDraft ? "var(--indigo)" : "var(--bg-subtle)",
            color: canDraft ? "var(--bg)" : "var(--fg-muted)",
          }}
          aria-disabled={isPending || !canDraft}
        >
          {isPending ? "Taking notes" : canDraft ? "Take notes" : "Connect an outlet to take notes"}
        </button>
      </form>
    </div>
  );
}

interface Facets {
  entities: { label: string; count: number }[];
  domains: { label: string; count: number }[];
  trustBuckets: { high: number; med: number; low: number };
}

function buildFacets(results: TopicClusterResult[]): Facets {
  const entityCounts = new Map<string, number>();
  const domainCounts = new Map<string, number>();
  const trust = { high: 0, med: 0, low: 0 };
  for (const c of results) {
    for (const e of c.entities) entityCounts.set(e, (entityCounts.get(e) ?? 0) + 1);
    for (const d of c.domains) domainCounts.set(d, (domainCounts.get(d) ?? 0) + 1);
    const t = c.composite ?? c.trust ?? 0;
    if (t >= 0.66) trust.high += 1;
    else if (t >= 0.33) trust.med += 1;
    else trust.low += 1;
  }
  return {
    entities: rankFacet(entityCounts, 8),
    domains: rankFacet(domainCounts, 10),
    trustBuckets: trust,
  };
}

function rankFacet(map: Map<string, number>, limit: number): { label: string; count: number }[] {
  return Array.from(map.entries())
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, limit);
}

function FacetsSidebar({
  facets,
  entityFilters,
  domainFilters,
  onToggleEntity,
  onToggleDomain,
}: {
  facets: Facets;
  entityFilters: Set<string>;
  domainFilters: Set<string>;
  onToggleEntity: (e: string) => void;
  onToggleDomain: (d: string) => void;
}) {
  return (
    <aside className="space-y-5">
      <div>
        <div
          className="text-[10px] uppercase tracking-wider mb-2"
          style={{ color: "var(--fg-muted)" }}
        >
          Top entities
        </div>
        {facets.entities.length === 0 ? (
          <div className="text-xs" style={{ color: "var(--fg-subtle)" }}>
            None
          </div>
        ) : (
          <div className="flex flex-wrap gap-1">
            {facets.entities.map((e) => {
              const active = entityFilters.has(e.label);
              return (
                <button
                  key={e.label}
                  type="button"
                  onClick={() => onToggleEntity(e.label)}
                  className="text-[11px] px-2 py-1 rounded-full transition-colors"
                  style={{
                    background: active ? "var(--indigo)" : "var(--surface)",
                    color: active ? "var(--bg)" : "var(--fg)",
                    border: active ? "1px solid var(--indigo)" : "1px solid var(--border)",
                  }}
                  aria-pressed={active}
                >
                  {e.label}{" "}
                  <span
                    className="tabular"
                    style={{ color: active ? "var(--bg)" : "var(--fg-subtle)", opacity: 0.7 }}
                  >
                    {e.count}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div>
        <div
          className="text-[10px] uppercase tracking-wider mb-2"
          style={{ color: "var(--fg-muted)" }}
        >
          Domains
        </div>
        {facets.domains.length === 0 ? (
          <div className="text-xs" style={{ color: "var(--fg-subtle)" }}>
            None
          </div>
        ) : (
          <ul className="space-y-1 text-xs">
            {facets.domains.map((d) => {
              const active = domainFilters.has(d.label);
              return (
                <li key={d.label}>
                  <button
                    type="button"
                    onClick={() => onToggleDomain(d.label)}
                    className="flex justify-between w-full text-left rounded-md px-1.5 py-1 transition-colors"
                    style={{
                      background: active ? "var(--indigo)" : "transparent",
                      color: active ? "var(--bg)" : "var(--fg)",
                    }}
                    aria-pressed={active}
                  >
                    <span>{d.label}</span>
                    <span
                      className="tabular"
                      style={{ color: active ? "var(--bg)" : "var(--fg-subtle)" }}
                    >
                      {d.count}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div>
        <div
          className="text-[10px] uppercase tracking-wider mb-2"
          style={{ color: "var(--fg-muted)" }}
        >
          Trust distribution
        </div>
        <div className="text-xs tabular" style={{ color: "var(--fg-muted)" }}>
          high {facets.trustBuckets.high} · med {facets.trustBuckets.med} · low{" "}
          {facets.trustBuckets.low}
        </div>
      </div>
    </aside>
  );
}

function formatAge(ts: number): string {
  const ms = Date.now() - ts;
  if (ms < 60 * 60 * 1000) return `${Math.max(1, Math.round(ms / (60 * 1000)))}m`;
  if (ms < 24 * 60 * 60 * 1000) return `${Math.round(ms / (60 * 60 * 1000))}h`;
  return `${Math.round(ms / (24 * 60 * 60 * 1000))}d`;
}
