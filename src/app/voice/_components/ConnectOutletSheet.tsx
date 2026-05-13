"use client";

import { useState, useTransition } from "react";
import {
  startWPAuthorizeAction,
  startWpcomOutletAuthorizeAction,
  connectOutletManualAction,
} from "@/lib/v1/actions";
import { SideSheet, Button, Field, Notice } from "@/components/wpds";

interface Props {
  open: boolean;
  onClose: () => void;
  authorizeAvailable: boolean;
  wpcomAvailable: boolean;
  canCreateOutlet: boolean;
  outletLimit: number;
  outletCount: number;
  planLabel: string;
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

export function ConnectOutletSheet({
  open,
  onClose,
  authorizeAvailable,
  wpcomAvailable,
  canCreateOutlet,
  outletLimit,
  outletCount,
  planLabel,
}: Props) {
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

  function handleWpcomAuthorize() {
    setError(null);
    start(async () => {
      const fd = new FormData();
      fd.set("baseUrl", baseUrl);
      try {
        await startWpcomOutletAuthorizeAction(fd);
      } catch (err) {
        if (isNextRedirect(err)) throw err;
        setError(err instanceof Error ? err.message : "WordPress.com authorization failed");
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
        if (isNextRedirect(err)) throw err;
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
          disabled={!canCreateOutlet}
        />
      </Field>

      {!canCreateOutlet ? (
        <Notice tone="warn">
          You are using {outletCount} of {outletLimit} outlets on {planLabel}. Remove an outlet or
          ask an admin to raise the cap before connecting another WordPress site.
        </Notice>
      ) : null}

      {wpcomAvailable ? (
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
            Option A - WordPress.com or Jetpack
          </div>
          <div style={{ fontSize: 11, color: "var(--ink-tertiary)", marginBottom: 10 }}>
            Sends you to WordPress.com to approve FlavorPress for this site. Use this for
            WordPress.com sites or self-hosted sites connected through Jetpack.
          </div>
          <Button onClick={handleWpcomAuthorize} disabled={!canCreateOutlet || !baseUrl || pending}>
            Connect with WordPress.com
          </Button>
        </div>
      ) : null}

      {authorizeAvailable ? (
        <div
          style={{
            margin: wpcomAvailable ? "0 0 18px" : "18px 0",
            padding: "16px",
            background: "var(--surface-subtle)",
            borderRadius: "var(--radius-md)",
            border: "1px solid var(--border-default)",
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>
            {wpcomAvailable ? "Option B - Site authorize" : "Option A - Site authorize"}
          </div>
          <div style={{ fontSize: 11, color: "var(--ink-tertiary)", marginBottom: 10 }}>
            Sends you to your WordPress site to approve FlavorPress. WordPress generates the
            Application Password and sends you back here.
          </div>
          <Button onClick={handleAuthorize} disabled={!canCreateOutlet || !baseUrl || pending}>
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
          {authorizeAvailable || wpcomAvailable
            ? "Fallback - Application password"
            : "Application password"}
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
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            disabled={!canCreateOutlet}
          />
        </Field>
        <Field label="Application password">
          <input
            type="password"
            value={appPassword}
            onChange={(e) => setAppPassword(e.target.value)}
            placeholder="xxxx xxxx xxxx xxxx xxxx xxxx"
            disabled={!canCreateOutlet}
          />
        </Field>
        <Button
          onClick={handleManual}
          disabled={!canCreateOutlet || !baseUrl || !username || !appPassword || pending}
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
