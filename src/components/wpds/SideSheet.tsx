"use client";

import { useEffect, type ReactNode } from "react";
import "./SideSheet.css";

interface Props {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  width?: number;
  children: ReactNode;
  footer?: ReactNode;
}

export function SideSheet({ open, onClose, title, width = 480, children, footer }: Props) {
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <>
      <div
        className="wpds-sidesheet-scrim"
        data-testid="wpds-sidesheet-scrim"
        onClick={onClose}
      />
      <aside className="wpds-sidesheet" style={{ width }}>
        <header className="wpds-sidesheet-h">
          <h3 className="wpds-sidesheet-title">{title}</h3>
          <button
            type="button"
            className="wpds-sidesheet-x"
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </header>
        <div className="wpds-sidesheet-body">{children}</div>
        {footer && <footer className="wpds-sidesheet-foot">{footer}</footer>}
      </aside>
    </>
  );
}
