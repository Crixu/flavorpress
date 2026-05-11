#!/usr/bin/env -S npx tsx --conditions react-server
import { ensureSchema } from "@/lib/db";
import { issueInvite } from "@/lib/invites";

function parseDays(argv: string[]): number {
  const i = argv.indexOf("--days");
  if (i === -1) return 14;
  const value = Number(argv[i + 1]);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error("--days must be a non-negative number");
  }
  return value;
}

async function main(): Promise<void> {
  await ensureSchema();
  const days = parseDays(process.argv);
  const expiresAt = days === 0 ? null : Date.now() + days * 24 * 60 * 60 * 1000;
  const { token } = await issueInvite({ expiresAt });
  const base = (process.env.FLAVORPRESS_ORIGIN ?? "http://localhost:3000").replace(/\/$/, "");
  const expiresLine =
    expiresAt == null ? "never" : `${new Date(expiresAt).toISOString()} (${days} days)`;

  process.stdout.write(
    [
      "Invite created.",
      `Token:   ${token}`,
      `URL:     ${base}/signup?invite=${token}`,
      `Expires: ${expiresLine}`,
    ].join("\n") + "\n",
  );
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
  process.exitCode = 1;
});
