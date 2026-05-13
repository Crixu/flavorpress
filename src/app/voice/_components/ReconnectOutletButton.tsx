"use client";

import { useState } from "react";
import { ConnectOutletSheet } from "./ConnectOutletSheet";

interface Props {
  baseUrl: string;
  authorizeAvailable: boolean;
  wpcomAvailable: boolean;
}

export function ReconnectOutletButton({ baseUrl, authorizeAvailable, wpcomAvailable }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button type="button" className="fp-btn fp-btn-primary" onClick={() => setOpen(true)}>
        Reconnect WordPress
      </button>
      <ConnectOutletSheet
        key={open ? "open" : "closed"}
        open={open}
        onClose={() => setOpen(false)}
        authorizeAvailable={authorizeAvailable}
        wpcomAvailable={wpcomAvailable}
        canCreateOutlet={true}
        outletLimit={0}
        outletCount={0}
        planLabel=""
        initialBaseUrl={baseUrl}
        mode="reconnect"
      />
    </>
  );
}
