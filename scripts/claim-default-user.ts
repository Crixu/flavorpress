#!/usr/bin/env -S npx tsx --conditions react-server
import type { InValue } from "@libsql/client";
import { ensureSchema, db } from "@/lib/db";
import { getUserByEmail, USER_TENANCY_TABLES } from "@/lib/users";

async function main(): Promise<void> {
  await ensureSchema();
  const email = process.argv[2];
  if (!email) {
    process.stderr.write("Usage: scripts/claim-default-user.ts <email>\n");
    process.exitCode = 1;
    return;
  }

  const user = await getUserByEmail(email);
  if (!user) {
    process.stderr.write(`No user with email ${email}. Sign up first, then re-run.\n`);
    process.exitCode = 1;
    return;
  }

  const existing = await db.execute("SELECT 1 FROM users WHERE id = 'default-user'");
  if (existing.rows.length === 0) {
    process.stdout.write("No default-user row to claim. Nothing to do.\n");
    return;
  }

  const stmts: { sql: string; args: InValue[] }[] = [];
  for (const table of USER_TENANCY_TABLES) {
    stmts.push({
      sql: `UPDATE ${table} SET user_id = ? WHERE user_id = 'default-user'`,
      args: [user.id],
    });
  }
  stmts.push({
    sql: "DELETE FROM users WHERE id = 'default-user'",
    args: [],
  });
  await db.batch(stmts);

  process.stdout.write(`All default-user rows re-keyed to ${user.id} (${email}).\n`);
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
  process.exitCode = 1;
});
