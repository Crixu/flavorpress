/**
 * Capability registry.
 *
 * Every internal feature (cluster engine, voice draft generator, fact-check,
 * originality, WordPress publish, source connectors) registers as a capability.
 * Future agents (research v1.1, scheduling v2, analytics v2, plagiarism v2+)
 * plug in by shipping a new manifest. The editor's agent slot, the MCP server,
 * and the event bus all consume capabilities through this registry.
 *
 * Architect review constraints applied:
 *   - Manifests hold N versions concurrently; clusters and drafts pin a
 *     capability_version so in-flight work is not broken by a v2 ship.
 *   - tier field gates registration by environment (FLAVORPRESS_TIER).
 *   - Registry interface is process-local in v1; when scale requires, the
 *     same interface backs a remote registry without callers changing.
 */

import { db, ensureSchema } from "../db";
import { getBus } from "./event-bus";
import type { CapabilityManifest, CapabilityTier, EventType, InvocationContext } from "./types";

const TIER = (process.env.FLAVORPRESS_TIER ?? "both") as CapabilityTier | "both";

export interface CapabilityRegistry {
  register<TInput, TOutput>(manifest: CapabilityManifest<TInput, TOutput>): Promise<void>;
  unregister(id: string, version: string): Promise<void>;
  get<TInput = unknown, TOutput = unknown>(
    id: string,
    version?: string,
  ): CapabilityManifest<TInput, TOutput> | undefined;
  list(): CapabilityManifest[];
  findByTag(tag: string): CapabilityManifest[];
  findBySubscription(eventType: EventType): CapabilityManifest[];
  invoke<TInput, TOutput>(
    id: string,
    version: string | undefined,
    input: TInput,
    ctx: Omit<InvocationContext, "registry" | "bus">,
  ): Promise<TOutput>;
}

class LocalCapabilityRegistry implements CapabilityRegistry {
  // key = `${id}@${version}`
  private manifests = new Map<string, CapabilityManifest>();

  async register<TInput, TOutput>(manifest: CapabilityManifest<TInput, TOutput>): Promise<void> {
    if (TIER !== "both" && manifest.tier !== "both" && manifest.tier !== TIER) {
      // Architect's call: tier is a build-time package boundary, not just a
      // runtime flag. We still enforce it in code so a misconfigured deploy
      // does not silently activate paid features.

      console.warn(
        `[registry] refusing to register ${manifest.id}@${manifest.version}: tier ${manifest.tier} not allowed in current tier ${TIER}`,
      );
      return;
    }
    const key = `${manifest.id}@${manifest.version}`;
    this.manifests.set(key, manifest as CapabilityManifest);

    // Persist manifest metadata (not the invoke function).
    await ensureSchema();
    await db.execute({
      sql: `INSERT OR REPLACE INTO capabilities
            (id, version, manifest, tier, registered_at, active)
            VALUES (?, ?, ?, ?, ?, 1)`,
      args: [
        manifest.id,
        manifest.version,
        JSON.stringify({
          id: manifest.id,
          version: manifest.version,
          description: manifest.description,
          inputSchema: manifest.inputSchema,
          outputSchema: manifest.outputSchema,
          latencyBudgetMs: manifest.latencyBudgetMs,
          tier: manifest.tier,
          requiresAuth: manifest.requiresAuth,
          subscribesTo: manifest.subscribesTo,
          emits: manifest.emits,
          costClass: manifest.costClass,
          tags: manifest.tags,
        }),
        manifest.tier,
        Date.now(),
      ],
    });

    // Wire up subscriptions on the bus. Handlers invoke the capability with
    // a freshly-built InvocationContext.
    const bus = getBus();
    for (const eventType of manifest.subscribesTo) {
      bus.subscribe(eventType, async (event) => {
        const ctx: InvocationContext = {
          userId: event.userId ?? "system",
          requestId: event.id,
          traceId: event.traceId ?? event.id,
          bus,
          registry: this,
        };
        try {
          await manifest.invoke(event.payload as TInput, ctx);
        } catch (err) {
          console.error(
            `[registry] capability ${manifest.id}@${manifest.version} failed on ${event.type}`,
            err,
          );
        }
      });
    }
  }

  async unregister(id: string, version: string): Promise<void> {
    this.manifests.delete(`${id}@${version}`);
    await ensureSchema();
    await db.execute({
      sql: `UPDATE capabilities SET active = 0 WHERE id = ? AND version = ?`,
      args: [id, version],
    });
  }

  get<TInput = unknown, TOutput = unknown>(
    id: string,
    version?: string,
  ): CapabilityManifest<TInput, TOutput> | undefined {
    if (version) {
      return this.manifests.get(`${id}@${version}`) as
        | CapabilityManifest<TInput, TOutput>
        | undefined;
    }
    // No version: return latest registered.
    let latest: CapabilityManifest | undefined;
    for (const [key, manifest] of this.manifests.entries()) {
      if (key.startsWith(`${id}@`)) {
        if (!latest || semverGreater(manifest.version, latest.version)) {
          latest = manifest;
        }
      }
    }
    return latest as CapabilityManifest<TInput, TOutput> | undefined;
  }

  list(): CapabilityManifest[] {
    return Array.from(this.manifests.values());
  }

  findByTag(tag: string): CapabilityManifest[] {
    return this.list().filter((m) => m.tags.includes(tag));
  }

  findBySubscription(eventType: EventType): CapabilityManifest[] {
    return this.list().filter((m) => m.subscribesTo.includes(eventType));
  }

  async invoke<TInput, TOutput>(
    id: string,
    version: string | undefined,
    input: TInput,
    ctx: Omit<InvocationContext, "registry" | "bus">,
  ): Promise<TOutput> {
    const manifest = this.get<TInput, TOutput>(id, version);
    if (!manifest) {
      throw new Error(`Capability not found: ${id}${version ? `@${version}` : ""}`);
    }
    const fullCtx: InvocationContext = {
      ...ctx,
      bus: getBus(),
      registry: this,
    };
    return manifest.invoke(input, fullCtx);
  }
}

function semverGreater(a: string, b: string): boolean {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const ai = pa[i] ?? 0;
    const bi = pb[i] ?? 0;
    if (ai > bi) return true;
    if (ai < bi) return false;
  }
  return false;
}

let _registry: CapabilityRegistry | null = null;
export function getRegistry(): CapabilityRegistry {
  if (_registry) return _registry;
  _registry = new LocalCapabilityRegistry();
  return _registry;
}
