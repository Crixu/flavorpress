import type { HTMLAttributes, ReactNode } from "react";
import "./Card.css";

interface Props extends HTMLAttributes<HTMLDivElement> {
  emphasis?: boolean;
  children: ReactNode;
}

export function Card({ emphasis, className = "", children, ...rest }: Props) {
  const classes = ["wpds-card", emphasis ? "wpds-card-emphasis" : "", className]
    .filter(Boolean)
    .join(" ");
  return (
    <div className={classes} {...rest}>
      {children}
    </div>
  );
}
