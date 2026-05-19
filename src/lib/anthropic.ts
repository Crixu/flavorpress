import Anthropic from "@anthropic-ai/sdk";
import { LocalClaudeClient, resolveClaudeBinary } from "./anthropic-local";
import { withAnthropicLimit } from "./v1/ai-limiter";
import { reserveTokens, refundReservation } from "./v1/ai-budget";
import { capPromptBytes, promptByteLength } from "./v1/prompt-safety";
import { getAnthropicApiKey } from "./v1/settings";
import { safeLogValue } from "./safe-log";

export { LocalClaudeError, type LocalClaudeErrorKind } from "./anthropic-local";

export function extractText(message: Anthropic.Messages.Message): string {
  return message.content
    .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}

export function extractJson<T>(text: string): T {
  const trimmed = text.trim();
  const direct = tryParse<T>(trimmed);
  if (direct !== undefined) return direct;
  if (trimmed.length > 0 && trimmed[0] !== "{") {
    const prefilled = tryParse<T>(`{${trimmed}`);
    if (prefilled !== undefined) return prefilled;
  }
  const block = findFirstBalancedJsonObject(text);
  if (!block) {
    throw new Error(`Model did not return a balanced JSON object. Got: ${text.slice(0, 200)}`);
  }
  return JSON.parse(block) as T;
}

function tryParse<T>(text: string): T | undefined {
  try {
    return JSON.parse(text) as T;
  } catch {
    return undefined;
  }
}

/**
 * Scan `text` for the first balanced `{ ... }` block, respecting string
 * literals and escape sequences. Returns the substring, or null when no
 * balanced object is found.
 */
function findFirstBalancedJsonObject(text: string): string | null {
  let start = -1;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (inString) {
      if (ch === "\\") {
        escape = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === "}") {
      if (depth === 0) continue;
      depth--;
      if (depth === 0 && start !== -1) {
        return text.slice(start, i + 1);
      }
    }
  }
  return null;
}

/**
 * Append an assistant prefill of `{` so the model continues a JSON object
 * from a known opening brace. Call sites concatenate the literal `{` back
 * onto the model's response before parsing via `extractJson`.
 */
export function withJsonPrefill(
  messages: Anthropic.Messages.MessageParam[],
): Anthropic.Messages.MessageParam[] {
  return [...messages, { role: "assistant", content: "{" }];
}

export type AuthMode = "api" | "cli" | "proxy" | "none";

export interface AnthropicLikeStream extends AsyncIterable<Anthropic.Messages.RawMessageStreamEvent> {
  controller: { abort(): void };
}

export interface AnthropicLike {
  messages: {
    create(
      params: Anthropic.Messages.MessageCreateParamsNonStreaming,
    ): Promise<Anthropic.Messages.Message>;
    stream(params: Anthropic.Messages.MessageStreamParams): AnthropicLikeStream;
  };
}

export interface ResolvedAnthropicAuth {
  /** Active drafting mode the factory will hand out a client for. */
  mode: AuthMode;
  /**
   * Any configured Anthropic API key, independent of `mode`. Populated
   * whenever a key is set in DB or `ANTHROPIC_API_KEY`, even when
   * `mode` is `"cli"` (the user can force CLI for drafting while still
   * having a key available for API-only features like fact-check's
   * web_search server tool).
   */
  apiKey: string | null;
  /**
   * Absolute path to the `claude` binary. Populated only when
   * `mode === "cli"`; the factory hands it to LocalClaudeClient so
   * the Agent SDK does not fall back to its missing bundled binary
   * inside the packaged macOS app.
   */
  claudePath: string | null;
  /** Configured server-side proxy URL. Populated only when mode === "proxy". */
  proxyUrl: string | null;
}

interface AnthropicProxyConfig {
  url: string;
  token: string;
  feature: string | null;
}

