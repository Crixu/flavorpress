import { randomBytes } from "node:crypto";

const key = randomBytes(32).toString("base64");

process.stdout.write(`FLAVORPRESS_ENCRYPTION_KEY=base64:${key}\n`);
