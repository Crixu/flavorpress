/**
 * Poll all user sources right now and report what happened.
 *
 * Safe to run on a live database. Does not delete anything; only invokes
 * the source-connector.rss capability for each source row.
 */

import { db, ensureSchema, SINGLE_USER_ID } from "../src/lib/db";
import { ensureRegisteredCapabilities } from "../src/lib/v1/bootstrap";
import { getRegistry } from "../src/lib/v1/capability-registry";

async function main() {
  await ensureSchema();
  await ensureRegisteredCapabilities();

  const sources = await db.execute({
    sql: `SELECT id, kind, url, display_name FROM sources WHERE user_id = ? AND active = 1`,
    args: [SINGLE_USER_ID],
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
    try {
      const result = (await registry.invoke(
        "source-connector.rss",
        undefined,
        { sourceId: id },
        {
          userId: SINGLE_USER_ID,
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
    args: [SINGLE_USER_ID],
  });
  const clustersAll = await db.execute({
    sql: `SELECT id, state, source_count FROM clusters WHERE user_id = ? ORDER BY formed_at DESC`,
    args: [SINGLE_USER_ID],
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
