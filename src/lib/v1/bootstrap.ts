/**
 * Bootstrap: register v1 capabilities at module load.
 *
 * Capabilities listed here are the v1 set per architecture-v1.md §5:
 *   - cluster-engine
 *   - voice-draft-generator (skeleton; streaming impl ships in next pass)
 *   - fact-check (skeleton)
 *   - originality-check (skeleton)
 *   - wordpress-publish (uses existing src/lib/wordpress.ts)
 *   - source-connector.rss
 *
 * Each capability subscribes to its declared events at registration time.
 * This module is idempotent; safe to call from any entrypoint.
 */

import { z } from "zod";
import { getRegistry } from "./capability-registry";
import { handleItemIngested, getClusterItems } from "./cluster-engine";
import { rankCluster } from "./ranker";
import { fingerprintText, voiceMatchScore } from "./style-sheet";
import { redditConnector } from "./connectors/reddit";
import { rssConnectorExpanded } from "./connectors/rss";
import { runConnector } from "./source-connector";
import { db, ensureSchema } from "../db";
import type { Source } from "./types";

let registered = false;

export async function ensureRegisteredCapabilities(): Promise<void> {
  if (registered) return;
  registered = true;
  await ensureSchema();
  const registry = getRegistry();

  // ----- cluster-engine -----
  await registry.register({
    id: "cluster-engine",
    version: "1.0.0",
    description:
      "Three-layer cluster pipeline. Joins ingested items into clusters by canonical URL, entity overlap, or embedding similarity. Fires cluster.threshold_crossed when a cluster gains 3+ sources from 2+ domains within 72h.",
    inputSchema: z.object({
      itemId: z.string(),
      sourceId: z.string(),
      canonicalUrl: z.string(),
      contentHash: z.string(),
    }),
    outputSchema: z.object({
      clusterId: z.string().nullable(),
      layer: z.union([z.literal(1), z.literal(2), z.literal(3), z.null()]),
    }),
    latencyBudgetMs: 2000,
    tier: "both",
    requiresAuth: false,
    subscribesTo: ["item.ingested"],
    emits: ["cluster.formed", "cluster.threshold_crossed"],
    costClass: "medium",
    tags: ["pipeline.ingest"],
    invoke: async (input, ctx) => {
      const result = await handleItemIngested(input as Parameters<typeof handleItemIngested>[0], {
        traceId: ctx.traceId,
        userId: ctx.userId,
      });
      return result;
    },
  });

  // ----- voice-draft-generator (skeleton; streaming impl in next pass) -----
  await registry.register({
    id: "voice-draft-generator",
    version: "1.0.0",
    description:
      "Generates a voice-matched 600-word draft from a fired cluster. Streams output and runs Burrows' Delta on the first 200 words; cancels and restarts at ~2s if voice-match drops below 0.5. Accepts cluster ID, returns draft + voice-match score + 3-quote bundle.",
    inputSchema: z.object({
      clusterId: z.string(),
      angleHint: z.string().optional(),
    }),
    outputSchema: z.object({
      draftId: z.string(),
      headline: z.string(),
      voiceMatchScore: z.number(),
    }),
    latencyBudgetMs: 8000,
    tier: "both",
    requiresAuth: true,
    subscribesTo: ["cluster.threshold_crossed"],
    emits: ["draft.rendered"],
    costClass: "expensive",
    tags: ["pipeline.draft", "agent.editor"],
    invoke: async (input) => {
      // v1.0.0 skeleton: ranks the cluster, returns a placeholder. The real
      // streaming Anthropic call lives in src/lib/v1/draft-generator.ts in
      // the next pass; this lets the registry and event flow ship today.
      const { clusterId } = input as { clusterId: string };
      const items = await getClusterItems(clusterId);
      const sample = items
        .map((i) => i.title)
        .join(" / ")
        .slice(0, 120);
      const generated =
        sample || "FlavorPress draft skeleton. Replace with streaming Anthropic call.";
      const score = voiceMatchScore(fingerprintText(generated), fingerprintText(generated));
      return {
        draftId: `draft_skeleton_${clusterId}`,
        headline: sample.slice(0, 80) || "Untitled draft",
        voiceMatchScore: score,
      };
    },
  });

  // ----- fact-check (editor extension) -----
  // Implementation lives in src/extensions/fact-check/server.ts; the
  // capability registration here is for MCP / external agents that
  // want to invoke the same engine. The editor UI calls the server
  // action directly rather than going through the registry, since the
  // action also handles client-state plumbing.
  //
  // 2.0.0: web-search-grounded run. The 1.0.0 skeleton returned
  // `{passed, flaggedClaimIds}` from a no-op invoke; this version
  // returns `{ranAt, claims[]}`. The output schema is incompatible,
  // so the version is bumped (semver major) instead of overloading
  // the same id@1.0.0 with a new contract. No internal caller pins
  // 1.0.0; external callers reading from the capabilities table will
  // see the new manifest.
  await registry.register({
    id: "fact-check",
    version: "2.0.0",
    description:
      "Web-search-grounded fact-check over a draft body. Identifies up to 6 verbatim claims, returns per-claim verdict (supported/disputed/unverified), comment, and source URL.",
    inputSchema: z.object({ draftId: z.string() }),
    outputSchema: z.object({
      ranAt: z.number(),
      claims: z.array(
        z.object({
          id: z.string(),
          claimIndex: z.number(),
          claimText: z.string(),
          verdict: z.enum(["supported", "disputed", "unverified"]),
          comment: z.string(),
          sourceUrl: z.string().nullable(),
          sourceTitle: z.string().nullable(),
        }),
      ),
    }),
    latencyBudgetMs: 60000,
    tier: "both",
    requiresAuth: true,
    subscribesTo: [], // user-triggered from the editor extension
    emits: ["draft.fact_checked"],
    costClass: "expensive",
    tags: ["editor.extension", "pipeline.qa"],
    invoke: async (input) => {
      const { runFactCheck } = await import("../../extensions/fact-check/server");
      const { draftId } = input as { draftId: string };
      const result = await runFactCheck(draftId);
      return {
        ranAt: result.ranAt,
        claims: result.claims.map((c) => ({
          id: c.id,
          claimIndex: c.claimIndex,
          claimText: c.claimText,
          verdict: c.verdict,
          comment: c.comment,
          sourceUrl: c.sourceUrl,
          sourceTitle: c.sourceTitle,
        })),
      };
    },
  });

  // ----- originality-check -----
  await registry.register({
    id: "originality-check",
    version: "1.0.0",
    description:
      "Character n-gram (n=8) overlap check between draft body and cluster sources. Score 0..1; flagged spans rendered inline.",
    inputSchema: z.object({ draftId: z.string() }),
    outputSchema: z.object({
      score: z.number(),
      flaggedSpans: z.array(z.object({ start: z.number(), end: z.number() })),
    }),
    latencyBudgetMs: 1000,
    tier: "both",
    requiresAuth: false,
    subscribesTo: ["draft.rendered"],
    emits: ["draft.originality_scored"],
    costClass: "cheap",
    tags: ["pipeline.qa"],
    invoke: async () => {
      // v1.0.0 skeleton: returns 1.0. Real impl runs n-gram overlap.
      return { score: 1.0, flaggedSpans: [] };
    },
  });

  // ----- wordpress-publish (skeleton; reuses existing wordpress.ts) -----
  await registry.register({
    id: "wordpress-publish",
    version: "1.0.0",
    description:
      "Publishes a draft to a connected WordPress site via Application Password. Defaults to status=draft. Detects Jetpack-managed sites and routes accordingly.",
    inputSchema: z.object({
      draftId: z.string(),
      status: z.enum(["draft", "publish", "future"]).default("draft"),
      scheduleAt: z.number().optional(),
    }),
    outputSchema: z.object({
      wpPostId: z.number(),
      url: z.string(),
    }),
    latencyBudgetMs: 3000,
    tier: "both",
    requiresAuth: true,
    subscribesTo: [], // user-triggered only
    emits: ["post.published"],
    costClass: "cheap",
    tags: ["pipeline.publish"],
    invoke: async () => {
      // v1.0.0 skeleton; the existing src/lib/wordpress.ts already implements
      // Bridging to the drafts table is the next pass.
      throw new Error("wordpress-publish: bridge to v1 drafts pending");
    },
  });

  // ----- source-connector.rss -----
  await registry.register({
    id: "source-connector.rss",
    version: "1.0.0",
    description:
      "Polls an RSS or Atom feed, parses items, dedupes, and emits item.ingested for each new item. Tolerant to malformed XML and supports both RSS 2.0 and Atom.",
    inputSchema: z.object({ sourceId: z.string() }),
    outputSchema: z.object({ ingested: z.number(), traceId: z.string() }),
    latencyBudgetMs: 5000,
    tier: "both",
    requiresAuth: false,
    subscribesTo: ["source.poll_due"],
    emits: ["item.ingested"],
    costClass: "cheap",
    tags: ["pipeline.ingest", "connector.rss"],
    invoke: async (input) => {
      const { sourceId } = input as { sourceId: string };
      const r = await db.execute({
        sql: `SELECT * FROM sources WHERE id = ?`,
        args: [sourceId],
      });
      if (r.rows.length === 0) throw new Error(`source not found: ${sourceId}`);
      const row = r.rows[0]!;
      const source: Source = {
        id: String(row.id),
        userId: String(row.user_id),
        kind: row.kind as Source["kind"],
        url: String(row.url),
        displayName: row.display_name ? String(row.display_name) : null,
        trustScore: Number(row.trust_score ?? 0.5),
        pollIntervalSeconds: Number(row.poll_interval_seconds ?? 300),
        lastPolledAt: row.last_polled_at ? Number(row.last_polled_at) : null,
        lastError: row.last_error ? String(row.last_error) : null,
        lastEtag: row.last_etag ? String(row.last_etag) : null,
        lastModified: row.last_modified ? String(row.last_modified) : null,
        backoffUntil: row.backoff_until ? Number(row.backoff_until) : null,
        active: Number(row.active ?? 1) === 1,
        createdAt: Number(row.created_at ?? Date.now()),
      };
      return runConnector(rssConnectorExpanded, source);
    },
  });

  // ----- source-connector.reddit -----
  await registry.register({
    id: "source-connector.reddit",
    version: "1.0.0",
    description:
      "Polls a subreddit's JSON listing endpoint and emits item.ingested for each new post. Captures score and num_comments alongside the standard item fields so the reader can show engagement signal at swipe time.",
    inputSchema: z.object({ sourceId: z.string() }),
    outputSchema: z.object({ ingested: z.number(), traceId: z.string() }),
    latencyBudgetMs: 8000,
    tier: "both",
    requiresAuth: false,
    subscribesTo: ["source.poll_due"],
    emits: ["item.ingested"],
    costClass: "cheap",
    tags: ["pipeline.ingest", "connector.reddit"],
    invoke: async (input) => {
      const { sourceId } = input as { sourceId: string };
      const r = await db.execute({
        sql: `SELECT * FROM sources WHERE id = ?`,
        args: [sourceId],
      });
      if (r.rows.length === 0) throw new Error(`source not found: ${sourceId}`);
      const row = r.rows[0]!;
      const source: Source = {
        id: String(row.id),
        userId: String(row.user_id),
        kind: row.kind as Source["kind"],
        url: String(row.url),
        displayName: row.display_name ? String(row.display_name) : null,
        trustScore: Number(row.trust_score ?? 0.5),
        pollIntervalSeconds: Number(row.poll_interval_seconds ?? 300),
        lastPolledAt: row.last_polled_at ? Number(row.last_polled_at) : null,
        lastError: row.last_error ? String(row.last_error) : null,
        lastEtag: row.last_etag ? String(row.last_etag) : null,
        lastModified: row.last_modified ? String(row.last_modified) : null,
        backoffUntil: row.backoff_until ? Number(row.backoff_until) : null,
        active: Number(row.active ?? 1) === 1,
        createdAt: Number(row.created_at ?? Date.now()),
      };
      return runConnector(redditConnector, source);
    },
  });

  // ranker is invoked synchronously by the editor / today page; not a
  // capability that subscribes to events. Exporting it as a named tool so
  // the MCP surface can call it from external agents.
  await registry.register({
    id: "personal-ranker",
    version: "1.0.0",
    description:
      "Computes the 3-signal personal ranker for a cluster (archive overlap 55%, beat match 30%, source trust 15%). Persists ranker_signals row and returns the composite score.",
    inputSchema: z.object({ clusterId: z.string(), userId: z.string() }),
    outputSchema: z.object({
      composite: z.number(),
      archiveOverlap: z.number(),
      beatMatch: z.number(),
      sourceTrust: z.number(),
    }),
    latencyBudgetMs: 500,
    tier: "both",
    requiresAuth: false,
    subscribesTo: [],
    emits: [],
    costClass: "cheap",
    tags: ["pipeline.rank"],
    invoke: async (input) => {
      const { clusterId, userId } = input as {
        clusterId: string;
        userId: string;
      };
      const r = await db.execute({
        sql: `SELECT * FROM clusters WHERE id = ?`,
        args: [clusterId],
      });
      if (r.rows.length === 0) throw new Error(`cluster not found: ${clusterId}`);
      const row = r.rows[0]!;
      const signals = await rankCluster(
        {
          id: String(row.id),
          userId: String(row.user_id),
          centroid: null,
          embeddingModel: null,
          embeddingVersion: null,
          primaryEntities: row.primary_entities ? JSON.parse(String(row.primary_entities)) : null,
          formedAt: Number(row.formed_at),
          firedAt: row.fired_at ? Number(row.fired_at) : null,
          sourceCount: Number(row.source_count),
          rankerScore: row.ranker_score ? Number(row.ranker_score) : null,
          capabilityVersionPin: row.capability_version_pin
            ? String(row.capability_version_pin)
            : null,
          state: String(row.state) as "forming" | "fired" | "drafted" | "published" | "dismissed",
        },
        userId,
      );
      return {
        composite: signals.composite,
        archiveOverlap: signals.archiveOverlap,
        beatMatch: signals.beatMatch,
        sourceTrust: signals.sourceTrust,
      };
    },
  });
}
