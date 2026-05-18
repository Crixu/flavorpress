/**
 * MCP server endpoint.
 *
 * Implements a minimal Model Context Protocol surface that exposes the
 * capability registry as tools. External agents (Claude Desktop, GPT,
 * future research/scheduling agents) can connect here and call FlavorPress
 * capabilities as MCP tools.
 *
 * v1 ships read-only registry inspection plus a tools/list and tools/call
 * surface. Requests require Authorization: Bearer <per-user MCP token>.
 *
 * Architect note: protocol version is advertised in handshake (the MCP
 * spec already supports this). When MCP 2.0 ships, we expose a sibling
 * endpoint at /api/mcp/v2 and route capability invocations to the right
 * protocol implementation.
 */

import { NextResponse } from "next/server";
import { getRegistry } from "@/lib/v1/capability-registry";
import { ensureRegisteredCapabilities } from "@/lib/v1/bootstrap";
import { consumeMcpToken, McpTokenSecretError } from "@/lib/v1/mcp-tokens";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PROTOCOL_VERSION = "2024-11-05"; // MCP draft we target in v1

// Production stays closed until the token issuance UI ships. Non-production
// still uses per-user token lookup so shared previews cannot fall back to one user.
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
  const auth = await authenticateMcpRequest(req);
  if (!auth.ok) return jsonRpcError(null, -32001, auth.message, 401);

  // Discovery: handshake + tool list.
  await ensureRegisteredCapabilities();
  const tools = listMcpTools();

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
  const auth = await authenticateMcpRequest(req);
  if (!auth.ok) return jsonRpcError(id, -32001, auth.message, 401);

  if (method === "initialize") {
    return jsonRpcResult(id, {
      protocolVersion: PROTOCOL_VERSION,
      serverInfo: { name: "flavorpress", version: "1.0.0" },
      capabilities: { tools: {}, resources: {} },
    });
  }

  if (method === "tools/list") {
    await ensureRegisteredCapabilities();
    return jsonRpcResult(id, { tools: listMcpTools() });
  }

  if (method === "tools/call") {
    const params = body.params ?? {};
    const name = params.name as string | undefined;
    const args = params.arguments as Record<string, unknown> | undefined;
    if (!name) return jsonRpcError(id, -32602, "missing tool name");

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

function jsonRpcError(id: unknown, code: number, message: string, status = 200) {
  return NextResponse.json(
    {
      jsonrpc: "2.0",
      id,
      error: { code, message },
    },
    { status },
  );
}

function listMcpTools() {
  const registry = getRegistry();
  return registry.list().map((m) => ({
    name: m.id,
    description: m.description,
    inputSchema: m.inputSchema ?? { type: "object" },
  }));
}

async function authenticateMcpRequest(
  req: Request,
): Promise<{ ok: true; userId: string } | { ok: false; message: string }> {
  const header = req.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match) {
    return { ok: false, message: "unauthorized" };
  }

  const token = match[1];
  try {
    const consumed = await consumeMcpToken(token);
    if (!consumed) return { ok: false, message: "unauthorized" };
    return { ok: true, userId: consumed.userId };
  } catch (err) {
    if (err instanceof McpTokenSecretError) {
      return { ok: false, message: "unauthorized" };
    }
    throw err;
  }
}
