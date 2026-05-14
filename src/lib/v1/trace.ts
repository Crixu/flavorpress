/**
 * Trace ID + structured logger.
 *
 * Engineer review flagged observability as the missing piece. Every cluster
 * pipeline, every draft generation, every fact-check call gets a trace_id
 * that ties: cluster sources, ranker signals, voice-match score, prompt,
 * model response, post-edit version. Built week 1; retrofitting later is
 * harder than designing in.
 *
 * Usage:
 *   const traceId = newTraceId();
 *   const log = traceLogger(traceId, userId);
 *   log.info("cluster", "fired", { sourceCount: 4, fit: 0.84 });
 */

import { randomUUID } from "node:crypto";
import { db, ensureSchema } from "../db";
import type { TraceSpan } from "./types";

const TRACE_PREFIX = "tr_";

/**
 * Generate a trace ID. Format: tr_<32 hex chars> derived from crypto.randomUUID.
 * The tr_ prefix keeps log greps stable.
 */
export function newTraceId(): string {
  return TRACE_PREFIX + randomUUID().replace(/-/g, "");
}

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface TraceLogger {
  debug(span: string, message: string, data?: Record<string, unknown>): Promise<void>;
  info(span: string, message: string, data?: Record<string, unknown>): Promise<void>;
  warn(span: string, message: string, data?: Record<string, unknown>): Promise<void>;
  error(span: string, message: string, data?: Record<string, unknown>): Promise<void>;
}

export function traceLogger(traceId: string, userId: string | null = null): TraceLogger {
  const write = async (
    level: LogLevel,
    span: string,
    message: string,
    data?: Record<string, unknown>,
  ): Promise<void> => {
    await ensureSchema();
    await db.execute({
      sql: `INSERT INTO trace_log (trace_id, user_id, span, level, message, data, occurred_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [traceId, userId, span, level, message, data ? JSON.stringify(data) : null, Date.now()],
    });
    // Also mirror to stderr for live tailing during dev.
    if (process.env.NODE_ENV !== "production") {
      const tag = `[${traceId} ${span}]`;
      const payload = data ? ` ${JSON.stringify(data)}` : "";
      // eslint-disable-next-line no-console
      console[level === "debug" ? "log" : level](`${tag} ${message}${payload}`);
    }
  };

  return {
    debug: (span, message, data) => write("debug", span, message, data),
    info: (span, message, data) => write("info", span, message, data),
    warn: (span, message, data) => write("warn", span, message, data),
    error: (span, message, data) => write("error", span, message, data),
  };
}

function mapTraceRow(row: Record<string, unknown>): TraceSpan {
  return {
    id: Number(row.id),
    traceId: String(row.trace_id),
    userId: row.user_id ? String(row.user_id) : null,
    span: String(row.span),
    level: row.level as TraceSpan["level"],
    message: String(row.message),
    data: row.data ? JSON.parse(String(row.data)) : null,
    occurredAt: Number(row.occurred_at),
  };
}

/**
 * Pull the full trace for a draft by trace_id, scoped to the requesting user.
 * Rows with `user_id IS NULL` (system traces from cron) are not returned here;
 * use {@link getTraceForAdmin} for those.
 */
export async function getTrace(traceId: string, userId: string): Promise<TraceSpan[]> {
  await ensureSchema();
  const r = await db.execute({
    sql: `SELECT id, trace_id, user_id, span, level, message, data, occurred_at
          FROM trace_log
          WHERE trace_id = ?
            AND user_id = ?
          ORDER BY occurred_at ASC, id ASC`,
    args: [traceId, userId],
  });
  return r.rows.map((row) => mapTraceRow(row as Record<string, unknown>));
}

/**
 * Admin-only trace fetch. Returns all rows for the trace_id, including
 * system traces with `user_id IS NULL`. Callers must gate on admin auth.
 */
export async function getTraceForAdmin(traceId: string): Promise<TraceSpan[]> {
  await ensureSchema();
  const r = await db.execute({
    sql: `SELECT id, trace_id, user_id, span, level, message, data, occurred_at
          FROM trace_log
          WHERE trace_id = ?
          ORDER BY occurred_at ASC, id ASC`,
    args: [traceId],
  });
  return r.rows.map((row) => mapTraceRow(row as Record<string, unknown>));
}
