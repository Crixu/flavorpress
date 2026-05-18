import { redirect } from "next/navigation";
import { Card, Field, SubmitButton, Notice } from "@/components/wpds";
import { isLocalAuthMode } from "@/lib/session";
import { confirmPasswordResetAction } from "./actions";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ error?: string }>;
}

const errorMessages: Record<string, string> = {
  token: "This reset link is invalid or expired.",
  password: "Pick a password with at least 12 characters.",
  origin: "This request did not come from this FlavorPress app.",
  rate: "Too many reset attempts. Try again in a minute.",
};

export default async function ResetPasswordConfirmPage({ params, searchParams }: PageProps) {
  if (isLocalAuthMode()) redirect("/");
  const { token } = await params;
  const sp = await searchParams;
  const error = sp.error ? errorMessages[sp.error] : null;

  return (
    <div
      style={{
        minHeight: "calc(100vh - 92px)",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        padding: "64px 16px",
      }}
    >
      <div style={{ width: "100%", maxWidth: 420 }}>
        <header style={{ marginBottom: 24, textAlign: "center" }}>
          <h1
            style={{
              fontFamily: "var(--font-serif), Georgia, serif",
              fontSize: 28,
              fontWeight: 500,
              margin: "0 0 6px",
            }}
          >
            Choose a new password
          </h1>
        </header>
        <Card>
          {error ? (
            <div style={{ marginBottom: 14 }}>
              <Notice tone="error">{error}</Notice>
            </div>
          ) : null}
          <form action={confirmPasswordResetAction}>
            <input type="hidden" name="token" value={token} />
            <Field label="New password (at least 12 characters)">
              <input
                name="password"
                type="password"
                autoComplete="new-password"
                minLength={12}
                required
                autoFocus
              />
            </Field>
            <SubmitButton
              style={{ width: "100%", justifyContent: "center" }}
              pendingLabel="Setting new password…"
            >
              Set new password
            </SubmitButton>
          </form>
        </Card>
      </div>
    </div>
  );
}
