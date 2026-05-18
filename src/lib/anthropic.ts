import Anthropic from "@anthropic-ai/sdk";
import { LocalClaudeClient, resolveClaudeBinary } from "./anthropic-local";
import { withAnthropicLimit } from "./v1/ai-limiter";
import { reserveTokens, refundReservation } from "./v1/ai-budget";
import { capPromptBytes, promptByteLength } from "./v1/prompt-safety";
import { getAnthropicApiKey } from "./v1/settings";

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

export type AuthMode = "api" | "cli" | "none";

export interface AnthropicLikeStream
  extends AsyncIterable<Anthropic.Messages.RawMessageStreamEvent> {
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
}

/**
 * Auth resolution for the Anthropic surface. Order:
 * 1. FLAVORPRESS_LOCAL_CLAUDE=1 → CLI for drafting (throws on Vercel;
 *    the user's local Claude install is unreachable from a serverless
 *    function). The configured API key still travels in `apiKey` so
 *    API-only call sites can use it.
 * 2. Vercel → API only. Auto-detect never runs there.
 * 3. API key configured (DB or env) → API. The user pasting a key is
 *    an explicit choice; we do not auto-switch behind their back.
 * 4. `claude` binary on PATH → CLI (rides the user's Claude Code
 *    login via @anthropic-ai/claude-agent-sdk; same path Conductor uses).
 * 5. Otherwise → none. Call sites fall back to existing stub or error.
 */
export async function resolveAnthropicAuth(userId: string): Promise<ResolvedAnthropicAuth> {
  const flag = process.env.FLAVORPRESS_LOCAL_CLAUDE;
  const onVercel = process.env.VERCEL === "1";

  // Always look up any configured key up front. It travels alongside
  // the active mode so callers that specifically need the API path
  // (fact-check, anything using Anthropic server tools) can read it
  // even when the user has forced CLI mode for streaming drafts.
  const apiKey = await getAnthropicApiKey(userId);

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
    return { mode: "cli", apiKey, claudePath };
  }

  if (onVercel) {
    return apiKey
      ? { mode: "api", apiKey, claudePath: null }
      : { mode: "none", apiKey: null, claudePath: null };
  }

  if (apiKey) return { mode: "api", apiKey, claudePath: null };

  const claudePath = await resolveClaudeBinary();
  if (claudePath) return { mode: "cli", apiKey: null, claudePath };

  return { mode: "none", apiKey: null, claudePath: null };
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
