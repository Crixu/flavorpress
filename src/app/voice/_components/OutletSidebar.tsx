"use client";

import Link from "next/link";
import { StatusBadge } from "@/components/wpds";

interface OutletItem {
  id: string;
  displayName: string | null;
  baseUrl: string;
  connected: boolean;
  isDefault: boolean;
}

interface Props {
  outlets: OutletItem[];
  selectedId: string | null;
  onConnectClick: () => void;
}

export function OutletSidebar({ outlets, selectedId, onConnectClick }: Props) {
  const sorted = [...outlets].sort((a, b) => {
    if (a.connected !== b.connected) return a.connected ? -1 : 1;
    if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
    return (a.displayName ?? a.baseUrl).localeCompare(b.displayName ?? b.baseUrl);
  });

  return (
    <div className="fp-outlet-side">
      <div className="fp-outlet-side-header">
        <span className="fp-outlet-side-h">Outlets · {outlets.length}</span>
        <button
          type="button"
          className="fp-outlet-add-btn"
          onClick={onConnectClick}
          title="Connect WordPress site"
        >
          + Connect
        </button>
      </div>
      {sorted.map((o) => {
        const active = selectedId === o.id;
        return (
          <Link
            key={o.id}
            href={`/voice/${o.id}`}
            className={`fp-outlet-item${active ? " on" : ""}${!o.connected ? " muted" : ""}`}
          >
            <div className="fp-outlet-name">
              {o.displayName ?? o.baseUrl}
              {o.isDefault && o.connected ? (
                <StatusBadge status="default-outlet">Default</StatusBadge>
              ) : null}
            </div>
            <div className="fp-outlet-url">{o.baseUrl}</div>
            <StatusBadge status={o.connected ? "ok" : "warn"}>
              {o.connected ? "Connected" : "Awaiting auth"}
            </StatusBadge>
          </Link>
        );
      })}
    </div>
  );
}
