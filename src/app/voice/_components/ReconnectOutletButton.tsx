"use client";

import { useState } from "react";
import { ConnectOutletSheet } from "./ConnectOutletSheet";

interface Props {
  baseUrl: string;
  authorizeAvailable: boolean;
}

export function ReconnectOutletButton({ baseUrl, authorizeAvailable }: Props) {
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
        initialBaseUrl={baseUrl}
        mode="reconnect"
      />
    </>
  );
}
