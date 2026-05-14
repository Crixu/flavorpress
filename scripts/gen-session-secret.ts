import { randomBytes } from "node:crypto";

const sessionSecret = randomBytes(32).toString("base64");
const wpcomStateSecret = randomBytes(32).toString("base64");

process.stdout.write(`FLAVORPRESS_SESSION_SECRET=${sessionSecret}\n`);
process.stdout.write(`FLAVORPRESS_WPCOM_STATE_SECRET=${wpcomStateSecret}\n`);
