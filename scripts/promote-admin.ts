#!/usr/bin/env -S npx tsx --conditions react-server
import { ensureSchema, db } from "@/lib/db";
import { getUserByEmail } from "@/lib/users";

async function main(): Promise<void> {
  await ensureSchema();
  const email = process.argv[2];
  if (!email) {
    process.stderr.write("Usage: scripts/promote-admin.ts <email>\n");
    process.exitCode = 1;
    return;
  }
  const user = await getUserByEmail(email);
  if (!user) {
    process.stderr.write(`No user with email ${email}\n`);
    process.exitCode = 1;
    return;
  }
  await db.execute({
    sql: "UPDATE users SET is_admin = 1 WHERE id = ?",
    args: [user.id],
  });
  process.stdout.write(`Promoted ${email} to admin.\n`);
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
  process.exitCode = 1;
});
