import { redirect } from "next/navigation";
import { Card, Field, SubmitButton, Notice } from "@/components/wpds";
import { isLocalAuthMode } from "@/lib/session";
import { isWpcomOAuthConfigured } from "@/lib/wpcom-oauth";
import { AuthLogo } from "../_components/AuthLogo";
import { loginAction } from "./actions";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{
    error?: string;
    next?: string;
  }>;
}

const errorMessages: Record<string, string> = {
  credentials: "Invalid credentials.",
  origin: "This sign-in request did not come from this FlavorPress app.",
  oauth_state: "The sign-in link expired or was tampered with. Try again.",
  oauth: "WordPress.com sign-in failed. Try again.",
};

export default async function LoginPage({ searchParams }: PageProps) {
  if (isLocalAuthMode()) redirect("/");
  const sp = await searchParams;
  const next = typeof sp.next === "string" ? sp.next : "/";
  const error = sp.error ? errorMessages[sp.error] : null;
  const oauthEnabled = isWpcomOAuthConfigured();

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
          <AuthLogo />
          <h1
            style={{
              fontFamily: "var(--font-serif), Georgia, serif",
              fontSize: 30,
              fontWeight: 500,
              letterSpacing: "-0.01em",
              margin: "0 0 6px",
              color: "var(--ink-primary)",
            }}
          >
            Sign in to FlavorPress
          </h1>
          <p
            style={{
              fontSize: 13,
              color: "var(--ink-tertiary)",
              fontStyle: "italic",
              margin: 0,
            }}
          >
            Your reading becomes your writing.
          </p>
        </header>

        <Card>
          {error ? (
            <div style={{ marginBottom: 14 }}>
              <Notice tone="error">{error}</Notice>
            </div>
          ) : null}

          <form action={loginAction}>
            <input type="hidden" name="next" value={next} />
            <Field label="Email">
              <input name="email" type="email" autoComplete="email" required autoFocus />
            </Field>
            <Field label="Password">
              <input name="password" type="password" autoComplete="current-password" required />
            </Field>
            <SubmitButton
              style={{ width: "100%", justifyContent: "center" }}
              pendingLabel="Signing in…"
            >
              Sign in
            </SubmitButton>
          </form>
          {oauthEnabled ? (
            <div style={{ marginTop: 16, textAlign: "center" }}>
              <a
                href="/api/auth/wpcom?mode=login"
                style={{
                  display: "inline-block",
                  padding: "8px 16px",
                  border: "1px solid var(--ink-tertiary)",
                  borderRadius: 6,
                  textDecoration: "none",
                  color: "var(--ink-primary)",
                  fontSize: 14,
                }}
              >
                Sign in with WordPress.com
              </a>
            </div>
          ) : null}
        </Card>
      </div>
    </div>
  );
}
