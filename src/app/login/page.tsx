import { Card, Field, Button, Notice } from "@/components/wpds";
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
};

export default async function LoginPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const next = typeof sp.next === "string" ? sp.next : "/";
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
            <Button type="submit" style={{ width: "100%", justifyContent: "center" }}>
              Sign in
            </Button>
          </form>
        </Card>
      </div>
    </div>
  );
}
