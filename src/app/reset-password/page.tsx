import { redirect } from "next/navigation";
import { Card, Field, SubmitButton, Notice } from "@/components/wpds";
import { isLocalAuthMode } from "@/lib/session";
import { requestPasswordResetAction } from "./actions";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ check?: string; error?: string }>;
}

const errorMessages: Record<string, string> = {
  email: "Enter your email address.",
  origin: "This request did not come from this FlavorPress app.",
};

export default async function ResetPasswordRequestPage({ searchParams }: PageProps) {
  if (isLocalAuthMode()) redirect("/");
  const sp = await searchParams;
  const checked = sp.check === "1";
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
            Reset your password
          </h1>
        </header>
        <Card>
          {checked ? (
            <Notice tone="info">
              If that email is registered, you&apos;ll receive a reset link shortly.
            </Notice>
          ) : (
            <>
              {error ? (
                <div style={{ marginBottom: 14 }}>
                  <Notice tone="error">{error}</Notice>
                </div>
              ) : null}
              <form action={requestPasswordResetAction}>
                <Field label="Email">
                  <input name="email" type="email" autoComplete="email" required autoFocus />
                </Field>
                <SubmitButton
                  style={{ width: "100%", justifyContent: "center" }}
                  pendingLabel="Sending reset link…"
                >
                  Send reset link
                </SubmitButton>
              </form>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
