"use client";

import { useEffect, useState } from "react";

export function AccountMenuClient() {
  const [email, setEmail] = useState<string | null>(null);
  const [showAdmin, setShowAdmin] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/account/me", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((body: { email?: string; showAdmin?: boolean } | null) => {
        if (!cancelled && body?.email) {
          setEmail(body.email);
          setShowAdmin(body.showAdmin === true);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  if (!email) return null;
  return (
    <details className="fp-account-menu">
      <summary className="fp-account-trigger" aria-label="Account menu">
        <span aria-hidden="true" className="fp-account-avatar">
          {email.slice(0, 1).toUpperCase()}
        </span>
      </summary>
      <div className="fp-account-popover">
        <div className="fp-account-meta">
          <span className="fp-account-label">Signed in as</span>
          <span className="fp-account-email">{email}</span>
        </div>
        {showAdmin ? (
          <a href="/settings/admin" className="fp-account-menu-item">
            Admin
          </a>
        ) : null}
        <form action="/logout" method="post">
          <button type="submit" className="fp-account-menu-item">
            Log out
          </button>
        </form>
      </div>
    </details>
  );
}