function readAnthropicProxyConfig(): AnthropicProxyConfig | null {
  const url = process.env.FLAVORPRESS_ANTHROPIC_PROXY_URL?.trim();
  const token = process.env.FLAVORPRESS_ANTHROPIC_PROXY_TOKEN?.trim();
  const feature = process.env.FLAVORPRESS_ANTHROPIC_PROXY_FEATURE?.trim() || null;

  if (!url && !token) return null;
  if (!url || !token) {
    throw new Error(
      "FLAVORPRESS_ANTHROPIC_PROXY_URL and FLAVORPRESS_ANTHROPIC_PROXY_TOKEN must be configured together.",
    );
  }
  return {
    url: url.replace(/\/+$/, ""),
    token,
    feature,
  };
}

/**
 * Auth resolution for the Anthropic surface. Order:
 * 1. FLAVORPRESS_LOCAL_CLAUDE=1 → CLI for drafting (throws on Vercel;
 *    the user's local Claude install is unreachable from a serverless
 *    function). The configured API key still travels in `apiKey` so
 *    API-only call sites can use it.
 * 2. FLAVORPRESS_ANTHROPIC_PROXY_URL + _TOKEN → server-side proxy.
 *    Hosted deployments use this to keep provider credentials out of
 *    the app database and browser.
 * 3. Vercel → API only. Auto-detect never runs there.
 * 4. API key configured (DB or env) → API. The user pasting a key is
 *    an explicit choice; we do not auto-switch behind their back.
 * 5. `claude` binary on PATH → CLI (rides the user's Claude Code
 *    login via @anthropic-ai/claude-agent-sdk; same path Conductor uses).
 * 6. Otherwise → none. Call sites fall back to existing stub or error.
 */
export async function resolveAnthropicAuth(userId: string): Promise<ResolvedAnthropicAuth> {
  const flag = process.env.FLAVORPRESS_LOCAL_CLAUDE;
  const onVercel = process.env.VERCEL === "1";

  // Always look up any configured key up front. It travels alongside
  // the active mode so callers that specifically need the API path
  // (fact-check, anything using Anthropic server tools) can read it
  // even when the user has forced CLI mode for streaming drafts.
  const apiKey = await getAnthropicApiKey(userId);
  const proxy = readAnthropicProxyConfig();

  if (flag === "1") {
    if (onVercel) {
      throw new Error(
        "FLAVORPRESS_LOCAL_CLAUDE=1 is set on Vercel; the user's local Claude install is unreachable from a serverless function. Unset the flag or deploy to a host that runs on the user's machine.",
      );
    }
    const claudePath = await resolveClaudeBinary();
    if (!claudePath) {
      throw new Error(
        "FLAVORPRESS_LOCAL_CLAUDE=1 is set but `claude` was not found on PATH. Install Claude Code (or unset the flag and configure ANTHROPIC_API_KEY).",
      );
    }
    return { mode: "cli", apiKey, claudePath, proxyUrl: null };
  }

  if (proxy) {
    return { mode: "proxy", apiKey, claudePath: null, proxyUrl: proxy.url };
  }

  if (onVercel) {
    return apiKey
      ? { mode: "api", apiKey, claudePath: null, proxyUrl: null }
      : { mode: "none", apiKey: null, claudePath: null, proxyUrl: null };
  }

  if (apiKey) return { mode: "api", apiKey, claudePath: null, proxyUrl: null };

  const claudePath = await resolveClaudeBinary();
  if (claudePath) return { mode: "cli", apiKey: null, claudePath, proxyUrl: null };

  return { mode: "none", apiKey: null, claudePath: null, proxyUrl: null };
}

export interface AnthropicClientHandle {
  mode: AuthMode;
  client: AnthropicLike | null;
}

/**
 * Factory the call sites use instead of `new Anthropic({ apiKey })`.
 * Returns a real Anthropic client, a LocalClaudeClient shim, or null
 * when no auth is configured (call sites then fall back to their
 * existing stub / error path).
 */
