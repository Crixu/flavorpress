import "server-only";

/**
 * LocalClaudeClient — minimal AnthropicLike shim that rides the user's
 * `claude` Code login via @anthropic-ai/claude-agent-sdk. Used when the
 * machine has Claude Code installed and authenticated, in place of an
 * Anthropic API key. Same approach Conductor uses for its in-app agents.
 *
 * Out of scope here (use an API key for these): server tools (web_search,
 * computer_use), JSON mode, vision input. The fact-check extension keeps
 * its API-key requirement explicit.
 *
 * Auth-state probing: we only verify the binary exists at resolution
 * time. Claude Code on macOS stores credentials in the system Keychain,
 * which makes a filesystem precheck unreliable; expired or revoked
 * sessions can also slip past any cheap probe. Instead, every SDK
 * response is inspected for error states here, and `LocalClaudeError`
 * is thrown so call sites can handle auth failure as their own kind of
 * "no credentials" state (the draft generator falls back to the stub,
 * the helper LLM calls fall back to their non-LLM heuristics).
 */

import type Anthropic from "@anthropic-ai/sdk";
import { query } from "@anthropic-ai/claude-agent-sdk";
import type { AnthropicLike, AnthropicLikeStream } from "./anthropic";

type CreateParams = Anthropic.Messages.MessageCreateParamsNonStreaming;
type StreamParams = Anthropic.Messages.MessageStreamParams;
type Message = Anthropic.Messages.Message;
type RawStreamEvent = Anthropic.Messages.RawMessageStreamEvent;

export type LocalClaudeErrorKind =
  | "auth"
  | "billing"
  | "rate_limit"
  | "max_output_tokens"
  | "other";

export class LocalClaudeError extends Error {
  readonly kind: LocalClaudeErrorKind;
  readonly subtype: string;
  constructor(kind: LocalClaudeErrorKind, subtype: string, detail?: string) {
    super(
      detail
        ? `Claude Agent SDK error (${subtype}): ${detail}`
        : `Claude Agent SDK error (${subtype})`,
    );
    this.name = "LocalClaudeError";
    this.kind = kind;
    this.subtype = subtype;
  }
}

type AssistantErrorSubtype =
  | "authentication_failed"
  | "oauth_org_not_allowed"
  | "billing_error"
  | "rate_limit"
  | "invalid_request"
  | "server_error"
  | "unknown"
  | "max_output_tokens";

function classifyAssistantError(subtype: AssistantErrorSubtype): LocalClaudeErrorKind {
  switch (subtype) {
    case "authentication_failed":
    case "oauth_org_not_allowed":
      return "auth";
    case "billing_error":
      return "billing";
    case "rate_limit":
      return "rate_limit";
    case "max_output_tokens":
      return "max_output_tokens";
    default:
      return "other";
  }
}

/**
 * Build the env handed to the Claude Code subprocess. Strips Anthropic
 * credential variables so the child rides the user's OAuth login (the
 * whole point of this path) instead of silently billing against an
 * `ANTHROPIC_API_KEY` that happens to also be set on the parent.
 *
 * Without this strip, a user with `FLAVORPRESS_LOCAL_CLAUDE=1` and an
 * `ANTHROPIC_API_KEY` in their `.env` would think they were running on
 * their Claude subscription but actually be charging API credit.
 */
function envForLocalClaude(): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...process.env };
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_AUTH_TOKEN;
  return env;
}

/**
 * The minimum Agent SDK option set required to keep the user's Claude
 * Code surface from leaking into a draft turn. Spreading this into
 * both `messages.create` and `messages.stream` keeps the two paths in
 * lockstep so a future option here applies to both.
 *
 * Lockdown channels (each is a separate place tools/skills/commands
 * can ride in from; `system_init` event tracks them):
 * - `tools: []`         - no built-in Bash/Read/Edit/etc.
 * - `settingSources: []`- no ~/.claude/settings.json, no project
 *                         settings, no CLAUDE.md, no slash commands
 *                         from `.claude/commands/`
 * - `mcpServers: {}` + `strictMcpConfig: true` - explicit empty MCP
 *                         server map AND tell Claude Code to use ONLY
 *                         what we pass, ignoring the user's global
 *                         `.mcp.json` and per-project MCP config.
 *                         `mcpServers: {}` alone is not enough; the
 *                         CLI still discovers connected account tools
 *                         (Gmail, Calendar, Slack, ...) and exposes
 *                         them in the init event. Strict mode is the
 *                         only way to keep prompt-injection from a
 *                         draft body reaching those connectors.
 * - `plugins: []`       - explicit empty plugin list; plugins ship
 *                         their own commands, agents, skills, hooks
 * - `agents: {}`        - no subagents available via the Agent tool
 * - `skills: []`        - empty enabled-skills list; otherwise the
 *                         SDK can auto-include skill frontmatter
 *                         from the user's library in the init event
 * - `permissionMode: "dontAsk"` - belt-and-suspenders; if anything
 *                         did slip through, deny by default rather
 *                         than prompt
 */
