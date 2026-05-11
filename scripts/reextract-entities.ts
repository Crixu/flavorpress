/**
 * Retroactive entity re-extraction.
 *
 * Walks every item in the DB and runs the LLM-at-ingest extractor against
 * its title + lede. Persists entities, primary_subject, beat_tag back to
 * the items table. Cached by content_hash so re-runs are free.
 *
 * Run AFTER:
 *   - the entity_cache table and items.primary_subject/beat_tag columns
 *     have been migrated (next ensureSchema() call after pulling)
 *
 * Run BEFORE:
 *   - scripts/recluster.ts, so the rebuilt clusters use the new tags
 *
 * Concurrency: 5 inflight calls at a time. Rate-limit safe against
 * Anthropic's per-minute caps for Sonnet on a personal account; faster
 * than sequential without flooding the API. Local Claude (createAnthropicClient
 * → CLI shim) handles parallelism via the Agent SDK.
 */

import { db, ensureSchema } from "../src/lib/db";
import { extractItemEntities } from "../src/lib/v1/entity-extractor";
import { getUserByEmail } from "../src/lib/users";

const CONCURRENCY = 5;

interface ItemRow {
  id: string;
  title: string;
  lede: string;
  contentHash: string;
}

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
  const userId = await resolveUserId(process.argv);

  const r = await db.execute({
    sql: `SELECT id, title, lede, content_hash
          FROM items WHERE user_id = ?
          ORDER BY published_at ASC`,
    args: [userId],
  });

  const items: ItemRow[] = r.rows.map((row) => ({
    id: String(row.id),
    title: String(row.title ?? ""),
    lede: String(row.lede ?? ""),
    contentHash: String(row.content_hash ?? ""),
  }));

  console.log(`re-extracting ${items.length} items at concurrency ${CONCURRENCY}...`);

  let llm = 0;
  let cache = 0;
  let regex = 0;
  let processed = 0;

  // Simple bounded-concurrency loop. Pop items off the list, fire up to
  // CONCURRENCY parallel extractions, await any-settled, fire the next.
  const queue = items.slice();
  const inflight = new Set<Promise<void>>();

  const work = async (it: ItemRow): Promise<void> => {
    const extracted = await extractItemEntities({
      title: it.title,
      lede: it.lede,
      contentHash: it.contentHash,
    });
    await db.execute({
      sql: `UPDATE items SET entities = ?, primary_subject = ?, beat_tag = ? WHERE id = ?`,
      args: [
        JSON.stringify(extracted.entities),
        extracted.primarySubject,
        extracted.beatTag,
        it.id,
      ],
    });
    if (extracted.source === "llm") llm++;
    else if (extracted.source === "cache") cache++;
    else regex++;
    processed++;
    if (processed % 25 === 0) {
      process.stdout.write(`  ${processed}/${items.length}\r`);
    }
  };

  while (queue.length > 0 || inflight.size > 0) {
    while (inflight.size < CONCURRENCY && queue.length > 0) {
      const it = queue.shift()!;
      const p = work(it).finally(() => inflight.delete(p));
      inflight.add(p);
    }
    if (inflight.size > 0) await Promise.race(inflight);
  }

  console.log(`\nprocessed ${processed} items`);
  console.log(`  llm=${llm} cache=${cache} regex=${regex}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => {
    process.exit(0);
  });