export async function createAnthropicClient(userId: string): Promise<AnthropicClientHandle> {
  const auth = await resolveAnthropicAuth(userId);
  if (auth.mode === "proxy") {
    const proxy = readAnthropicProxyConfig();
    if (!proxy) return { mode: "none", client: null };
    return { mode: "proxy", client: wrapAnthropicClient(new AnthropicProxyClient(proxy), userId) };
  }
  if (auth.mode === "api" && auth.apiKey) {
    return { mode: "api", client: createAnthropicApiClient(auth.apiKey, userId) };
  }
  if (auth.mode === "cli" && auth.claudePath) {
    return {
      mode: "cli",
      client: wrapAnthropicClient(new LocalClaudeClient(auth.claudePath), userId),
    };
  }
  return { mode: "none", client: null };
}

export function createAnthropicApiClient(apiKey: string, userId: string): AnthropicLike {
  const raw = new Anthropic({ apiKey }) as unknown as AnthropicLike;
  return wrapAnthropicClient(raw, userId);
}

/**
 * API-only factory for features that cannot use the local Claude Code path,
 * such as Anthropic server tools. It still honors the hosted deployment
 * proxy before falling back to a direct user-provided API key.
 */
export async function createAnthropicApiClientForUser(
  userId: string,
): Promise<AnthropicClientHandle> {
  const proxy = readAnthropicProxyConfig();
  if (proxy) {
    return { mode: "proxy", client: wrapAnthropicClient(new AnthropicProxyClient(proxy), userId) };
  }
  const apiKey = await getAnthropicApiKey(userId);
  if (!apiKey) return { mode: "none", client: null };
  return { mode: "api", client: createAnthropicApiClient(apiKey, userId) };
}

class AnthropicProxyClient implements AnthropicLike {
  constructor(private readonly config: AnthropicProxyConfig) {}

  messages = {
    create: async (
      params: Anthropic.Messages.MessageCreateParamsNonStreaming,
    ): Promise<Anthropic.Messages.Message> => {
      let response: Response;
      try {
        response = await fetch(`${this.config.url}/messages`, {
          method: "POST",
          headers: this.headers(),
          body: JSON.stringify(params),
        });
      } catch (err) {
        this.logTransportFailure("messages.create", params, err);
        throw err;
      }
      if (!response.ok) {
        const details = await proxyErrorDetails(response);
        this.logFailure("messages.create", params, details);
        throw new Error(details.message);
      }
      return (await response.json()) as Anthropic.Messages.Message;
    },

    stream: (params: Anthropic.Messages.MessageStreamParams): AnthropicLikeStream => {
      const controller = new AbortController();
      const events = this.streamEvents(params, controller.signal) as AnthropicLikeStream;
      events.controller = { abort: () => controller.abort() };
      return events;
    },
  };

  private headers(): HeadersInit {
    const headers: Record<string, string> = {
      "X-Api-Key": this.config.token,
      "Content-Type": "application/json",
      "anthropic-version": "2023-06-01",
    };
    if (this.config.feature) headers["X-WPCOM-AI-Feature"] = this.config.feature;
    return headers;
  }

