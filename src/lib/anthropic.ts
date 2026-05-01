import Anthropic from "@anthropic-ai/sdk";
import { LocalClaudeClient, resolveClaudeBinary } from "./anthropic-local";
import { getAnthropicApiKey } from "./v1/settings";

export { LocalClaudeError, type LocalClaudeErrorKind } from "./anthropic-local";

export const MODEL = "claude-sonnet-4-6";

export function extractText(message: Anthropic.Messages.Message): string {
  return message.content
    .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}

export function extractJson<T>(text: string): T {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`Model did not return JSON. Got: ${text.slice(0, 200)}`);
  return JSON.parse(match[0]) as T;
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
    stream(
      params: Anthropic.Messages.MessageStreamParams,
    ): AnthropicLikeStream;
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
export async function resolveAnthropicAuth(): Promise<ResolvedAnthropicAuth> {
  const flag = process.env.FLAVORPRESS_LOCAL_CLAUDE;
  const onVercel = process.env.VERCEL === "1";

  // Always look up any configured key up front. It travels alongside
  // the active mode so callers that specifically need the API path
  // (fact-check, anything using Anthropic server tools) can read it
  // even when the user has forced CLI mode for streaming drafts.
  const apiKey = await getAnthropicApiKey();

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
export async function createAnthropicClient(): Promise<AnthropicClientHandle> {
  const auth = await resolveAnthropicAuth();
  if (auth.mode === "api" && auth.apiKey) {
    return {
      mode: "api",
      client: new Anthropic({ apiKey: auth.apiKey }) as unknown as AnthropicLike,
    };
  }
  if (auth.mode === "cli" && auth.claudePath) {
    return { mode: "cli", client: new LocalClaudeClient(auth.claudePath) };
  }
  return { mode: "none", client: null };
}
