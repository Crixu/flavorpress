"use client";

import Link from "next/link";

const ITEMS = [
  { key: "authentication", label: "Authentication", hint: "API key / Claude login" },
  { key: "models", label: "Models", hint: "Anthropic model" },
  { key: "extensions", label: "Extensions", hint: "Toggle and configure" },
  { key: "library", label: "Library", hint: "Maintenance · export · clear" },
];

const WORKFLOW_ITEM = {
  key: "workflow-autopublish",
  label: "Workflow autopublish",
  hint: "Cadence · logs · outlets",
};

interface Props {
  active: string;
  showAdmin?: boolean;
  showWorkflowAutopublish?: boolean;
}

export function SettingsSidebar({
  active,
  showAdmin = false,
  showWorkflowAutopublish = false,
}: Props) {
  const items = showWorkflowAutopublish ? [...ITEMS, WORKFLOW_ITEM] : ITEMS;
  return (
    <div className="fp-settings-side">
      <h5 className="fp-settings-side-h">Settings</h5>
      {items.map((item) => (
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
        <Link
          href="/settings/admin"
          className={`fp-settings-item ${active === "admin" ? "on" : ""}`}
        >
          <div className="fp-settings-item-label">Admin</div>
          <div className="fp-settings-item-hint">Users · plans · sources</div>
        </Link>
      ) : null}
    </div>
  );
}
