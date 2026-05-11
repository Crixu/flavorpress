import { createHash } from "node:crypto";

export function gravatarUrl(email: string, size = 80): string {
  const hash = createHash("md5").update(email.trim().toLowerCase()).digest("hex");
  const params = new URLSearchParams({
    s: String(size),
    d: "mp",
    r: "g",
  });
  return `https://www.gravatar.com/avatar/${hash}?${params.toString()}`;
}

export function AccountMenu({ email }: { email: string }) {
  return (
    <details className="fp-account-menu">
      <summary className="fp-account-trigger" aria-label="Account menu">
        <span
          aria-hidden="true"
          className="fp-account-avatar"
          style={{ backgroundImage: `url("${gravatarUrl(email)}")` }}
        />
      </summary>
      <div className="fp-account-popover">
        <div className="fp-account-meta">
          <span className="fp-account-label">Signed in as</span>
          <span className="fp-account-email">{email}</span>
        </div>
        <form action="/logout" method="post">
          <button type="submit" className="fp-account-menu-item">
            Log out
          </button>
        </form>
      </div>
    </details>
  );
}
