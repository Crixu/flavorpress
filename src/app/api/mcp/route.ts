/**
 * MCP server endpoint.
 *
 * Implements a minimal Model Context Protocol surface that exposes the
 * capability registry as tools. External agents (Claude Desktop, GPT,
 * future research/scheduling agents) can connect here and call FlavorPress
 * capabilities as MCP tools.
 *
 * v1 ships read-only registry inspection plus a tools/list and tools/call
 * surface. Tool calls require Authorization: Bearer <FLAVORPRESS_MCP_TOKEN>.
 *
 * Architect note: protocol version is advertised in handshake (the MCP
 * spec already supports this). When MCP 2.0 ships, we expose a sibling
 * endpoint at /api/mcp/v2 and route capability invocations to the right
 * protocol implementation.
 */

import { NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";
import { getRegistry } from "@/lib/v1/capability-registry";
import { ensureRegisteredCapabilities } from "@/lib/v1/bootstrap";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PROTOCOL_VERSION = "2024-11-05"; // MCP draft we target in v1

// Sub-spec 4 wires per-user MCP tokens. Until then, production serves 501.
// Dev keeps the existing single-user shape using the legacy "default-user" id.
function rejectIfProduction(): NextResponse | null {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json(
      { error: "Per-user MCP routing is implemented in sub-spec 4." },
      { status: 501 },
    );
  }
  return null;
}

export async function GET(req: Request) {
  const prodBlock = rejectIfProduction();
  if (prodBlock) return prodBlock;
  const authError = rejectInvalidPresentedAuth(req, null);
  if (authError) return authError;

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
  const prodBlock = rejectIfProduction();
  if (prodBlock) return prodBlock;
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
  const authError = rejectInvalidPresentedAuth(req, id);
  if (authError) return authError;

  if (method === "initialize") {
    return jsonRpcResult(id, {
      protocolVersion: PROTOCOL_VERSION,
      serverInfo: { name: "flavorpress", version: "1.0.0" },
      capabilities: { tools: {}, resources: {} },
    });
  }

  if (method === "tools/list") {
    await ensureRegisteredCapabilities();
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

    const auth = authenticateMcpRequest(req);
    if (!auth.ok) return jsonRpcError(id, -32001, auth.message);

    await ensureRegisteredCapabilities();
    const registry = getRegistry();
    try {
      const result = await registry.invoke(name, undefined, args ?? {}, {
        userId: auth.userId,
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

function rejectInvalidPresentedAuth(req: Request, id: unknown) {
  const header = req.headers.get("authorization");
  if (!header) return null;

  const auth = authenticateMcpRequest(req);
  if (auth.ok) return null;

  return jsonRpcError(id, -32001, auth.message);
}

function authenticateMcpRequest(
  req: Request,
): { ok: true; userId: string } | { ok: false; message: string } {
  const configuredToken = (process.env.FLAVORPRESS_MCP_TOKEN ?? "").trim();
  if (!configuredToken) {
    return { ok: false, message: "MCP token is not configured" };
  }

  const header = req.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match) {
    return { ok: false, message: "unauthorized" };
  }

  const token = match[1];
  if (!token || !tokenMatches(token, configuredToken)) {
    return { ok: false, message: "unauthorized" };
  }

  // DEV-only compatibility: "default-user" is the legacy seeded user id.
  // Sub-spec 4 replaces this with per-user token lookup.
  return { ok: true, userId: "default-user" };
}

function tokenMatches(token: string, configuredToken: string): boolean {
  const tokenBytes = createHash("sha256").update(token).digest();
  const configuredBytes = createHash("sha256").update(configuredToken).digest();
  if (tokenBytes.byteLength !== configuredBytes.byteLength) return false;
  return timingSafeEqual(tokenBytes, configuredBytes);
}
