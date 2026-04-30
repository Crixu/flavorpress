/**
 * MCP server endpoint.
 *
 * Implements a minimal Model Context Protocol surface that exposes the
 * capability registry as tools. External agents (Claude Desktop, GPT,
 * future research/scheduling agents) can connect here and call FlavorPress
 * capabilities as MCP tools.
 *
 * v1 ships read-only registry inspection plus a tools/list and tools/call
 * surface. Auth: per-user API key in Authorization: Bearer <key>.
 *
 * Architect note: protocol version is advertised in handshake (the MCP
 * spec already supports this). When MCP 2.0 ships, we expose a sibling
 * endpoint at /api/mcp/v2 and route capability invocations to the right
 * protocol implementation.
 */

import { NextResponse } from "next/server";
import { getRegistry } from "@/lib/v1/capability-registry";
import { ensureRegisteredCapabilities } from "@/lib/v1/bootstrap";

const PROTOCOL_VERSION = "2024-11-05"; // MCP draft we target in v1

export async function GET() {
  // Discovery: handshake + tool list.
  await ensureRegisteredCapabilities();
  const registry = getRegistry();
  const tools = registry.list().map((m) => ({
    name: m.id,
    description: m.description,
    inputSchema: m.inputSchema,
    metadata: {
      version: m.version,
      tier: m.tier,
      requiresAuth: m.requiresAuth,
      latencyBudgetMs: m.latencyBudgetMs,
      tags: m.tags,
    },
  }));

  return NextResponse.json({
    protocolVersion: PROTOCOL_VERSION,
    serverInfo: {
      name: "flavorpress",
      version: "1.0.0",
    },
    capabilities: {
      tools: { listChanged: false },
      resources: { listChanged: false },
    },
    tools,
  });
}

export async function POST(req: Request) {
  await ensureRegisteredCapabilities();
  const body = (await req.json().catch(() => null)) as {
    method?: string;
    params?: Record<string, unknown>;
    id?: string | number;
  } | null;

  if (!body) {
    return jsonRpcError(null, -32700, "Parse error");
  }

  const id = body.id ?? null;
  const method = body.method;

  if (method === "initialize") {
    return jsonRpcResult(id, {
      protocolVersion: PROTOCOL_VERSION,
      serverInfo: { name: "flavorpress", version: "1.0.0" },
      capabilities: { tools: {}, resources: {} },
    });
  }

  if (method === "tools/list") {
    const registry = getRegistry();
    const tools = registry.list().map((m) => ({
      name: m.id,
      description: m.description,
      inputSchema: m.inputSchema ?? { type: "object" },
    }));
    return jsonRpcResult(id, { tools });
  }

  if (method === "tools/call") {
    const params = body.params ?? {};
    const name = params.name as string | undefined;
    const args = params.arguments as Record<string, unknown> | undefined;
    if (!name) return jsonRpcError(id, -32602, "missing tool name");

    // Auth: per-user bearer for now; v1 launches with internal use only.
    const auth = req.headers.get("authorization") ?? "";
    const userId = parseUserFromAuth(auth);
    if (!userId) {
      return jsonRpcError(id, -32001, "unauthorized");
    }

    const registry = getRegistry();
    try {
      const result = await registry.invoke(name, undefined, args ?? {}, {
        userId,
        requestId: crypto.randomUUID(),
        traceId: crypto.randomUUID(),
      });
      return jsonRpcResult(id, {
        content: [{ type: "text", text: JSON.stringify(result) }],
        isError: false,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return jsonRpcResult(id, {
        content: [{ type: "text", text: message }],
        isError: true,
      });
    }
  }

  return jsonRpcError(id, -32601, `method not found: ${method}`);
}

function jsonRpcResult(id: unknown, result: unknown) {
  return NextResponse.json({ jsonrpc: "2.0", id, result });
}

function jsonRpcError(id: unknown, code: number, message: string) {
  return NextResponse.json({
    jsonrpc: "2.0",
    id,
    error: { code, message },
  });
}

function parseUserFromAuth(header: string): string | null {
  // v1 stub: any Bearer token is accepted as user 'demo' for local dev.
  // v1.1: hashed API keys table with per-key scopes + audit log.
  if (!header.toLowerCase().startsWith("bearer ")) return null;
  const token = header.slice(7).trim();
  if (!token) return null;
  return process.env.NODE_ENV === "production" ? null : "demo";
}
