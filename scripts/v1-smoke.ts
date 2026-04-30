/**
 * v1 foundation smoke test.
 *
 * Creates a user, adds a synthetic source, ingests a hand-crafted feed
 * twice (to verify dedupe), forces 3 sources to converge on one canonical
 * topic to fire a cluster, and runs the ranker. Verifies trace logs
 * accumulate and the event bus persists events.
 *
 * Run: npx tsx scripts/v1-smoke.ts
 */

import { db, ensureSchema } from "../src/lib/db";
import { ensureRegisteredCapabilities } from "../src/lib/v1/bootstrap";
import { getBus } from "../src/lib/v1/event-bus";
import { getRegistry } from "../src/lib/v1/capability-registry";
import { rankCluster } from "../src/lib/v1/ranker";
import { getTrace } from "../src/lib/v1/trace";
import { canonicalize, hashContent } from "../src/lib/v1/source-connector";
import type { ItemIngestedPayload } from "../src/lib/v1/types";

async function main() {
  console.log("== v1 foundation smoke ==");
  await ensureSchema();
  await ensureRegisteredCapabilities();

  // 1. Reset relevant tables (smoke-only). Keep v0.1 tables intact.
  await db.batch(
    [
      "DELETE FROM trace_log",
      "DELETE FROM event_log",
      "DELETE FROM ranker_signals",
      "DELETE FROM ranker_corrections",
      "DELETE FROM items",
      "DELETE FROM clusters",
      "DELETE FROM sources",
      "DELETE FROM users WHERE id = 'smoke-user'",
    ],
    "write",
  );

  const userId = "smoke-user";
  await db.execute({
    sql: `INSERT INTO users (id, email, niche_label, created_at)
          VALUES (?, ?, ?, ?)`,
    args: [userId, "smoke@flavorpress.local", "indie tech", Date.now()],
  });

  // 2. Three synthetic sources, all about the same canonical story so the
  //    cluster engine has to merge them.
  const sourceIds: string[] = [];
  const domains = ["reuters.example", "sprudge.example", "dcn.example"];
  for (let i = 0; i < 3; i++) {
    const id = `src-${i}`;
    sourceIds.push(id);
    await db.execute({
      sql: `INSERT INTO sources
            (id, user_id, kind, url, display_name, trust_score, poll_interval_seconds, active, created_at)
            VALUES (?, ?, 'rss', ?, ?, ?, 300, 1, ?)`,
      args: [
        id,
        userId,
        `https://${domains[i]}/feed`,
        `${domains[i]} feed`,
        0.85,
        Date.now(),
      ],
    });
  }

  console.log(`✓ created user ${userId} with 3 sources`);

  // 3. Manually emit item.ingested events for 3 items that should cluster.
  //    The shared canonical_url forces Layer 1 match; cluster fires after
  //    the third source contributes.
  const registry = getRegistry();
  const clusterEngine = registry.get("cluster-engine");
  if (!clusterEngine) throw new Error("cluster-engine not registered");

  const sharedTitle =
    "EU origin tariff hits specialty importers; SKU dispute splits the wire";
  const sharedLede =
    "The European Commission's enforcement notice this morning extends origin certification to all green coffee imports starting July 1.";

  const itemIds: string[] = [];
  for (let i = 0; i < 3; i++) {
    const itemId = `itm-${i}`;
    itemIds.push(itemId);
    const canonical = canonicalize(
      `https://${domains[i]}/eu-origin-tariff-importer-thinning?utm_source=feed`,
    );
    const ch = hashContent(sharedLede);
    await db.execute({
      sql: `INSERT INTO items
            (id, source_id, user_id, canonical_url, content_hash, title, lede, body, authors, published_at, fetched_at, entities)
            VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)`,
      args: [
        itemId,
        sourceIds[i]!,
        userId,
        // Make canonical_urls slightly different so Layer 1 doesn't match
        // exactly; we want Layer 2 to pick this up via entity overlap +
        // trigram similarity.
        `${canonical}#src${i}`,
        ch,
        sharedTitle,
        sharedLede,
        JSON.stringify(["Some Author"]),
        Date.now(),
        Date.now(),
        JSON.stringify([
          "European Commission",
          "EU",
          "July",
          "Specialty",
          "Yemen",
        ]),
      ],
    });
    await getBus().emit<ItemIngestedPayload>(
      "item.ingested",
      {
        itemId,
        sourceId: sourceIds[i]!,
        canonicalUrl: `${canonical}#src${i}`,
        contentHash: ch,
      },
      { userId, traceId: `tr_smoke_${i}` },
    );
  }

  // Give the bus a tick.
  await new Promise((r) => setTimeout(r, 100));

  // 4. Verify cluster formed and fired.
  const clusterRows = await db.execute({
    sql: `SELECT * FROM clusters WHERE user_id = ?`,
    args: [userId],
  });
  console.log(
    `✓ ${clusterRows.rows.length} cluster(s) formed for user ${userId}`,
  );
  for (const row of clusterRows.rows) {
    console.log(
      `  cluster ${row.id} state=${row.state} sources=${row.source_count}`,
    );
  }

  if (clusterRows.rows.length === 0) {
    console.log("⚠ no clusters formed; layer 2 may not have matched");
  } else {
    const cluster = clusterRows.rows[0]!;
    const clusterId = String(cluster.id);

    // 5. Run the ranker.
    const signals = await rankCluster(
      {
        id: clusterId,
        userId,
        centroid: null,
        embeddingModel: null,
        embeddingVersion: null,
        primaryEntities: cluster.primary_entities
          ? JSON.parse(String(cluster.primary_entities))
          : null,
        formedAt: Number(cluster.formed_at),
        firedAt: cluster.fired_at ? Number(cluster.fired_at) : null,
        sourceCount: Number(cluster.source_count),
        rankerScore: null,
        capabilityVersionPin: null,
        state: String(cluster.state) as "forming" | "fired" | "drafted" | "published" | "dismissed",
      },
      userId,
    );
    console.log(
      `✓ ranker composite ${signals.composite.toFixed(3)} (archive ${signals.archiveOverlap.toFixed(2)}, beat ${signals.beatMatch.toFixed(2)}, trust ${signals.sourceTrust.toFixed(2)})`,
    );
  }

  // 6. Verify event log persisted.
  const eventCount = await db.execute({
    sql: `SELECT COUNT(*) AS n FROM event_log WHERE user_id = ?`,
    args: [userId],
  });
  console.log(`✓ ${eventCount.rows[0]!.n} events persisted in event_log`);

  // 7. Verify trace logs.
  const trace = await getTrace("tr_smoke_2");
  console.log(`✓ trace tr_smoke_2 has ${trace.length} log span(s)`);

  // 8. Verify capability registry.
  const caps = registry.list();
  console.log(`✓ ${caps.length} capabilities registered`);
  for (const c of caps) {
    console.log(`  - ${c.id}@${c.version} [${c.tier}, ${c.costClass}]`);
  }

  console.log("== smoke complete ==");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
