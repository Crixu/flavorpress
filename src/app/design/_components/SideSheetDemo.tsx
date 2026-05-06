"use client";

import { useState } from "react";
import { Button, SideSheet } from "@/components/wpds";

export function SideSheetDemo() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        Open side sheet
      </Button>
      <SideSheet
        open={open}
        onClose={() => setOpen(false)}
        title="Add feed"
        footer={
          <div style={{ display: "flex", gap: 8 }}>
            <Button onClick={() => setOpen(false)}>Add</Button>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        }
      >
        <p style={{ fontSize: 13, color: "var(--ink-secondary)", lineHeight: 1.6 }}>
          Right-side overlay, 480px wide. Closes on Escape and scrim click. Title
          renders in Newsreader. Footer pinned to bottom with subtle background.
        </p>
        <p style={{ fontSize: 13, color: "var(--ink-secondary)", lineHeight: 1.6, marginTop: 12 }}>
          Use for: Draft Wizard, Add Feed, Connect WP Site, any flow the user must
          complete or cancel without losing the page underneath.
        </p>
      </SideSheet>
    </>
  );
}
