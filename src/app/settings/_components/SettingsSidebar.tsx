"use client";

import Link from "next/link";

const ITEMS = [
  { key: "authentication", label: "Authentication", hint: "API key / Claude login" },
  { key: "models", label: "Models", hint: "Anthropic model" },
  { key: "extensions", label: "Extensions", hint: "Toggle and configure" },
  { key: "library", label: "Library", hint: "Maintenance · export · clear" },
];

interface Props {
  active: string;
  showAdmin?: boolean;
}

export function SettingsSidebar({ active, showAdmin = false }: Props) {
  return (
    <div className="fp-settings-side">
      <h5 className="fp-settings-side-h">Settings</h5>
      {ITEMS.map((item) => (
        <Link
          key={item.key}
          href={`/settings?section=${item.key}`}
          className={`fp-settings-item ${active === item.key ? "on" : ""}`}
        >
          <div className="fp-settings-item-label">{item.label}</div>
          <div className="fp-settings-item-hint">{item.hint}</div>
        </Link>
      ))}
      {showAdmin ? (
        <>
          <Link
            href="/settings/admin"
            className={`fp-settings-item ${active === "admin" ? "on" : ""}`}
          >
            <div className="fp-settings-item-label">Admin</div>
            <div className="fp-settings-item-hint">Users · plans · sources</div>
          </Link>
          <Link
            href="/settings/admin/extensions"
            className={`fp-settings-item ${active === "admin-extensions" ? "on" : ""}`}
          >
            <div className="fp-settings-item-label">Admin / Extensions</div>
            <div className="fp-settings-item-hint">Global kill switches</div>
          </Link>
        </>
      ) : null}
    </div>
  );
}
