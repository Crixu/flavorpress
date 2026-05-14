import { redirect } from "next/navigation";
import Link from "next/link";
import { Card, Notice } from "@/components/wpds";
import { isLocalAuthMode } from "@/lib/session";
import { AuthLogo } from "../../_components/AuthLogo";

export const dynamic = "force-dynamic";

export default function SignupCheckEmailPage() {
  if (isLocalAuthMode()) redirect("/");

  return (
    <div style={containerStyle}>
      <div style={{ width: "100%", maxWidth: 420 }}>
        <header style={{ marginBottom: 24, textAlign: "center" }}>
          <AuthLogo />
          <h1 style={headingStyle}>Check your email</h1>
          <p style={subtitleStyle}>Use the next step for this FlavorPress account.</p>
        </header>

        <Card>
          <Notice tone="info">
            If this email can use FlavorPress, the next step is in the inbox. You can also sign in
            or reset the password for an existing account.
          </Notice>
          <div style={{ display: "flex", gap: 12, justifyContent: "center", marginTop: 16 }}>
            <Link href="/login" style={linkStyle}>
              Sign in
            </Link>
            <Link href="/reset-password" style={linkStyle}>
              Reset password
            </Link>
          </div>
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

const linkStyle: React.CSSProperties = {
  color: "var(--ink-primary)",
  fontSize: 14,
};
