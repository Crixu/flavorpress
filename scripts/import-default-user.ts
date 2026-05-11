#!/usr/bin/env -S npx tsx --conditions=react-server
/**
 * Import all `default-user` data from another FlavorPress sqlite DB into
 * this DB, re-keyed to a real user account.
 *
 * One-shot: only intended for the migration from the legacy single-user
 * Studio DB into a fresh multi-user setup.
 *
 * Usage:
 *   npx tsx --conditions=react-server scripts/import-default-user.ts \
 *     --from /path/to/source/.data/flavorpress.db \
 *     --email lucas.radke@a8c.com
 *
 * Skips event_log, trace_log, wp_authorize_states, job_progress,
 * app_settings, and capabilities. See comments below for rationale.
 */

import { createClient, type Client, type InValue } from "@libsql/client";
import path from "node:path";
import fs from "node:fs";
import { ensureSchema, db as dst } from "@/lib/db";
import { getUserByEmail } from "@/lib/users";

interface Args {
  from: string;
  email: string;
}

function parseArgs(argv: string[]): Args {
  const fromIdx = argv.indexOf("--from");
  const emailIdx = argv.indexOf("--email");
  const from = fromIdx !== -1 ? argv[fromIdx + 1] : null;
  const email = emailIdx !== -1 ? argv[emailIdx + 1] : null;
  if (!from || !email) {
    throw new Error("Usage: scripts/import-default-user.ts --from <path-to-db> --email <addr>");
  }
  if (!fs.existsSync(from)) {
    throw new Error(`Source DB not found: ${from}`);
  }
  return { from: path.resolve(from), email };
}

interface CopyPlanItem {
  table: string;
  hasUserId: boolean;
  conflict: "ignore" | "replace";
}

const COPY_PLAN: CopyPlanItem[] = [
  // Tenancy tables — re-key user_id from default-user → real user.
  { table: "outlets", hasUserId: true, conflict: "ignore" },
  { table: "source_folders", hasUserId: true, conflict: "ignore" },
  { table: "sources", hasUserId: true, conflict: "ignore" },
  { table: "items", hasUserId: true, conflict: "ignore" },
  { table: "clusters", hasUserId: true, conflict: "ignore" },
  { table: "drafts", hasUserId: true, conflict: "ignore" },
  { table: "voice_profiles", hasUserId: true, conflict: "ignore" },
  { table: "ranker_signals", hasUserId: true, conflict: "ignore" },
  { table: "ranker_corrections", hasUserId: true, conflict: "ignore" },

  // Joined tables — no user_id; identity follows from FK to outlets/items.
  { table: "outlet_sources", hasUserId: false, conflict: "ignore" },

  // Caches — global by content_hash; copy wholesale to avoid re-paying LLM cost.
  { table: "embedding_cache", hasUserId: false, conflict: "ignore" },
  { table: "entity_cache", hasUserId: false, conflict: "ignore" },
  { table: "merge_oracle_cache", hasUserId: false, conflict: "ignore" },
];

// Tables we deliberately do NOT copy:
//   event_log, trace_log         observability noise; tens of thousands of rows
//   wp_authorize_states          transient OAuth state, expires fast
//   job_progress                 transient
//   app_settings                 global; do not overwrite local config (e.g. API keys)
//   capabilities                 system-level; ensureRegisteredCapabilities re-seeds
//   item_tags                    not present in current schema as of this writing
//   fact_check_*, originality_*, related_image_*, comment_courtroom_*
//                                extension data; bring on a follow-up if needed

async function listColumns(client: Client, table: string): Promise<string[]> {
  const r = await client.execute(`PRAGMA table_info(${table})`);
  return r.rows.map((row) => String(row.name));
}

async function tableExists(client: Client, table: string): Promise<boolean> {
  const r = await client.execute({
    sql: "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
    args: [table],
  });
  return r.rows.length > 0;
}

async function copyTable(
  src: Client,
  table: string,
  hasUserId: boolean,
  srcUserId: string,
  dstUserId: string,
  conflict: "ignore" | "replace",
): Promise<{ scanned: number; inserted: number }> {
  if (!(await tableExists(src, table))) return { scanned: 0, inserted: 0 };
  if (!(await tableExists(dst, table))) return { scanned: 0, inserted: 0 };

  const srcCols = await listColumns(src, table);
  const dstCols = await listColumns(dst, table);
  const cols = srcCols.filter((c) => dstCols.includes(c));
  if (cols.length === 0) return { scanned: 0, inserted: 0 };

  const where = hasUserId ? "WHERE user_id = ?" : "";
  const args: InValue[] = hasUserId ? [srcUserId] : [];
  const r = await src.execute({
    sql: `SELECT ${cols.join(", ")} FROM ${table} ${where}`,
    args,
  });

  if (r.rows.length === 0) return { scanned: 0, inserted: 0 };

  const verb = conflict === "replace" ? "INSERT OR REPLACE" : "INSERT OR IGNORE";
  const placeholders = cols.map(() => "?").join(", ");
  const insertSql = `${verb} INTO ${table} (${cols.join(", ")}) VALUES (${placeholders})`;

  const stmts = r.rows.map((row) => {
    const values: InValue[] = cols.map((c) => {
      const v = row[c as keyof typeof row];
      if (hasUserId && c === "user_id" && v === srcUserId) return dstUserId;
      return v as InValue;
    });
    return { sql: insertSql, args: values };
  });

  // Batch in chunks so libsql doesn't choke on 12k-row arrays.
  const CHUNK = 500;
  let inserted = 0;
  for (let i = 0; i < stmts.length; i += CHUNK) {
    const slice = stmts.slice(i, i + CHUNK);
    await dst.batch(slice);
    inserted += slice.length;
  }
  return { scanned: r.rows.length, inserted };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);

  await ensureSchema();
  const user = await getUserByEmail(args.email);
  if (!user) throw new Error(`No user with email ${args.email}. Sign up first.`);

  const src = createClient({ url: `file:${args.from}` });

  // Verify the source has a default-user row.
  const probe = await src.execute("SELECT id, email FROM users WHERE id = 'default-user'");
  if (probe.rows.length === 0) {
    throw new Error("Source DB has no default-user row. Nothing to import.");
  }

  process.stdout.write(`Source: ${args.from}\n`);
  process.stdout.write(`Target user: ${user.id} (${user.email})\n\n`);

  for (const item of COPY_PLAN) {
    const result = await copyTable(
      src,
      item.table,
      item.hasUserId,
      "default-user",
      user.id,
      item.conflict,
    );
    process.stdout.write(
      `${item.table.padEnd(20)} scanned=${String(result.scanned).padStart(6)} inserted=${String(result.inserted).padStart(6)}\n`,
    );
  }

  process.stdout.write("\nImport complete.\n");
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
  process.exitCode = 1;
});
