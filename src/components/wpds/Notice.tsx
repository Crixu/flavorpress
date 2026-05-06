import type { ReactNode } from "react";
import "./Notice.css";

export type NoticeTone = "info" | "warn" | "error" | "success";

interface Props {
  tone?: NoticeTone;
  children: ReactNode;
}

export function Notice({ tone = "info", children }: Props) {
  return <div className={`wpds-notice wpds-notice-${tone}`}>{children}</div>;
}
