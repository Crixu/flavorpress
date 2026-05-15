import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { __setEncryptionKeyForTests } from "./src/lib/secret-crypto";

const dbDir = path.join(os.tmpdir(), "flavorpress-vitest");
fs.mkdirSync(dbDir, { recursive: true });
process.env.FLAVORPRESS_SESSION_SECRET =
  process.env.FLAVORPRESS_SESSION_SECRET ?? "test-secret-that-is-at-least-32-bytes-long!!";
process.env.LIBSQL_URL =
  process.env.FLAVORPRESS_TEST_LIBSQL_URL ??
  `file:${path.join(
    dbDir,
    `flavorpress-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
  )}`;

__setEncryptionKeyForTests(randomBytes(32));

afterEach(() => {
  cleanup();
});
