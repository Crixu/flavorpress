import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db, ensureSchema } from "@/lib/db";
import { issueMcpToken, revokeMcpToken } from "@/lib/v1/mcp-tokens";

const mocks = vi.hoisted(() => ({
  ensureRegisteredCapabilities: vi.fn(async () => undefined),
  invoke: vi.fn(),
  list: vi.fn(() => [
    {
      id: "cluster_read",
      version: "1.0.0",
      description: "Read a cluster",
      inputSchema: { type: "object" },
      tier: "both",
      requiresAuth: true,
      latencyBudgetMs: 100,
      tags: ["agent.editor"],
    },
  ]),
}));

vi.mock("@/lib/v1/bootstrap", () => ({
  ensureRegisteredCapabilities: mocks.ensureRegisteredCapabilities,
}));

vi.mock("@/lib/v1/capability-registry", () => ({
  getRegistry: () => ({
    list: mocks.list,
    invoke: mocks.invoke,
  }),
}));

import { GET, POST } from "./route";

const originalMcpToken = process.env.FLAVORPRESS_MCP_TOKEN;
const originalSessionSecret = process.env.FLAVORPRESS_SESSION_SECRET;

describe("/api/mcp auth", () => {
  beforeEach(async () => {
    delete process.env.FLAVORPRESS_MCP_TOKEN;
    await ensureSchema();
    await db.execute("DELETE FROM user_mcp_tokens");
    mocks.ensureRegisteredCapabilities.mockClear();
    mocks.invoke.mockReset();
    mocks.list.mockClear();
  });

  afterEach(() => {
    if (originalMcpToken === undefined) {
      delete process.env.FLAVORPRESS_MCP_TOKEN;
    } else {
      process.env.FLAVORPRESS_MCP_TOKEN = originalMcpToken;
    }
    if (originalSessionSecret === undefined) {
      delete process.env.FLAVORPRESS_SESSION_SECRET;
    } else {
      process.env.FLAVORPRESS_SESSION_SECRET = originalSessionSecret;
    }
  });

  it("rejects tools/list discovery when no Authorization header is sent", async () => {
    const res = await POST(mcpRequest({ method: "tools/list", id: 1 }));
    const json = await res.json();

    expect(res.status).toBe(401);
    expect(json.error).toEqual({ code: -32001, message: "unauthorized" });
    expect(mocks.ensureRegisteredCapabilities).not.toHaveBeenCalled();
  });

  it("rejects tools/call when no bearer token is sent", async () => {
    const res = await POST(
      mcpRequest({
        method: "tools/call",
        params: { name: "cluster_read", arguments: {} },
        id: 2,
      }),
    );
    const json = await res.json();

    expect(res.status).toBe(401);
    expect(json.error).toEqual({ code: -32001, message: "unauthorized" });
    expect(mocks.ensureRegisteredCapabilities).not.toHaveBeenCalled();
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("rejects GET discovery when no Authorization header is sent", async () => {
    const res = await GET(new Request("http://localhost/api/mcp"));
    const json = await res.json();

    expect(res.status).toBe(401);
    expect(json.error).toEqual({ code: -32001, message: "unauthorized" });
    expect(mocks.ensureRegisteredCapabilities).not.toHaveBeenCalled();
    expect(mocks.list).not.toHaveBeenCalled();
  });

  it("rejects random bearer tokens on discovery", async () => {
    const res = await GET(
      new Request("http://localhost/api/mcp", {
        headers: { authorization: "Bearer random-token" },
      }),
    );
    const json = await res.json();

    expect(res.status).toBe(401);
    expect(json.error).toEqual({ code: -32001, message: "unauthorized" });
    expect(mocks.ensureRegisteredCapabilities).not.toHaveBeenCalled();
    expect(mocks.list).not.toHaveBeenCalled();
  });

  it("rejects random bearer tokens on tools/call", async () => {
    const res = await POST(
      mcpRequest(
        {
          method: "tools/call",
          params: { name: "cluster_read", arguments: {} },
          id: 4,
        },
        "random-token",
      ),
    );
    const json = await res.json();

    expect(res.status).toBe(401);
    expect(json.error).toEqual({ code: -32001, message: "unauthorized" });
    expect(mocks.ensureRegisteredCapabilities).not.toHaveBeenCalled();
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("does not treat the legacy shared env token as a user", async () => {
    process.env.FLAVORPRESS_MCP_TOKEN = "configured-token";

    const res = await POST(
      mcpRequest(
        {
          method: "tools/call",
          params: { name: "cluster_read", arguments: {} },
          id: 5,
        },
        "configured-token",
      ),
    );
    const json = await res.json();

    expect(res.status).toBe(401);
    expect(json.error).toEqual({ code: -32001, message: "unauthorized" });
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("lists tools with a valid per-user bearer token", async () => {
    await upsertUser("user-from-token");
    const issued = await issueMcpToken("user-from-token", "test client");
    const stored = await db.execute("SELECT token_hash FROM user_mcp_tokens");

    const res = await POST(mcpRequest({ method: "tools/list", id: 6 }, issued.token));
    const json = await res.json();

    expect(String(stored.rows[0]!.token_hash)).toMatch(/^fp_h1_[A-Za-z0-9_-]+$/);
    expect(String(stored.rows[0]!.token_hash)).not.toContain(issued.token);
    expect(res.status).toBe(200);
    expect(json.error).toBeUndefined();
    expect(json.result.tools).toHaveLength(1);
  });

  it("allows GET discovery with a valid per-user bearer token", async () => {
    await upsertUser("user-from-token");
    const issued = await issueMcpToken("user-from-token", "test client");

    const res = await GET(
      new Request("http://localhost/api/mcp", {
        headers: { authorization: `Bearer ${issued.token}` },
      }),
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.tools).toEqual([
      {
        name: "cluster_read",
        description: "Read a cluster",
        inputSchema: { type: "object" },
      },
    ]);
    expect(json.tools[0]).not.toHaveProperty("metadata");
  });

  it("invokes tools/call with the user from the bearer token", async () => {
    await upsertUser("user-from-token");
    const issued = await issueMcpToken("user-from-token", "test client");
    mocks.invoke.mockResolvedValueOnce({ ok: true });

    const res = await POST(
      mcpRequest(
        {
          method: "tools/call",
          params: { name: "cluster_read", arguments: { clusterId: "c1" } },
          id: 7,
        },
        issued.token,
      ),
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.error).toBeUndefined();
    expect(json.result).toEqual({
      content: [{ type: "text", text: JSON.stringify({ ok: true }) }],
      isError: false,
    });
    expect(mocks.invoke).toHaveBeenCalledWith(
      "cluster_read",
      undefined,
      { clusterId: "c1" },
      expect.objectContaining({ userId: "user-from-token" }),
    );
  });

  it("rejects revoked per-user bearer tokens", async () => {
    await upsertUser("user-from-token");
    const issued = await issueMcpToken("user-from-token", "test client");
    await revokeMcpToken(issued.token);

    const res = await POST(
      mcpRequest(
        {
          method: "tools/call",
          params: { name: "cluster_read", arguments: {} },
          id: 8,
        },
        issued.token,
      ),
    );
    const json = await res.json();

    expect(res.status).toBe(401);
    expect(json.error).toEqual({ code: -32001, message: "unauthorized" });
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("rejects bearer tokens for suspended users", async () => {
    await upsertUser("user-from-token", "suspended");
    const issued = await issueMcpToken("user-from-token", "test client");

    const res = await POST(
      mcpRequest(
        {
          method: "tools/call",
          params: { name: "cluster_read", arguments: {} },
          id: 9,
        },
        issued.token,
      ),
    );
    const json = await res.json();

    expect(res.status).toBe(401);
    expect(json.error).toEqual({ code: -32001, message: "unauthorized" });
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("fails closed when the MCP token secret is not configured", async () => {
    delete process.env.FLAVORPRESS_SESSION_SECRET;

    const res = await POST(mcpRequest({ method: "tools/list", id: 10 }, "any-token"));
    const json = await res.json();

    expect(res.status).toBe(401);
    expect(json.error).toEqual({ code: -32001, message: "unauthorized" });
    expect(mocks.ensureRegisteredCapabilities).not.toHaveBeenCalled();
    expect(mocks.list).not.toHaveBeenCalled();
  });
});

function mcpRequest(body: Record<string, unknown>, token?: string) {
  return new Request("http://localhost/api/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

async function upsertUser(id: string, status: "active" | "suspended" = "active") {
  await db.execute({
    sql: `INSERT INTO users (id, email, status, is_admin, session_version, created_at)
          VALUES (?, ?, ?, 0, 0, ?)
          ON CONFLICT(id) DO UPDATE SET
            status = excluded.status,
            email = excluded.email`,
    args: [id, `${id}@example.com`, status, Date.now()],
  });
}
