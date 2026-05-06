import type { ReactNode } from "react";
import "./StatusBadge.css";

export type StatusBadgeTone = "ok" | "warn" | "error" | "default-outlet";

interface Props {
  status: StatusBadgeTone;
  children: ReactNode;
}

export function StatusBadge({ status, children }: Props) {
  return <span className={`wpds-badge wpds-badge-${status}`}>{children}</span>;
}
