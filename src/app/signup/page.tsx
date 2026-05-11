import { redirect } from "next/navigation";
import { Card, Field, SubmitButton, Notice } from "@/components/wpds";
import { readInvite } from "@/lib/invites";
import { isLocalAuthMode } from "@/lib/session";
import { isWpcomOAuthConfigured } from "@/lib/wpcom-oauth";
import { signupAction } from "./actions";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{
    invite?: string;
    error?: string;
  }>;
}

const errorMessages: Record<string, string> = {
  invite: "That invitation link is no longer valid.",
  password: "Pick a password with at least 12 characters.",
  email: "Enter a valid email address.",
  account: "Could not create that account.",
  origin: "This sign-up request did not come from this FlavorPress app.",
  oauth_state: "The sign-up link expired or was tampered with. Try again.",
  oauth: "WordPress.com sign-up failed. Try again.",
};

export default async function SignupPage({ searchParams }: PageProps) {
  if (isLocalAuthMode()) redirect("/");
  const sp = await searchParams;
  const invite = typeof sp.invite === "string" ? sp.invite : "";
  const error = sp.error ? errorMessages[sp.error] : null;
  const validInvite = invite ? await readInvite(invite) : null;
  const oauthEnabled = isWpcomOAuthConfigured();

  if (!invite || !validInvite) {
    return (
      <div style={containerStyle}>
        <div style={{ width: "100%", maxWidth: 420 }}>
          <header style={{ marginBottom: 24, textAlign: "center" }}>
            <h1 style={headingStyle}>Invitation required</h1>
            <p style={subtitleStyle}>Ask the FlavorPress admin for an invitation link.</p>
          </header>
          <Card>
            <Notice tone="warn">This page only works with a valid invitation token.</Notice>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div style={containerStyle}>
      <div style={{ width: "100%", maxWidth: 420 }}>
        <header style={{ marginBottom: 24, textAlign: "center" }}>
          <h1 style={headingStyle}>Create your FlavorPress account</h1>
          <p style={subtitleStyle}>You were invited.</p>
        </header>

        <Card>
          {error ? (
            <div style={{ marginBottom: 14 }}>
              <Notice tone="error">{error}</Notice>
            </div>
          ) : null}

          <form action={signupAction}>
            <input type="hidden" name="invite" value={invite} />
            <Field label="Email">
              <input name="email" type="email" autoComplete="email" required autoFocus />
            </Field>
            <Field label="Password (at least 12 characters)">
              <input
                name="password"
                type="password"
                autoComplete="new-password"
                minLength={12}
                required
              />
            </Field>
            <SubmitButton
              style={{ width: "100%", justifyContent: "center" }}
              pendingLabel="Creating account…"
            >
              Create account
            </SubmitButton>
          </form>
          {oauthEnabled ? (
            <div style={{ marginTop: 16, textAlign: "center" }}>
              <a
                href={`/api/auth/wpcom?mode=signup&invite=${encodeURIComponent(invite)}`}
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
                Sign up with WordPress.com
              </a>
            </div>
          ) : null}
        </Card>
      </div>
    </div>
  );
}

const containerStyle: React.CSSProperties = {
  minHeight: "calc(100vh - 92px)",
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "center",
  padding: "64px 16px",
};

const headingStyle: React.CSSProperties = {
  fontFamily: "var(--font-serif), Georgia, serif",
  fontSize: 30,
  fontWeight: 500,
  letterSpacing: "-0.01em",
  margin: "0 0 6px",
  color: "var(--ink-primary)",
};

const subtitleStyle: React.CSSProperties = {
  fontSize: 13,
  color: "var(--ink-tertiary)",
  fontStyle: "italic",
  margin: 0,
};
