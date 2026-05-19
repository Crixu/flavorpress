import { afterEach, describe, expect, it, vi } from "vitest";
import { createAnthropicApiClientForUser } from "../anthropic";

describe("createAnthropicApiClientForUser", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("routes non-streaming messages through the configured proxy", async () => {
    vi.stubEnv("FLAVORPRESS_ANTHROPIC_PROXY_URL", "https://ai-gateway.test/wpcom/v2/proxy/v1/");
    vi.stubEnv("FLAVORPRESS_ANTHROPIC_PROXY_TOKEN", "server-token");
    vi.stubEnv("FLAVORPRESS_ANTHROPIC_PROXY_FEATURE", "flavorpress-test");

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "msg_1",
          type: "message",
          role: "assistant",
          content: [{ type: "text", text: "ok" }],
          model: "claude-test",
          stop_reason: "end_turn",
          stop_sequence: null,
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { mode, client } = await createAnthropicApiClientForUser("user-1");
    const message = await client!.messages.create({
      model: "claude-test",
      max_tokens: 32,
      messages: [{ role: "user", content: "hello" }],
    });

    expect(mode).toBe("proxy");
    expect(message.content[0]).toMatchObject({ type: "text", text: "ok" });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://ai-gateway.test/wpcom/v2/proxy/v1/messages",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "X-Api-Key": "server-token",
          "Content-Type": "application/json",
          "X-WPCOM-AI-Feature": "flavorpress-test",
          "anthropic-version": "2023-06-01",
        }),
      }),
    );
    const body = JSON.parse(String(fetchMock.mock.calls[0]![1]!.body)) as Record<string, unknown>;
    expect(body).toMatchObject({ model: "claude-test", max_tokens: 32 });
  });

  it("parses streaming proxy events", async () => {
    vi.stubEnv("FLAVORPRESS_ANTHROPIC_PROXY_URL", "https://ai-gateway.test/v1");
    vi.stubEnv("FLAVORPRESS_ANTHROPIC_PROXY_TOKEN", "server-token");

    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"hi"}}\n\n',
          ),
        );
        controller.close();
      },
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(stream, { status: 200 })));

    const { client } = await createAnthropicApiClientForUser("user-1");
    const events = [];
    for await (const event of client!.messages.stream({
      model: "claude-test",
      max_tokens: 32,
      messages: [{ role: "user", content: "hello" }],
    })) {
      events.push(event);
    }

    expect(events).toEqual([
      {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "hi" },
      },
    ]);
  });

  it("parses JSON proxy responses from streaming calls", async () => {
    vi.stubEnv("FLAVORPRESS_ANTHROPIC_PROXY_URL", "https://ai-gateway.test/v1");
    vi.stubEnv("FLAVORPRESS_ANTHROPIC_PROXY_TOKEN", "server-token");

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            id: "msg_1",
            type: "message",
            role: "assistant",
            content: [{ type: "text", text: '{"headline":"Story","body":"<p>Body</p>"}' }],
            model: "claude-test",
            stop_reason: "end_turn",
            stop_sequence: null,
            usage: { input_tokens: 2, output_tokens: 3 },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
    );

    const { client } = await createAnthropicApiClientForUser("user-1");
    const events = [];
    for await (const event of client!.messages.stream({
      model: "claude-test",
      max_tokens: 32,
      messages: [{ role: "user", content: "hello" }],
    })) {
      events.push(event);
    }

    expect(
      events
        .filter((event) => event.type === "content_block_delta")
        .map((event) => (event as { delta: { text: string } }).delta.text),
    ).toEqual(['{"headline":"Story","body":"<p>Body</p>"}']);
    expect(events.some((event) => event.type === "message_stop")).toBe(true);
  });

  it("rejects proxy stream responses that are neither SSE nor JSON", async () => {
    vi.stubEnv("FLAVORPRESS_ANTHROPIC_PROXY_URL", "https://ai-gateway.test/v1");
    vi.stubEnv("FLAVORPRESS_ANTHROPIC_PROXY_TOKEN", "server-token");

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("plain text", { status: 200 })));

    const { client } = await createAnthropicApiClientForUser("user-1");
    await expect(async () => {
      for await (const _event of client!.messages.stream({
        model: "claude-test",
        max_tokens: 32,
        messages: [{ role: "user", content: "hello" }],
      })) {
        // exhaust stream
      }
    }).rejects.toThrow(/neither SSE nor JSON/);
  });
});
