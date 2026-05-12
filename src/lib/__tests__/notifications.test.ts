import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db, ensureSchema } from "@/lib/db";
import { notifySignupWithEmail } from "@/lib/notifications";
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

    const user = await createUser({ id: "u_notify", email: "writer@example.com", passwordHash: null });
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

  it("does nothing when the webhook env var is unset", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const user = await createUser({ id: "u_no_hook", email: "writer@example.com", passwordHash: null });
    await notifySignupWithEmail({ userId: user.id, email: user.email, method: "email" });

    expect(fetchMock).not.toHaveBeenCalled();
    const deliveries = await db.execute("SELECT 1 FROM notification_webhook_deliveries");
    expect(deliveries.rows).toHaveLength(0);
  });
});