  private async *streamEvents(
    params: Anthropic.Messages.MessageStreamParams,
    signal: AbortSignal,
  ): AsyncIterable<Anthropic.Messages.RawMessageStreamEvent> {
    let response: Response;
    try {
      response = await fetch(`${this.config.url}/messages`, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({ ...params, stream: true }),
        signal,
      });
    } catch (err) {
      this.logTransportFailure("messages.stream", params, err);
      throw err;
    }
    if (!response.ok) {
      const details = await proxyErrorDetails(response);
      this.logFailure("messages.stream", params, details);
      throw new Error(details.message);
    }
    if (!response.body) throw new Error("Anthropic proxy returned no response body.");

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let fullText = "";
    let emitted = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      fullText += chunk;
      buffer += chunk;
      const parts = buffer.split(/\r?\n\r?\n/);
      buffer = parts.pop() ?? "";
      for (const part of parts) {
        const event = parseSseEvent(part);
        if (event) {
          emitted++;
          yield event;
        }
      }
    }

    const tail = decoder.decode();
    fullText += tail;
    buffer += tail;
    const finalEvent = parseSseEvent(buffer);
    if (finalEvent) {
      emitted++;
      yield finalEvent;
    }
    if (emitted === 0) {
      yield* parseProxyJsonStreamFallback(fullText);
    }
  }

  private logFailure(
    call: "messages.create" | "messages.stream",
    params:
      | Anthropic.Messages.MessageCreateParamsNonStreaming
      | Anthropic.Messages.MessageStreamParams,
    details: ProxyErrorDetails,
  ): void {
    const endpoint = proxyEndpointParts(this.config.url);
    console.error("[anthropic-proxy] request failed", {
      call,
      status: details.status,
      statusText: details.statusText,
      host: endpoint.host,
      path: endpoint.path,
      feature: this.config.feature || null,
      model: params.model,
      maxTokens: params.max_tokens,
      response: safeLogValue(details.bodySnippet, 500),
    });
  }

  private logTransportFailure(
    call: "messages.create" | "messages.stream",
    params:
      | Anthropic.Messages.MessageCreateParamsNonStreaming
      | Anthropic.Messages.MessageStreamParams,
    err: unknown,
  ): void {
    const endpoint = proxyEndpointParts(this.config.url);
    console.error("[anthropic-proxy] transport failed", {
      call,
      host: endpoint.host,
      path: endpoint.path,
      feature: this.config.feature || null,
      model: params.model,
      maxTokens: params.max_tokens,
      error: safeLogValue(err, 500),
    });
  }
}

interface ProxyErrorDetails {
  status: number;
  statusText: string;
  bodySnippet: string;
  message: string;
}

async function proxyErrorDetails(response: Response): Promise<ProxyErrorDetails> {
  const text = await response.text().catch(() => "");
  const bodySnippet = text.slice(0, 500);
  return {
    status: response.status,
    statusText: response.statusText,
    bodySnippet,
    message: `Anthropic proxy request failed (${response.status}): ${bodySnippet}`,
  };
}

function proxyEndpointParts(baseUrl: string): { host: string; path: string } {
  try {
    const url = new URL(baseUrl);
    return { host: url.host, path: `${url.pathname.replace(/\/+$/, "")}/messages` };
  } catch {
    return { host: "(invalid-url)", path: "/messages" };
  }
}

function parseSseEvent(block: string): Anthropic.Messages.RawMessageStreamEvent | null {
  const data = block
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n")
    .trim();
  if (!data || data === "[DONE]") return null;
  return JSON.parse(data) as Anthropic.Messages.RawMessageStreamEvent;
}

function* parseProxyJsonStreamFallback(
  text: string,
): Generator<Anthropic.Messages.RawMessageStreamEvent> {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("Anthropic proxy returned an empty stream response.");

  let message: Anthropic.Messages.Message;
  try {
    message = JSON.parse(trimmed) as Anthropic.Messages.Message;
  } catch {
    throw new Error(
      `Anthropic proxy returned neither SSE nor JSON. Got: ${safeLogValue(trimmed, 200)}`,
    );
  }

  if (!Array.isArray(message.content)) {
    throw new Error("Anthropic proxy JSON response did not include message content.");
  }

  yield { type: "message_start", message } as Anthropic.Messages.RawMessageStreamEvent;
  for (const [index, block] of message.content.entries()) {
    if (block.type !== "text") continue;
    yield {
      type: "content_block_delta",
      index,
      delta: { type: "text_delta", text: block.text },
    } as Anthropic.Messages.RawMessageStreamEvent;
  }
  yield {
    type: "message_delta",
    delta: {
      stop_reason: message.stop_reason ?? null,
      stop_sequence: message.stop_sequence ?? null,
    },
    usage: message.usage ? { output_tokens: Number(message.usage.output_tokens ?? 0) } : undefined,
  } as Anthropic.Messages.RawMessageStreamEvent;
  yield { type: "message_stop" } as Anthropic.Messages.RawMessageStreamEvent;
}

