import type { ReactNode } from "react";
import "./Field.css";

interface Props {
  label: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
}

export function Field({ label, hint, children }: Props) {
  return (
    <div className="wpds-field">
      <label className="wpds-field-label">{label}</label>
      {children}
      {hint && <div className="wpds-field-hint">{hint}</div>}
    </div>
  );
}