const HERMETIC_OPTIONS = {
  tools: [] as string[],
  settingSources: [] as never[],
  mcpServers: {},
  strictMcpConfig: true,
  plugins: [] as never[],
  agents: {},
  skills: [] as string[],
  permissionMode: "dontAsk" as const,
};

function flattenSystem(system: CreateParams["system"]): string | undefined {
  if (system === undefined || system === null) return undefined;
  if (typeof system === "string") return system;
  if (Array.isArray(system)) {
    return system
      .map((b) => (typeof b === "string" ? b : (b.text ?? "")))
      .filter((s) => s.length > 0)
      .join("\n\n");
  }
  return undefined;
}

function flattenUserMessage(messages: CreateParams["messages"]): string {
  if (messages.length !== 1 || messages[0]!.role !== "user") {
    throw new Error(
      "LocalClaudeClient: only single-user-message turns are supported.",
    );
  }
  const c = messages[0]!.content;
  if (typeof c === "string") return c;
  return c
    .map((b) => (b.type === "text" ? b.text : ""))
    .filter((s) => s.length > 0)
    .join("\n\n");
}

/**
 * Inspect a single SDK message and throw if it carries an error state.
 * Three shapes are checked:
 *   - `assistant.error` (per-turn API error: auth, billing, rate limit, ...)
 *   - `auth_status.error` (CLI-level auth failure; emitted when the user
 *     has Claude Code installed but is signed out or the session expired,
 *     before any assistant turn happens)
 *   - `result` messages whose subtype is anything other than `success`
 *     (max_turns, max_budget, error_during_execution, ...)
 *
 * Without the `auth_status` branch, signed-out users would iterate to
 * completion with no assistant text and trip the empty-response guard
 * as `kind: "other"`, which the draft generator does not treat as an
 * auth failure and therefore does not stub.
 */
function throwIfErrorMessage(msg: unknown): void {
  if (typeof msg !== "object" || msg === null) return;
  const m = msg as {
    type?: string;
    error?: string;
    subtype?: string;
    errors?: unknown;
  };
  if (m.type === "assistant" && typeof m.error === "string") {
    const subtype = m.error as AssistantErrorSubtype;
    throw new LocalClaudeError(classifyAssistantError(subtype), subtype);
  }
  if (
    m.type === "auth_status" &&
    typeof m.error === "string" &&
    m.error.length > 0
  ) {
    throw new LocalClaudeError("auth", "auth_status_error", m.error);
  }
  if (m.type === "result" && typeof m.subtype === "string" && m.subtype !== "success") {
    const detail = Array.isArray(m.errors) ? m.errors.join("; ") : undefined;
    throw new LocalClaudeError("other", m.subtype, detail);
  }
}

export class LocalClaudeClient implements AnthropicLike {
  // Absolute path to the `claude` binary, resolved by `resolveClaudeBinary`
  // and handed in by the factory. Passed through to every query() call as
  // `pathToClaudeCodeExecutable` so the SDK never falls back to its
  // platform-specific bundled binary, which is dropped by Next.js's
  // standalone tracer and therefore missing in the packaged macOS app.
  constructor(private readonly claudePath: string) {}

