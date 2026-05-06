import type { ReactNode } from "react";
import "./MasterDetail.css";

interface Props {
  sidebar: ReactNode;
  children: ReactNode;
  sidebarWidth?: number;
}

export function MasterDetail({ sidebar, children, sidebarWidth = 220 }: Props) {
  return (
    <div className="wpds-md">
      <aside className="wpds-md-side" style={{ width: sidebarWidth }}>
        {sidebar}
      </aside>
      <div className="wpds-md-detail">{children}</div>
    </div>
  );
}
