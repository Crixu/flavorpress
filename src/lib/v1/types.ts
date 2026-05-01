/**
 * FlavorPress v1 — shared types.
 *
 * The canonical contract for the niche-blogger architecture. Read alongside
 * `01 - Projects/A8C/_active/flavor/architecture-v1.md` and the build-kickoff
 * doc. Keep this file synced with the libSQL schema in `src/lib/db.ts`.
 */

export type SourceKind = "rss" | "reddit" | "podcast" | "youtube" | "newsletter"; // newsletter ingest deferred to v1.1; type kept for forward compat

export type ClusterState = "forming" | "fired" | "drafted" | "published" | "dismissed";

export type DraftState = "pre-rendered" | "shown" | "edited" | "published" | "discarded";

export interface User {
  id: string;
  email: string;
  wpSiteUrl: string | null;
  wpAppPasswordEncrypted: Uint8Array | null;
  wpSiteKind: "wp-org" | "wp-com" | "jetpack-managed" | "multisite" | null;
  nicheLabel: string | null;
  createdAt: number;
  lastActiveAt: number | null;
}

export interface Source {
  id: string;
  userId: string;
  kind: SourceKind;
  url: string;
  displayName: string | null;
  trustScore: number;
  pollIntervalSeconds: number;
  lastPolledAt: number | null;
  lastError: string | null;
  lastEtag: string | null;
  lastModified: string | null;
  backoffUntil: number | null;
  active: boolean;
  createdAt: number;
}

/**
 * An ingested unit of content. The (canonical_url, user_id) tuple is unique.
 */
export interface Item {
  id: string;
  sourceId: string;
  userId: string;
  canonicalUrl: string;
  contentHash: string;
  doi: string | null;
  title: string;
  lede: string;
  body: string | null;
  authors: string[] | null;
  publishedAt: number;
  fetchedAt: number;
  entities: string[] | null;
  clusterId: string | null;
}

export interface Cluster {
  id: string;
  userId: string;
  centroid: Float32Array | null;
  embeddingModel: string | null;
  embeddingVersion: string | null;
  primaryEntities: string[] | null;
  formedAt: number;
  firedAt: number | null;
  sourceCount: number;
  rankerScore: number | null;
  capabilityVersionPin: string | null;
  state: ClusterState;
}

export interface Draft {
  id: string;
  clusterId: string;
  userId: string;
  capabilityVersionPin: string;
  headline: string;
  headlineAlternates: string[];
  body: string;
  quotes: Quote[];
  voiceMatchScore: number;
  angleArchive: string | null;
  angleGap: string | null;
  factCheckResultId: string | null;
  originalityResultId: string | null;
  traceId: string;
  createdAt: number;
  editedAt: number | null;
  editDistanceFromOriginal: number | null;
  state: DraftState;
}

export interface Quote {
  sourceId: string;
  text: string;
  citation: string;
}

export interface VoiceProfile {
  userId: string;
  styleSheetYaml: string;
  archiveIndexSize: number;
  functionWordDistribution: Float32Array | null;
  sentenceLengthMean: number;
  sentenceLengthVariance: number;
  hedgeFrequency: number;
  emDashDensity: number;
  quoteDensity: number;
  bannedTerms: string[];
  signatureTerms: string[];
  anchoredPostIds: string[];
  description: string | null;
  lastRebuiltAt: number;
}

export interface RankerSignals {
  clusterId: string;
  userId: string;
  archiveOverlap: number; // 0..1; weight 0.55 in v1 (3-signal)
  beatMatch: number; // 0..1; weight 0.30 in v1
  sourceTrust: number; // 0..1; weight 0.15 in v1
  composite: number;
  computedAt: number;
}

/**
 * Per-cluster signal correction. When the user down-weights a signal for a
 * cluster, future clusters with overlapping entity-set fingerprints inherit it.
 */
export interface RankerCorrection {
  userId: string;
  clusterPattern: string;
  weightDelta: number;
  signalId: string | null;
  reason: string | null;
  createdAt: number;
}

/**
 * v1 ranker is 3-signal per engineer review (was 5). Voice fit + gap fill
 * arrive in v1.1 once we have data to tune them.
 */
export const RANKER_WEIGHTS = {
  archiveOverlap: 0.55,
  beatMatch: 0.3,
  sourceTrust: 0.15,
} as const;

// ===== Events =====

export type EventType =
  | "item.ingested"
  | "cluster.formed"
  | "cluster.threshold_crossed"
  | "draft.rendered"
  | "draft.fact_checked"
  | "draft.originality_scored"
  | "draft.edited"
  | "post.published"
  | "signal.downweighted"
  | "source.poll_due";

export interface Event<T = unknown> {
  id: string;
  type: EventType;
  userId: string | null;
  payload: T;
  occurredAt: number;
  idempotencyKey: string;
  capabilityId: string | null;
  capabilityVersion: string | null;
  traceId: string | null;
}

// Concrete payload shapes for type-safety at the bus interface.

export interface ItemIngestedPayload {
  itemId: string;
  sourceId: string;
  canonicalUrl: string;
  contentHash: string;
}

export interface ClusterThresholdCrossedPayload {
  clusterId: string;
  sourceCount: number;
  primaryEntities: string[];
}

export interface DraftRenderedPayload {
  draftId: string;
  clusterId: string;
  voiceMatchScore: number;
  cached: boolean;
}

export interface PostPublishedPayload {
  draftId: string;
  wpPostId: number;
  url: string;
}

export interface SignalDownweightedPayload {
  clusterId: string;
  signalId: string;
  weightDelta: number;
}

// ===== Capability registry =====

export type CapabilityTier = "oss" | "saas" | "both";

export type CapabilityCostClass = "cheap" | "medium" | "expensive";

/**
 * Typed manifest for every capability that registers with the system.
 * New capabilities (research agent v1.1, scheduling v2, etc.) plug in as
 * new manifests; the editor's agent slot, the MCP server, and the event
 * bus all consume capabilities through this contract.
 */
export interface CapabilityManifest<TInput = unknown, TOutput = unknown> {
  id: string;
  version: string;
  description: string;
  inputSchema: unknown; // JSON Schema or zod schema; runtime validated
  outputSchema: unknown;
  latencyBudgetMs: number;
  tier: CapabilityTier;
  requiresAuth: boolean;
  subscribesTo: EventType[];
  emits: EventType[];
  costClass: CapabilityCostClass;
  tags: string[]; // e.g. ["agent.editor", "agent.background"]
  invoke: (input: TInput, ctx: InvocationContext) => Promise<TOutput>;
}

export interface InvocationContext {
  userId: string;
  requestId: string;
  traceId: string;
  bus: import("./event-bus").EventBus;
  registry: import("./capability-registry").CapabilityRegistry;
}

// ===== Trace =====

export interface TraceSpan {
  id: number;
  traceId: string;
  userId: string | null;
  span: string;
  level: "debug" | "info" | "warn" | "error";
  message: string;
  data: Record<string, unknown> | null;
  occurredAt: number;
}
