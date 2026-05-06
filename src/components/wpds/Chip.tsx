import type { ReactNode } from "react";
import "./Chip.css";

interface Props {
  label: ReactNode;
  count?: number;
  active?: boolean;
  onClick?: () => void;
  className?: string;
}

export function Chip({ label, count, active, onClick, className = "" }: Props) {
  const classes = ["wpds-chip", active ? "on" : "", className].filter(Boolean).join(" ");
  return (
    <button type="button" className={classes} onClick={onClick}>
      <span>{label}</span>
      {count !== undefined && <span className="wpds-chip-count">{count}</span>}
    </button>
  );
}
