/**
 * Re-cluster pass.
 *
 * Wipes existing clusters (preserves items) and re-runs the cluster engine
 * over every item in chronological order. Use this after threshold changes
 * (lower bars, trust-weighted fire, stopword filter on entity extraction)
 * to verify the new policy fires clusters against real data.
 *
 * Safe in the sense that no item is deleted. The cluster_id pointer on
 * each item is cleared and reassigned. Drafts that referenced old cluster
 * IDs would lose their reference, but at this stage no drafts exist.
 */

import { db, ensureSchema } from "../src/lib/db";

const SINGLE_USER_ID = "default-user";
import { handleItemIngested } from "../src/lib/v1/cluster-engine";

async function main() {
  await ensureSchema();

  const before = await db.execute({
    sql: `SELECT COUNT(*) AS n FROM clusters WHERE user_id = ?`,
    args: [SINGLE_USER_ID],
  });
  console.log(`before: ${before.rows[0]!.n} clusters`);

  // Wipe.
  await db.execute({
    sql: `UPDATE items SET cluster_id = NULL WHERE user_id = ?`,
    args: [SINGLE_USER_ID],
  });
  await db.execute({
    sql: `DELETE FROM clusters WHERE user_id = ?`,
    args: [SINGLE_USER_ID],
  });

  const items = await db.execute({
    sql: `SELECT id, source_id, canonical_url, content_hash
          FROM items WHERE user_id = ? ORDER BY published_at ASC`,
    args: [SINGLE_USER_ID],
  });
  console.log(`re-running cluster engine on ${items.rows.length} items...`);

  let clustered = 0;
  let layer1 = 0;
  let layer2 = 0;
  let processed = 0;
  for (const row of items.rows) {
    const result = await handleItemIngested(
      {
        itemId: String(row.id),
        sourceId: String(row.source_id),
        canonicalUrl: String(row.canonical_url),
        contentHash: String(row.content_hash),
      },
      { userId: SINGLE_USER_ID, traceId: crypto.randomUUID() },
    );
    if (result.clusterId) clustered++;
    if (result.layer === 1) layer1++;
    if (result.layer === 2) layer2++;
    processed++;
    if (processed % 200 === 0) {
      process.stdout.write(`  ${processed}/${items.rows.length}\r`);
    }
  }
  console.log(`\nprocessed ${processed} items`);
  console.log(`  clustered: ${clustered} (layer1=${layer1}, layer2=${layer2})`);

  const after = await db.execute({
    sql: `SELECT id, state, source_count, primary_entities,
                 (SELECT COALESCE(SUM(s.trust_score), 0) FROM (
                    SELECT DISTINCT i.source_id FROM items i
                    WHERE i.cluster_id = clusters.id
                  ) ds JOIN sources s ON s.id = ds.source_id) AS trust_sum
          FROM clusters WHERE user_id = ?
          ORDER BY trust_sum DESC, source_count DESC LIMIT 12`,
    args: [SINGLE_USER_ID],
  });
  const fired = await db.execute({
    sql: `SELECT COUNT(*) AS n FROM clusters WHERE user_id = ? AND state = 'fired'`,
    args: [SINGLE_USER_ID],
  });
  const total = await db.execute({
    sql: `SELECT COUNT(*) AS n FROM clusters WHERE user_id = ?`,
    args: [SINGLE_USER_ID],
  });
  console.log(`\nafter: ${total.rows[0]!.n} clusters · ${fired.rows[0]!.n} fired`);
  console.log(`\ntop clusters by trust_sum:`);
  for (const c of after.rows) {
    const ents = c.primary_entities
      ? (JSON.parse(String(c.primary_entities)) as string[]).slice(0, 3).join(", ")
      : "—";
    console.log(
      `  ${String(c.id).slice(0, 8)} state=${c.state} sources=${c.source_count} trust=${Number(c.trust_sum).toFixed(2)} · ${ents}`,
    );
  }

  // Settle the event bus emissions before exit.
  await new Promise((r) => setTimeout(r, 500));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
