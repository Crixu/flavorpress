#!/usr/bin/env -S npx tsx --conditions react-server
import { randomBytes } from "node:crypto";
import { ensureSchema } from "@/lib/db";
import { getUserByEmail, updatePassword } from "@/lib/users";
import { hashPassword } from "@/lib/password";

async function main(): Promise<void> {
  await ensureSchema();
  const email = process.argv[2];
  if (!email) {
    process.stderr.write("Usage: scripts/reset-password.ts <email>\n");
    process.exitCode = 1;
    return;
  }
  const user = await getUserByEmail(email);
  if (!user) {
    process.stderr.write(`No user with email ${email}\n`);
    process.exitCode = 1;
    return;
  }
  const temp = randomBytes(12).toString("base64url");
  const hash = await hashPassword(temp);
  await updatePassword(user.id, hash);
  process.stdout.write(
    [
      `Password reset for ${email}.`,
      `Temporary password: ${temp}`,
      `All other sessions for this account have been invalidated.`,
    ].join("\n") + "\n",
  );
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
  process.exitCode = 1;
});
