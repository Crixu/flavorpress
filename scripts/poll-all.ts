/**
 * Poll all user sources right now and report what happened.
 *
 * Safe to run on a live database. Does not delete anything; only invokes
 * the source-connector.rss capability for each source row.
 *
 * Usage:
 *   npx tsx scripts/poll-all.ts                 # legacy default-user
 *   npx tsx scripts/poll-all.ts --email <addr>  # a real account
 */

import { db, ensureSchema } from "../src/lib/db";
import { ensureRegisteredCapabilities } from "../src/lib/v1/bootstrap";
import { getRegistry } from "../src/lib/v1/capability-registry";
import { getUserByEmail } from "../src/lib/users";

async function resolveUserId(argv: string[]): Promise<string> {
  const i = argv.indexOf("--email");
  if (i !== -1) {
    const email = argv[i + 1];
    if (!email) throw new Error("--email requires a value");
    const user = await getUserByEmail(email);
    if (!user) throw new Error(`No user with email ${email}`);
    return user.id;
  }
  const r = await db.execute("SELECT 1 FROM users WHERE id = 'default-user'");
  if (r.rows.length === 0) {
    throw new Error(
      "No default-user row exists. Pass --email <addr> to target a real account.",
    );
  }
  return "default-user";
}

async function main() {
  await ensureSchema();
  await ensureRegisteredCapabilities();
  const userId = await resolveUserId(process.argv);

  const sources = await db.execute({
    sql: `SELECT id, kind, url, display_name FROM sources WHERE user_id = ? AND active = 1`,
    args: [userId],
  });

  console.log(`== polling ${sources.rows.length} sources ==`);

  const registry = getRegistry();
  let totalIngested = 0;
  for (const row of sources.rows) {
    const id = String(row.id);
    const kind = String(row.kind);
    const display = String(row.display_name ?? row.url);
    if (kind !== "rss" && kind !== "reddit" && kind !== "podcast" && kind !== "youtube") {
      console.log(`  skip ${display} (kind=${kind} not supported in v1)`);
      continue;
    }
    const capabilityId = kind === "reddit" ? "source-connector.reddit" : "source-connector.rss";
    try {
      const result = (await registry.invoke(
        capabilityId,
        undefined,
        { sourceId: id },
        {
          userId,
          requestId: crypto.randomUUID(),
          traceId: crypto.randomUUID(),
        },
      )) as { ingested: number; traceId: string };
      totalIngested += result.ingested;
      console.log(`  ✓ ${display}: +${result.ingested} items (trace ${result.traceId})`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`  ✗ ${display}: ${msg}`);
    }
  }

  // Settle the event bus.
  await new Promise((r) => setTimeout(r, 500));

  console.log(`\n== ingested ${totalIngested} items ==`);

  const itemsCount = await db.execute({
    sql: `SELECT COUNT(*) AS n FROM items WHERE user_id = ?`,
    args: [userId],
  });
  const clustersAll = await db.execute({
    sql: `SELECT id, state, source_count FROM clusters WHERE user_id = ? ORDER BY formed_at DESC`,
    args: [userId],
  });
  const fired = clustersAll.rows.filter((r) => String(r.state) === "fired");
  console.log(`items in DB: ${itemsCount.rows[0]!.n}`);
  console.log(`clusters: ${clustersAll.rows.length} total · ${fired.length} fired`);

  for (const c of clustersAll.rows.slice(0, 10)) {
    const items = await db.execute({
      sql: `SELECT i.title, s.display_name FROM items i
            JOIN sources s ON s.id = i.source_id
            WHERE i.cluster_id = ? LIMIT 4`,
      args: [String(c.id)],
    });
    const titles = items.rows
      .map((r) => `${String(r.display_name)}: ${String(r.title).slice(0, 60)}`)
      .join("\n      ");
    console.log(`  cluster ${String(c.id).slice(0, 8)} state=${c.state} sources=${c.source_count}`);
    if (items.rows.length > 0) {
      console.log(`      ${titles}`);
    }
  }

  if (fired.length === 0 && Number(itemsCount.rows[0]!.n) > 0) {
    console.log(
      "\nno clusters fired yet. typical reasons: items don't share enough entities (need 3 of top 5), source diversity gate (need 2+ distinct domains), or threshold (need 3+ sources).",
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
