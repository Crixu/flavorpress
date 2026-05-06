import { isAuthConfigured } from "@/lib/auth";
import { loginAction } from "./actions";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{
    error?: string;
    next?: string;
  }>;
}

const errorMessages: Record<string, string> = {
  credentials: "That username and password did not match this FlavorPress app.",
  origin: "This sign-in request did not come from this FlavorPress app.",
};

export default async function LoginPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const next = typeof sp.next === "string" ? sp.next : "/";
  const error = sp.error ? errorMessages[sp.error] : null;
  const configured = isAuthConfigured();

  return (
    <div className="mx-auto max-w-[420px] pt-12">
      <section className="fp-card space-y-6 p-6">
        <header className="space-y-2">
          <div className="fp-eyebrow">Writer access</div>
          <h1 className="fp-h1 fp-h1-serif text-[34px] leading-[1.05]">Sign in to FlavorPress</h1>
          <p className="text-sm leading-relaxed" style={{ color: "var(--fg-muted)" }}>
            One writer, one WordPress site, one protected drafting workspace.
          </p>
        </header>

        {!configured ? (
          <Banner>
            Set <code>FLAVORPRESS_AUTH_USER</code>, <code>FLAVORPRESS_AUTH_PASSWORD</code>, and{" "}
            <code>FLAVORPRESS_SESSION_SECRET</code> before signing in.
          </Banner>
        ) : null}
        {error ? <Banner>{error}</Banner> : null}

        <form action={loginAction} className="space-y-4">
          <input type="hidden" name="next" value={next} />
          <label className="block space-y-1.5 text-sm font-medium">
            <span>Username</span>
            <input
              className="fp-input w-full"
              name="username"
              autoComplete="username"
              required
              autoFocus
            />
          </label>
          <label className="block space-y-1.5 text-sm font-medium">
            <span>Password</span>
            <input
              className="fp-input w-full"
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
          </label>
          <button className="fp-btn fp-btn-primary w-full" type="submit">
            Sign in
          </button>
        </form>
      </section>
    </div>
  );
}

function Banner({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="rounded-[var(--radius-md)] border px-3 py-2 text-sm leading-relaxed"
      style={{
        background: "var(--amber-tint)",
        borderColor: "var(--border)",
        color: "var(--amber)",
      }}
    >
      {children}
    </div>
  );
}
