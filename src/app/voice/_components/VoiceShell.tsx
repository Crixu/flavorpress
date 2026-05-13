"use client";

import { useState, type ReactNode } from "react";
import { MasterDetail } from "@/components/wpds";
import { OutletSidebar } from "./OutletSidebar";
import { ConnectOutletSheet } from "./ConnectOutletSheet";

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
  authorizeAvailable: boolean;
  wpcomAvailable: boolean;
  children: ReactNode;
}

export function VoiceShell({
  outlets,
  selectedId,
  authorizeAvailable,
  wpcomAvailable,
  children,
}: Props) {
  const [sheetOpen, setSheetOpen] = useState(false);

  return (
    <>
      <MasterDetail
        sidebar={
          <OutletSidebar
            outlets={outlets}
            selectedId={selectedId}
            onConnectClick={() => setSheetOpen(true)}
          />
        }
        sidebarWidth={240}
      >
        {children}
      </MasterDetail>

      <ConnectOutletSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        authorizeAvailable={authorizeAvailable}
        wpcomAvailable={wpcomAvailable}
      />
    </>
  );
}
