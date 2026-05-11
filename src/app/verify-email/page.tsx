export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ status?: string }>;
}

export default async function VerifyEmailStatusPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const isInvalid = sp.status === "invalid";
  return (
    <div style={{ maxWidth: 420, margin: "64px auto", padding: 16, fontFamily: "ui-serif, Georgia, serif" }}>
      <h1 style={{ fontSize: 22, fontWeight: 500 }}>
        {isInvalid ? "Link is invalid or expired" : "Verifying email"}
      </h1>
      <p style={{ color: "var(--ink-tertiary)" }}>
        {isInvalid
          ? "Ask the admin to resend an invite or use the password-reset flow to re-verify."
          : "Open the link from the email we sent you."}
      </p>
    </div>
  );
}
