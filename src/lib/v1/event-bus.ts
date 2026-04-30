/**
 * Event bus.
 *
 * Architect review: the in-memory EventEmitter inside a Vercel function
 * instance breaks at user count = 2 because Vercel functions are stateless
 * and ephemeral. Redis pub/sub is primary from day one. The in-memory layer
 * is request-scoped only, used for synchronous within-request fanout.
 *
 * v1 implementation:
 *   - All events persist to event_log table BEFORE fanout.
 *   - For the local dev / OSS path, the in-memory bus runs handlers directly.
 *   - For SaaS hosted, set REDIS_URL; the bus publishes via Redis pub/sub
 *     and the same Next.js server subscribes from any function instance.
 *
 * Idempotency: every event carries an idempotency_key. Handlers must be
 * idempotent (DB unique constraints on result tables enforce this).
 */

import { db, ensureSchema } from "../db";
import type { Event, EventType } from "./types";
import { newTraceId } from "./trace";

export type EventHandler<T = unknown> = (event: Event<T>) => Promise<void> | void;

export interface EventBus {
  emit<T = unknown>(
    type: EventType,
    payload: T,
    opts?: EmitOptions,
  ): Promise<Event<T>>;
  subscribe<T = unknown>(type: EventType, handler: EventHandler<T>): Unsubscribe;
  // Replay events from the persisted log for a given trace_id or user_id.
  replay(opts: { traceId?: string; userId?: string; sinceMs?: number }): Promise<Event[]>;
}

export interface EmitOptions {
  userId?: string | null;
  capabilityId?: string | null;
  capabilityVersion?: string | null;
  traceId?: string | null;
  idempotencyKey?: string;
}

export type Unsubscribe = () => void;

/**
 * In-memory bus. Persists every event to event_log before fanout. Used for
 * local dev and OSS self-host. SaaS path will wrap this with Redis pub/sub
 * (see RedisEventBus, todo for v1.1).
 */
class LocalEventBus implements EventBus {
  private handlers = new Map<EventType, Set<EventHandler>>();

  async emit<T = unknown>(
    type: EventType,
    payload: T,
    opts: EmitOptions = {},
  ): Promise<Event<T>> {
    await ensureSchema();
    const event: Event<T> = {
      id: crypto.randomUUID(),
      type,
      userId: opts.userId ?? null,
      payload,
      occurredAt: Date.now(),
      idempotencyKey:
        opts.idempotencyKey ??
        // Default: hash of (type + payload). Handlers must enforce idempotency
        // via DB unique constraints; this default is a reasonable fingerprint.
        `${type}:${hashJson(payload)}`,
      capabilityId: opts.capabilityId ?? null,
      capabilityVersion: opts.capabilityVersion ?? null,
      traceId: opts.traceId ?? null,
    };

    // Persist before fanout.
    await db.execute({
      sql: `INSERT INTO event_log
            (id, user_id, type, payload, idempotency_key, capability_id, capability_version, trace_id, occurred_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        event.id,
        event.userId,
        event.type,
        JSON.stringify(payload),
        event.idempotencyKey,
        event.capabilityId,
        event.capabilityVersion,
        event.traceId,
        event.occurredAt,
      ],
    });

    // Fan out. Errors in one handler must not block others.
    const subs = this.handlers.get(type);
    if (subs) {
      await Promise.all(
        Array.from(subs).map(async (handler) => {
          try {
            await handler(event);
          } catch (err) {
            // eslint-disable-next-line no-console
            console.error(`[event-bus] handler failed for ${type}`, err);
          }
        }),
      );
    }
    return event;
  }

  subscribe<T = unknown>(type: EventType, handler: EventHandler<T>): Unsubscribe {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type)!.add(handler as EventHandler);
    return () => {
      this.handlers.get(type)?.delete(handler as EventHandler);
    };
  }

  async replay(opts: {
    traceId?: string;
    userId?: string;
    sinceMs?: number;
  }): Promise<Event[]> {
    await ensureSchema();
    const wheres: string[] = [];
    const args: (string | number)[] = [];
    if (opts.traceId) {
      wheres.push("trace_id = ?");
      args.push(opts.traceId);
    }
    if (opts.userId) {
      wheres.push("user_id = ?");
      args.push(opts.userId);
    }
    if (opts.sinceMs !== undefined) {
      wheres.push("occurred_at >= ?");
      args.push(opts.sinceMs);
    }
    const whereSql = wheres.length ? `WHERE ${wheres.join(" AND ")}` : "";
    const r = await db.execute({
      sql: `SELECT * FROM event_log ${whereSql} ORDER BY occurred_at ASC, id ASC`,
      args,
    });
    return r.rows.map((row) => ({
      id: String(row.id),
      type: String(row.type) as EventType,
      userId: row.user_id ? String(row.user_id) : null,
      payload: JSON.parse(String(row.payload)),
      occurredAt: Number(row.occurred_at),
      idempotencyKey: String(row.idempotency_key),
      capabilityId: row.capability_id ? String(row.capability_id) : null,
      capabilityVersion: row.capability_version ? String(row.capability_version) : null,
      traceId: row.trace_id ? String(row.trace_id) : null,
    }));
  }
}

function hashJson(value: unknown): string {
  // FNV-1a 64-bit-ish over JSON. Fast, non-crypto, sufficient for an
  // idempotency-key fallback.
  const s = JSON.stringify(value);
  let h = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  for (let i = 0; i < s.length; i++) {
    h ^= BigInt(s.charCodeAt(i));
    h = (h * prime) & 0xffffffffffffffffn;
  }
  return h.toString(16);
}

let _bus: EventBus | null = null;

/**
 * Singleton bus. v1.1: detect REDIS_URL and return RedisEventBus instead.
 * The interface stays the same so capabilities written today work then.
 */
export function getBus(): EventBus {
  if (_bus) return _bus;
  // TODO v1.1: if (process.env.REDIS_URL) _bus = new RedisEventBus(...);
  _bus = new LocalEventBus();
  return _bus;
}

/**
 * Helper for within-request fanout that does NOT cross instance boundaries.
 * Use this when publisher and subscriber are guaranteed to be in the same
 * function call stack. For anything cross-capability, use the global bus.
 */
export function inRequestFanout(): EventBus {
  return new LocalEventBus();
}

/**
 * Convenience for capabilities that need to emit + trace in one call.
 */
export async function emitWithTrace<T>(
  type: EventType,
  payload: T,
  opts: EmitOptions = {},
): Promise<Event<T>> {
  const traceId = opts.traceId ?? newTraceId();
  return getBus().emit(type, payload, { ...opts, traceId });
}
