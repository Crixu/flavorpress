import "server-only";

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

type EnvLike = Record<string, string | undefined>;

const DEFAULT_HOST = "flavorpress.local";

export function resolveSender(env: EnvLike = process.env): string {
  const override = env.FLAVORPRESS_EMAIL_FROM?.trim();
  if (override) return override;
  const origin = env.FLAVORPRESS_ORIGIN?.trim();
  if (origin) {
    try {
      const host = new URL(origin).host;
      return `FlavorPress <noreply@${host}>`;
    } catch {
      // fall through
    }
  }
  return `FlavorPress <noreply@${DEFAULT_HOST}>`;
}

export async function sendEmail(msg: EmailMessage): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (apiKey) {
    return sendViaResend(msg, apiKey);
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "Email send failed: RESEND_API_KEY is required in production.",
    );
  }
  logToConsole(msg);
}

async function sendViaResend(msg: EmailMessage, apiKey: string): Promise<void> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: resolveSender(),
      to: msg.to,
      subject: msg.subject,
      html: msg.html,
      text: msg.text,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "<unreadable>");
    throw new Error(`Resend send failed (${res.status}): ${body}`);
  }
}

function logToConsole(msg: EmailMessage): void {
  const banner = "=".repeat(60);
  console.info(banner);
  console.info(`[email-fallback] To: ${msg.to}`);
  console.info(`[email-fallback] From: ${resolveSender()}`);
  console.info(`[email-fallback] Subject: ${msg.subject}`);
  console.info(banner);
  console.info(msg.text);
  console.info(banner);
}