/**
 * Wrap the client's non-streaming `messages.create` with the process-wide
 * Anthropic limiter so every call site honors the org rate cap. The
 * per-user budget is reserved before the process limiter so an exhausted
 * user cannot spend org-limiter tokens that would suppress another user.
 */
export function wrapAnthropicClient(client: AnthropicLike, userId: string): AnthropicLike {
  return {
    messages: {
      create: async (params) => {
        const estimatedTokens = estimateAnthropicTokens(params);
        const reservation = await reserveTokens(userId, estimatedTokens);
        try {
          const message = await withAnthropicLimit(() => client.messages.create(params));
          await refundReservation(reservation, usageTokens(message));
          return message;
        } catch (err) {
          await refundReservation(reservation, 0);
          throw err;
        }
      },
      stream: (params) => {
        const estimatedTokens = estimateAnthropicTokens(params);
        let stream: AnthropicLikeStream | null = null;
        let aborted = false;
        let started = false;
        let sawStop = false;
        const streamUsage = { inputTokens: 0, outputTokens: 0 };

        async function* iterate(): AsyncGenerator<Anthropic.Messages.RawMessageStreamEvent> {
          const reservation = await reserveTokens(userId, estimatedTokens);
          try {
            if (aborted) throw new Error("Anthropic stream aborted before start.");
            stream = client.messages.stream(params);
            started = true;
            for await (const event of stream) {
              updateStreamUsage(event, streamUsage);
              if (event.type === "message_stop") sawStop = true;
              yield event;
            }
          } finally {
            if (sawStop) await refundReservation(reservation, streamUsageTokens(streamUsage));
            else if (!started) await refundReservation(reservation, 0);
          }
        }

        return {
          controller: {
            abort: () => {
              aborted = true;
              stream?.controller.abort();
            },
          },
          [Symbol.asyncIterator]: iterate,
        };
      },
    },
  };
}

const PROMPT_BYTE_CAP = 64 * 1024;

function estimateAnthropicTokens(
  params:
    | Anthropic.Messages.MessageCreateParamsNonStreaming
    | Anthropic.Messages.MessageStreamParams,
): number {
  const promptPayload = JSON.stringify({
    system: params.system ?? null,
    messages: params.messages ?? [],
    tools: "tools" in params ? params.tools : undefined,
  });
  capPromptBytes(promptPayload, PROMPT_BYTE_CAP);
  const inputTokens = Math.ceil(promptByteLength(promptPayload) / 4);
  return Math.max(1, Number(params.max_tokens ?? 0) + inputTokens);
}

function usageTokens(message: Anthropic.Messages.Message): number | null {
  const usage = message.usage;
  if (!usage) return null;
  return Number(usage.input_tokens ?? 0) + Number(usage.output_tokens ?? 0);
}

function updateStreamUsage(
  event: Anthropic.Messages.RawMessageStreamEvent,
  usage: { inputTokens: number; outputTokens: number },
): void {
  if (event.type === "message_start") {
    usage.inputTokens = Number(event.message.usage?.input_tokens ?? 0);
    usage.outputTokens = Number(event.message.usage?.output_tokens ?? 0);
    return;
  }
  if (event.type === "message_delta" && event.usage) {
    usage.outputTokens = Number(event.usage.output_tokens ?? usage.outputTokens);
  }
}

function streamUsageTokens(usage: { inputTokens: number; outputTokens: number }): number | null {
  const total = usage.inputTokens + usage.outputTokens;
  return total > 0 ? total : null;
}