  messages = {
    create: async (params: CreateParams): Promise<Message> => {
      if (params.tools && params.tools.length > 0) {
        throw new Error(
          "LocalClaudeClient: Anthropic server tools (web_search, etc.) are not supported via the local Claude path. Add an API key on /settings to use this feature.",
        );
      }
      const response = query({
        prompt: flattenUserMessage(params.messages),
        options: {
          ...HERMETIC_OPTIONS,
          systemPrompt: flattenSystem(params.system),
          model: params.model,
          maxTurns: 1,
          // Use the user's installed `claude`, not the SDK's bundled
          // binary (which Next.js standalone build drops; see the
          // class-level comment).
          pathToClaudeCodeExecutable: this.claudePath,
          // Explicit env so a parent-process ANTHROPIC_API_KEY does
          // not silently override the OAuth login this path is
          // supposed to use.
          env: envForLocalClaude(),
          persistSession: false,
        },
      });
      let text = "";
      let model = params.model;
      let sawAssistant = false;
      for await (const msg of response) {
        throwIfErrorMessage(msg);
        if (msg.type === "assistant") {
          sawAssistant = true;
          model = msg.message.model;
          for (const block of msg.message.content) {
            if (block.type === "text") text += block.text;
          }
        }
      }
      // Defensive guard: a successful iteration with no assistant text
      // typically means the SDK gave up silently. Surface as an error
      // rather than returning an empty Message that downstream JSON
      // parsers will choke on with a confusing message.
      if (!sawAssistant || text.length === 0) {
        throw new LocalClaudeError(
          "other",
          "empty_response",
          "Claude Agent SDK returned no assistant text.",
        );
      }
      // Cast through unknown: we only populate fields the existing
      // call sites actually read (id/role/content/stop_reason/model).
      // Usage and stop_sequence are not consulted on this path.
      return {
        id: `local_${Date.now()}`,
        type: "message",
        role: "assistant",
        model,
        content: [{ type: "text", text, citations: null }],
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: {
          input_tokens: 0,
          output_tokens: 0,
          cache_creation_input_tokens: null,
          cache_read_input_tokens: null,
          server_tool_use: null,
          service_tier: null,
        },
      } as unknown as Message;
    },
    stream: (params: StreamParams): AnthropicLikeStream => {
      const abortController = new AbortController();
      const response = query({
        prompt: flattenUserMessage(
          params.messages as CreateParams["messages"],
        ),
        options: {
          systemPrompt: flattenSystem(
            params.system as CreateParams["system"],
          ),
          ...HERMETIC_OPTIONS,
          model: params.model,
          maxTurns: 1,
          // Use the user's installed `claude`, not the SDK's bundled
          // binary (which Next.js standalone build drops; see the
          // class-level comment).
          pathToClaudeCodeExecutable: this.claudePath,
          // Explicit env so a parent-process ANTHROPIC_API_KEY does
          // not silently override the OAuth login this path is
          // supposed to use.
          env: envForLocalClaude(),
          persistSession: false,
          includePartialMessages: true,
          abortController,
        },
      });
      async function* iterate(): AsyncGenerator<
        RawStreamEvent,
        void,
        void
      > {
        for await (const msg of response) {
          // Throws synchronously on error states so the consumer's
          // `for await` raises instead of silently terminating with
          // partial text.
          throwIfErrorMessage(msg);
          if (msg.type === "stream_event") {
            yield msg.event as unknown as RawStreamEvent;
          }
        }
      }
      return {
        controller: abortController,
        [Symbol.asyncIterator]: iterate,
      };
    },
  };
}

let cachedClaudePath: string | null = null;

/**
 * Resolve the absolute path of `claude` on PATH, or null if the binary
 * cannot be located. Used both as the "is local Claude usable" probe
 * AND as the value handed to the Agent SDK's `pathToClaudeCodeExecutable`.
 *
 * Why we resolve and pass it explicitly: the SDK ships its bundled
 * binary via the platform-specific package
 * `@anthropic-ai/claude-agent-sdk-darwin-arm64`. Next.js's standalone
 * tracer treats that as a non-static dependency and drops it from
 * `.next/standalone/`, so the binary is missing in the packaged
 * macOS .app. Without an explicit path the SDK silently falls back
 * to the missing bundled binary and crashes. Pointing it at the
 * user's installed `claude` avoids the bundled-binary path entirely
 * and rides whatever Claude Code version they actually have.
 *
 * Does NOT verify that the user is logged in; macOS Keychain storage
 * and OAuth expiry make a cheap auth precheck unreliable. Auth state
 * is enforced at call time via LocalClaudeError instead.
 *
 * Cache policy: only successful resolutions are memoized. A miss must
 * not stick for the process lifetime; the macOS app keeps running for
 * days, and a user who installs Claude Code mid-session should not
 * have to relaunch to flip auto-detect on. The cost of re-probing on
 * misses is one `which` subprocess per LLM-related render, which only
 * happens in the unauthenticated state anyway.
 */
export async function resolveClaudeBinary(): Promise<string | null> {
  if (cachedClaudePath) return cachedClaudePath;
  let resolved: string | null = null;
  try {
    const { spawn } = await import("node:child_process");
    resolved = await new Promise<string | null>((resolve) => {
      const child = spawn("/usr/bin/which", ["claude"], {
        stdio: ["ignore", "pipe", "ignore"],
      });
      let out = "";
      child.stdout?.on("data", (chunk: Buffer) => {
        out += chunk.toString();
      });
      child.on("error", () => resolve(null));
      child.on("exit", (code) => {
        const path = out.trim();
        resolve(code === 0 && path.length > 0 ? path : null);
      });
    });
  } catch {
    resolved = null;
  }
  if (resolved) cachedClaudePath = resolved;
  return resolved;
}
