import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

describe("/api/mcp auth", () => {
  beforeEach(() => {
    delete process.env.FLAVORPRESS_MCP_TOKEN;
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
  });

  it("allows unauthenticated tools/list discovery when no Authorization header is sent", async () => {
    const res = await POST(mcpRequest({ method: "tools/list", id: 1 }));
    const json = await res.json();

    expect(json.error).toBeUndefined();
    expect(json.result.tools).toHaveLength(1);
  });

  it("rejects tools/call when FLAVORPRESS_MCP_TOKEN is not configured", async () => {
    const res = await POST(
      mcpRequest({
        method: "tools/call",
        params: { name: "cluster_read", arguments: {} },
        id: 2,
      }),
    );
    const json = await res.json();

    expect(json.error).toEqual({ code: -32001, message: "MCP token is not configured" });
    expect(mocks.ensureRegisteredCapabilities).not.toHaveBeenCalled();
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("rejects tools/call when no bearer token is sent", async () => {
    process.env.FLAVORPRESS_MCP_TOKEN = "configured-token";

    const res = await POST(
      mcpRequest({
        method: "tools/call",
        params: { name: "cluster_read", arguments: {} },
        id: 3,
      }),
    );
    const json = await res.json();

    expect(json.error).toEqual({ code: -32001, message: "unauthorized" });
    expect(mocks.ensureRegisteredCapabilities).not.toHaveBeenCalled();
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("rejects random bearer tokens on discovery", async () => {
    process.env.FLAVORPRESS_MCP_TOKEN = "configured-token";

    const res = await GET(
      new Request("http://localhost/api/mcp", {
        headers: { authorization: "Bearer random-token" },
      }),
    );
    const json = await res.json();

    expect(json.error).toEqual({ code: -32001, message: "unauthorized" });
    expect(mocks.ensureRegisteredCapabilities).not.toHaveBeenCalled();
    expect(mocks.list).not.toHaveBeenCalled();
  });

  it("rejects random bearer tokens on tools/call", async () => {
    process.env.FLAVORPRESS_MCP_TOKEN = "configured-token";

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

    expect(json.error).toEqual({ code: -32001, message: "unauthorized" });
    expect(mocks.ensureRegisteredCapabilities).not.toHaveBeenCalled();
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("invokes tools/call with the configured bearer token", async () => {
    process.env.FLAVORPRESS_MCP_TOKEN = "configured-token";
    mocks.invoke.mockResolvedValueOnce({ ok: true });

    const res = await POST(
      mcpRequest(
        {
          method: "tools/call",
          params: { name: "cluster_read", arguments: { clusterId: "c1" } },
          id: 5,
        },
        "configured-token",
      ),
    );
    const json = await res.json();

    expect(json.error).toBeUndefined();
    expect(json.result).toEqual({
      content: [{ type: "text", text: JSON.stringify({ ok: true }) }],
      isError: false,
    });
    expect(mocks.invoke).toHaveBeenCalledWith(
      "cluster_read",
      undefined,
      { clusterId: "c1" },
      expect.objectContaining({ userId: "default-user" }),
    );
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
