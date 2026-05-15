import "server-only";

import { db, ensureSchema } from "./db";

const WEBHOOK_URL_ENV = "FLAVORPRESS_NOTIFICATION_WEBHOOK_URL";
const DELIVERY_TIMEOUT_MS = 5000;

export type NotificationWebhookEvent =
  | "signup.email"
  | "site.first_connected"
  | "source.first_connected"
  | "draft.first_created"
  | "post.pushed"
  | "post.first_pushed";

interface NotificationPayload {
  event: NotificationWebhookEvent;
  eventKey: string;
  occurredAt: number;
  user: {
    id: string;
    email: string | null;
  };
  data: Record<string, unknown>;
}

export async function notifySignupWithEmail(input: {
  userId: string;
  email: string;
  method: "email" | "wpcom";
}): Promise<void> {
  await sendNotificationOnce("signup.email", `signup.email:${input.userId}`, input.userId, {
    email: input.email,
    method: input.method,
  });
}

export async function notifyFirstSiteConnected(input: {
  userId: string;
  outletId: string;
  baseUrl: string;
  displayName: string | null;
  kind: string | null;
}): Promise<void> {
  await sendNotificationOnce(
    "site.first_connected",
    `site.first_connected:${input.userId}`,
    input.userId,
    {
      outletId: input.outletId,
      baseUrl: input.baseUrl,
      displayName: input.displayName,
      kind: input.kind,
    },
  );
}

export async function notifyFirstSourceConnected(input: {
  userId: string;
  sourceId: string;
  kind: string;
  url: string;
  displayName: string | null;
  folderId: string | null;
  addedCount: number;
}): Promise<void> {
  await sendNotificationOnce(
    "source.first_connected",
    `source.first_connected:${input.userId}`,
    input.userId,
    {
      sourceId: input.sourceId,
      kind: input.kind,
      url: input.url,
      displayName: input.displayName,
      folderId: input.folderId,
      addedCount: input.addedCount,
    },
  );
}

export async function notifyFirstDraftCreated(input: {
  userId: string;
  draftId: string;
  clusterId: string;
  outletId: string;
  headline: string;
  voiceMatchScore: number;
}): Promise<void> {
  await sendNotificationOnce(
    "draft.first_created",
    `draft.first_created:${input.userId}`,
    input.userId,
    {
      draftId: input.draftId,
      clusterId: input.clusterId,
      outletId: input.outletId,
      headline: input.headline,
      voiceMatchScore: input.voiceMatchScore,
    },
  );
}

export async function notifyFirstPostPushed(input: {
  userId: string;
  draftId: string;
  clusterId: string | null;
  outletId: string;
  mode: "drafter" | "researcher";
  wpPostId: number;
  editLink: string;
  status: "draft" | "publish" | "future";
}): Promise<void> {
  await sendNotificationOnce(
    "post.first_pushed",
    `post.first_pushed:${input.userId}`,
    input.userId,
    {
      draftId: input.draftId,
      clusterId: input.clusterId,
      outletId: input.outletId,
      mode: input.mode,
      wpPostId: input.wpPostId,
      editLink: input.editLink,
      status: input.status,
    },
  );
}

export async function notifyPostPushed(input: {
  userId: string;
  draftId: string;
  clusterId: string | null;
  outletId: string;
  mode: "drafter" | "researcher";
  wpPostId: number;
  editLink: string;
  status: "draft" | "publish" | "future";
}): Promise<void> {
  await sendNotificationOnce(
    "post.pushed",
    `post.pushed:${input.draftId}:${input.wpPostId}`,
    input.userId,
    {
      draftId: input.draftId,
      clusterId: input.clusterId,
      outletId: input.outletId,
      mode: input.mode,
      wpPostId: input.wpPostId,
      editLink: input.editLink,
      status: input.status,
    },
  );
}

async function sendNotificationOnce(
  event: NotificationWebhookEvent,
  eventKey: string,
  userId: string,
  data: Record<string, unknown>,
): Promise<void> {
  try {
    const url = notificationWebhookUrl();
    if (!url) return;

    await ensureSchema();
    const occurredAt = Date.now();
    const user = await loadUserIdentity(userId);
    const payload: NotificationPayload = {
      event,
      eventKey,
      occurredAt,
      user,
      data,
    };

    const payloadJson = JSON.stringify(payload);
    const existing = await db.execute({
      sql: "SELECT status FROM notification_webhook_deliveries WHERE event_key = ?",
      args: [eventKey],
    });
    if (existing.rows.length > 0) {
      const status = existing.rows[0]?.status;
      if (isDeliveredStatus(status)) return;
      await db.execute({
        sql: `UPDATE notification_webhook_deliveries
              SET user_id = ?, event_type = ?, payload = ?,
                  status = NULL, error = NULL, delivered_at = NULL
              WHERE event_key = ?`,
        args: [userId, event, payloadJson, eventKey],
      });
    } else {
      await db.execute({
        sql: `INSERT INTO notification_webhook_deliveries
              (event_key, user_id, event_type, payload, created_at)
              VALUES (?, ?, ?, ?, ?)`,
        args: [eventKey, userId, event, payloadJson, occurredAt],
      });
    }

    const result = await deliverWebhook(url, payload);
    if (result.error) {
      console.warn(`[notifications] ${event} delivery failed`, {
        eventKey,
        status: result.status,
        error: result.error,
      });
    }
    await db.execute({
      sql: `UPDATE notification_webhook_deliveries
            SET status = ?, error = ?, delivered_at = ?
            WHERE event_key = ?`,
      args: [result.status, result.error, Date.now(), eventKey],
    });
  } catch (err) {
    console.warn(`[notifications] failed to send ${event}`, err);
  }
}

function isDeliveredStatus(status: unknown): boolean {
  const n = Number(status);
  return Number.isInteger(n) && n >= 200 && n < 300;
}

function notificationWebhookUrl(): URL | null {
  const raw = process.env[WEBHOOK_URL_ENV]?.trim();
  if (!raw) return null;
  try {
    return new URL(raw);
  } catch {
    console.warn(`[notifications] ${WEBHOOK_URL_ENV} is not a valid URL.`);
    return null;
  }
}

async function loadUserIdentity(userId: string): Promise<NotificationPayload["user"]> {
  const r = await db.execute({
    sql: "SELECT email FROM users WHERE id = ?",
    args: [userId],
  });
  const email = r.rows[0]?.email;
  return {
    id: userId,
    email: email == null ? null : String(email),
  };
}

async function deliverWebhook(
  url: URL,
  payload: NotificationPayload,
): Promise<{ status: number | null; error: string | null }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": "FlavorPress/notification-webhook",
        "x-flavorpress-event": payload.event,
        "x-flavorpress-delivery": payload.eventKey,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (res.ok) return { status: res.status, error: null };
    return { status: res.status, error: await responseError(res) };
  } catch (err) {
    return {
      status: null,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function responseError(res: Response): Promise<string> {
  try {
    const text = await res.text();
    return text.slice(0, 500) || res.statusText || "Webhook returned a non-2xx response.";
  } catch {
    return res.statusText || "Webhook returned a non-2xx response.";
  }
}
