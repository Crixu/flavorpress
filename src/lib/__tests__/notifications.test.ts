import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db, ensureSchema } from "@/lib/db";
import { notifyPostPushed, notifySignupWithEmail } from "@/lib/notifications";
import { createUser } from "@/lib/users";

describe("notification webhooks", () => {
  beforeEach(async () => {
    await ensureSchema();
    await db.execute("DELETE FROM notification_webhook_deliveries");
    await db.execute("DELETE FROM users");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("posts configured signup webhooks once per event key", async () => {
    vi.stubEnv("FLAVORPRESS_NOTIFICATION_WEBHOOK_URL", "https://hooks.example/flavorpress");
    const fetchMock = vi.fn().mockResolvedValue(new Response("accepted", { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);

    const user = await createUser({
      id: "u_notify",
      email: "writer@example.com",
      passwordHash: null,
    });
    await notifySignupWithEmail({ userId: user.id, email: user.email, method: "email" });
    await notifySignupWithEmail({ userId: user.id, email: user.email, method: "email" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("https://hooks.example/flavorpress");
    expect(init?.method).toBe("POST");
    expect(init?.headers).toMatchObject({
      "content-type": "application/json",
      "x-flavorpress-event": "signup.email",
      "x-flavorpress-delivery": "signup.email:u_notify",
    });
    const payload = JSON.parse(String(init?.body));
    expect(payload).toMatchObject({
      event: "signup.email",
      eventKey: "signup.email:u_notify",
      user: { id: "u_notify", email: "writer@example.com" },
      data: { email: "writer@example.com", method: "email" },
    });

    const deliveries = await db.execute({
      sql: "SELECT status, error FROM notification_webhook_deliveries WHERE event_key = ?",
      args: ["signup.email:u_notify"],
    });
    expect(deliveries.rows[0]?.status).toBe(202);
    expect(deliveries.rows[0]?.error).toBeNull();
  });

  it("retries a previously failed delivery for the same event key", async () => {
    vi.stubEnv("FLAVORPRESS_NOTIFICATION_WEBHOOK_URL", "https://hooks.example/flavorpress");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("nope", { status: 500 }))
      .mockResolvedValueOnce(new Response("accepted", { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);

    const user = await createUser({
      id: "u_retry_hook",
      email: "retry@example.com",
      passwordHash: null,
    });

    await notifySignupWithEmail({ userId: user.id, email: user.email, method: "email" });
    await notifySignupWithEmail({ userId: user.id, email: user.email, method: "email" });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const deliveries = await db.execute({
      sql: "SELECT status, error FROM notification_webhook_deliveries WHERE event_key = ?",
      args: ["signup.email:u_retry_hook"],
    });
    expect(deliveries.rows[0]?.status).toBe(202);
    expect(deliveries.rows[0]?.error).toBeNull();
  });

  it("posts a webhook for each WordPress push event", async () => {
    vi.stubEnv("FLAVORPRESS_NOTIFICATION_WEBHOOK_URL", "https://hooks.example/flavorpress");
    const fetchMock = vi.fn().mockResolvedValue(new Response("accepted", { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);

    const user = await createUser({
      id: "u_push_hook",
      email: "push@example.com",
      passwordHash: null,
    });

    await notifyPostPushed({
      userId: user.id,
      draftId: "d_push_1",
      clusterId: "c_push",
      outletId: "o_push",
      mode: "drafter",
      wpPostId: 101,
      editLink: "https://example.com/wp-admin/post.php?post=101&action=edit",
      status: "draft",
    });
    await notifyPostPushed({
      userId: user.id,
      draftId: "d_push_2",
      clusterId: null,
      outletId: "o_push",
      mode: "researcher",
      wpPostId: 102,
      editLink: "https://example.com/wp-admin/post.php?post=102&action=edit",
      status: "draft",
    });
    await notifyPostPushed({
      userId: user.id,
      draftId: "d_push_2",
      clusterId: null,
      outletId: "o_push",
      mode: "researcher",
      wpPostId: 102,
      editLink: "https://example.com/wp-admin/post.php?post=102&action=edit",
      status: "draft",
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const payloads = fetchMock.mock.calls.map(([, init]) => JSON.parse(String(init?.body)));
    expect(payloads.map((p) => p.eventKey)).toEqual([
      "post.pushed:d_push_1:101",
      "post.pushed:d_push_2:102",
    ]);
    expect(payloads[1]).toMatchObject({
      event: "post.pushed",
      user: { id: "u_push_hook", email: "push@example.com" },
      data: {
        draftId: "d_push_2",
        clusterId: null,
        outletId: "o_push",
        mode: "researcher",
        wpPostId: 102,
        status: "draft",
      },
    });

    const deliveries = await db.execute({
      sql: "SELECT event_key FROM notification_webhook_deliveries WHERE event_type = ? ORDER BY event_key",
      args: ["post.pushed"],
    });
    expect(deliveries.rows.map((r) => r.event_key)).toEqual([
      "post.pushed:d_push_1:101",
      "post.pushed:d_push_2:102",
    ]);
  });

  it("does nothing when the webhook env var is unset", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const user = await createUser({
      id: "u_no_hook",
      email: "writer@example.com",
      passwordHash: null,
    });
    await notifySignupWithEmail({ userId: user.id, email: user.email, method: "email" });

    expect(fetchMock).not.toHaveBeenCalled();
    const deliveries = await db.execute("SELECT 1 FROM notification_webhook_deliveries");
    expect(deliveries.rows).toHaveLength(0);
  });
});
