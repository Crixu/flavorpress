"use client";

import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
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
  // Portal to document.body so the sheet escapes any ancestor that creates
  // a containing block for fixed positioning (e.g. cluster cards set
  // view-transition-name, which traps position: fixed inside the card).
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    document.body.setAttribute("data-wpds-sheet-open", "true");
    document.body.style.setProperty("--wpds-sheet-width", `${width}px`);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.removeAttribute("data-wpds-sheet-open");
      document.body.style.removeProperty("--wpds-sheet-width");
    };
  }, [open, onClose, width]);

  if (!open) return null;
  const sheet = (
    <>
      <div className="wpds-sidesheet-scrim" data-testid="wpds-sidesheet-scrim" onClick={onClose} />
      <aside className="wpds-sidesheet" style={{ width }}>
        <header className="wpds-sidesheet-h">
          <h3 className="wpds-sidesheet-title">{title}</h3>
          <button type="button" className="wpds-sidesheet-x" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>
        <div className="wpds-sidesheet-body">{children}</div>
        {footer && <footer className="wpds-sidesheet-foot">{footer}</footer>}
      </aside>
    </>
  );
  if (typeof document === "undefined") return null;
  return createPortal(sheet, document.body);
}
