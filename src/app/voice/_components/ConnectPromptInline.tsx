"use client";

import { useState } from "react";
import { Button } from "@/components/wpds";
import { ConnectOutletSheet } from "./ConnectOutletSheet";

interface Props {
  authorizeAvailable: boolean;
  wpcomAvailable: boolean;
}

export function ConnectPromptInline({ authorizeAvailable, wpcomAvailable }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <div className="mt-4">
        <Button onClick={() => setOpen(true)}>+ Connect WordPress site</Button>
      </div>
      <ConnectOutletSheet
        open={open}
        onClose={() => setOpen(false)}
        authorizeAvailable={authorizeAvailable}
        wpcomAvailable={wpcomAvailable}
      />
    </>
  );
}
