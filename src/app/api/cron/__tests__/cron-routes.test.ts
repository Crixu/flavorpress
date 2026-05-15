import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const cronMocks = vi.hoisted(() => ({
  ensureRegisteredCapabilities: vi.fn(async () => undefined),
  runDuePolls: vi.fn(async () => ({ ok: true })),
}));

vi.mock("@/lib/v1/bootstrap", () => ({
  ensureRegisteredCapabilities: cronMocks.ensureRegisteredCapabilities,
}));

vi.mock("@/lib/v1/scheduler", () => ({
  runDuePolls: cronMocks.runDuePolls,
}));

import { GET as pollEarly } from "../poll-early/route";
import { GET as pollLate } from "../poll-late/route";
import { GET as pollMidday } from "../poll-midday/route";
import { GET as poll } from "../poll/route";
import { handlePollCron } from "../_shared";

const routes = [
  { path: "/api/cron/poll-early", GET: pollEarly },
  { path: "/api/cron/poll", GET: poll },
  { path: "/api/cron/poll-midday", GET: pollMidday },
  { path: "/api/cron/poll-late", GET: pollLate },
];

beforeEach(() => {
  vi.stubEnv("CRON_SECRET", "configured-cron-secret");
  vi.stubEnv("NODE_ENV", "test");
  cronMocks.ensureRegisteredCapabilities.mockClear();
  cronMocks.runDuePolls.mockClear();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("cron route auth", () => {
  it.each(routes)("rejects $path without a bearer token", async ({ path: routePath, GET }) => {
    const res = await GET(new Request(`http://localhost${routePath}`));

    expect(res.status).toBe(401);
    expect(cronMocks.runDuePolls).not.toHaveBeenCalled();
  });

  it.each(routes)("rejects $path with the wrong bearer token", async ({ path: routePath, GET }) => {
    const res = await GET(
      new Request(`http://localhost${routePath}`, {
        headers: { authorization: "Bearer wrong-token" },
      }),
    );

    expect(res.status).toBe(401);
    expect(cronMocks.runDuePolls).not.toHaveBeenCalled();
  });

  it.each(routes)(
    "runs $path with the configured bearer token",
    async ({ path: routePath, GET }) => {
      const res = await GET(
        new Request(`http://localhost${routePath}`, {
          headers: { authorization: "Bearer configured-cron-secret" },
        }),
      );
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body).toEqual({ ok: true });
      expect(cronMocks.ensureRegisteredCapabilities).toHaveBeenCalledTimes(1);
      expect(cronMocks.runDuePolls).toHaveBeenCalledWith(
        expect.objectContaining({
          wait: true,
          throwOnError: true,
          maxBatch: undefined,
          timeBudgetMs: 45_000,
          deferTimedOutTask: expect.any(Function),
        }),
      );
    },
  );

  it("rejects an empty bearer token without running polls", async () => {
    const res = await handlePollCron(
      new Request("http://localhost/api/cron/poll", {
        headers: { authorization: "Bearer " },
      }),
    );

    expect(res.status).toBe(401);
    expect(cronMocks.runDuePolls).not.toHaveBeenCalled();
  });

  it("fails closed in production when CRON_SECRET is missing", async () => {
    vi.stubEnv("CRON_SECRET", "");
    vi.stubEnv("NODE_ENV", "production");

    const res = await handlePollCron(new Request("http://localhost/api/cron/poll"));
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body).toEqual({ error: "CRON_SECRET is not configured" });
    expect(cronMocks.runDuePolls).not.toHaveBeenCalled();
  });
});

describe("cron route registration", () => {
  it("keeps every cron route behind the shared bearer-token handler", () => {
    const routeFiles = fs
      .readdirSync(cronDir(), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(cronDir(), entry.name, "route.ts"))
      .filter((routeFile) => fs.existsSync(routeFile))
      .sort();

    expect(routeFiles.length).toBeGreaterThan(0);

    for (const routeFile of routeFiles) {
      const source = fs.readFileSync(routeFile, "utf8");
      expect(source, routeFile).toMatch(/\bhandlePollCron\s*\(/);
    }
  });
});

function cronDir(): string {
  return path.join(process.cwd(), "src/app/api/cron");
}
