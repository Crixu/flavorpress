"use client";

import { useState, useTransition } from "react";
import {
  startWPAuthorizeAction,
  connectOutletManualAction,
} from "@/lib/v1/actions";
import { SideSheet, Button, Field } from "@/components/wpds";

interface Props {
  open: boolean;
  onClose: () => void;
  authorizeAvailable: boolean;
}

function isNextRedirect(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "digest" in err &&
    typeof err.digest === "string" &&
    err.digest.startsWith("NEXT_REDIRECT;")
  );
}

export function ConnectOutletSheet({ open, onClose, authorizeAvailable }: Props) {
  const [baseUrl, setBaseUrl] = useState("");
  const [username, setUsername] = useState("");
  const [appPassword, setAppPassword] = useState("");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleAuthorize() {
    setError(null);
    start(async () => {
      const fd = new FormData();
      fd.set("baseUrl", baseUrl);
      try {
        await startWPAuthorizeAction(fd);
      } catch (err) {
        if (isNextRedirect(err)) throw err;
        setError(err instanceof Error ? err.message : "Authorization failed");
      }
    });
  }

  function handleManual() {
    setError(null);
    start(async () => {
      const fd = new FormData();
      fd.set("baseUrl", baseUrl);
      fd.set("username", username);
      fd.set("appPassword", appPassword);
      try {
        await connectOutletManualAction(fd);
        onClose();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Connection failed");
      }
    });
  }

  return (
    <SideSheet
      open={open}
      onClose={onClose}
      title="Connect WordPress site"
      footer={
        <>
          <span style={{ flex: 1 }} />
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
        </>
      }
    >
      <Field label="Site URL">
        <input
          type="url"
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          placeholder="https://example.com"
        />
      </Field>

      {authorizeAvailable ? (
        <div
          style={{
            margin: "18px 0",
            padding: "16px",
            background: "var(--surface-subtle)",
            borderRadius: "var(--radius-md)",
            border: "1px solid var(--border-default)",
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>
            Option A - One-click authorize
          </div>
          <div style={{ fontSize: 11, color: "var(--ink-tertiary)", marginBottom: 10 }}>
            Sends you to your WordPress site to approve FlavorPress. WordPress generates the
            Application Password and sends you back here.
          </div>
          <Button
            onClick={handleAuthorize}
            disabled={!baseUrl || pending}
          >
            Authorize on WordPress
          </Button>
        </div>
      ) : null}

      <div
        style={{
          padding: "16px",
          background: "var(--surface-subtle)",
          borderRadius: "var(--radius-md)",
          border: "1px solid var(--border-default)",
        }}
      >
        <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>
          {authorizeAvailable ? "Option B - Application password" : "Application password"}
        </div>
        <div style={{ fontSize: 11, color: "var(--ink-tertiary)", marginBottom: 12 }}>
          Open{" "}
          <code
            style={{
              background: "var(--surface-tag)",
              padding: "1px 4px",
              borderRadius: "var(--radius-sm)",
            }}
          >
            /wp-admin/users.php?page=profile
          </code>{" "}
          on your site, create an Application Password named &quot;FlavorPress&quot;, and paste it
          here.
        </div>
        <Field label="Username">
          <input value={username} onChange={(e) => setUsername(e.target.value)} />
        </Field>
        <Field label="Application password">
          <input
            type="password"
            value={appPassword}
            onChange={(e) => setAppPassword(e.target.value)}
            placeholder="xxxx xxxx xxxx xxxx xxxx xxxx"
          />
        </Field>
        <Button
          onClick={handleManual}
          disabled={!baseUrl || !username || !appPassword || pending}
        >
          Connect manually
        </Button>
      </div>

      {error ? (
        <div
          style={{
            marginTop: 16,
            padding: 12,
            background: "var(--error-bg)",
            color: "var(--error-fg)",
            borderRadius: "var(--radius-md)",
            fontSize: 12,
          }}
        >
          {error}
        </div>
      ) : null}
    </SideSheet>
  );
}
