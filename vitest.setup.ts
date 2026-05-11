import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dbDir = path.join(os.tmpdir(), "flavorpress-vitest");
fs.mkdirSync(dbDir, { recursive: true });
process.env.LIBSQL_URL =
  process.env.FLAVORPRESS_TEST_LIBSQL_URL ??
  `file:${path.join(
    dbDir,
    `flavorpress-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
  )}`;

afterEach(() => {
  cleanup();
});
