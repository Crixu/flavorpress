/**
 * Quick preflight check from the CLI. Useful for debugging connection
 * issues without going through the UI.
 */

import { preflightWordPress } from "../src/lib/wordpress";

const url = process.argv[2] ?? "https://contextwindow.blog";
const cb = process.argv[3] ?? "http://localhost:3000";

async function main() {
  console.log(`== preflight ${url} (callback ${cb}) ==`);
  const result = await preflightWordPress(url, cb);
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
