"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";
import "./Button.css";

export type ButtonVariant = "primary" | "secondary" | "danger" | "link";
export type ButtonSize = "sm" | "md";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  children: ReactNode;
}

export function Button({
  variant = "primary",
  size = "md",
  className = "",
  children,
  ...rest
}: Props) {
  const classes = [
    "wpds-btn",
    `wpds-btn-${variant}`,
    size === "sm" ? "wpds-btn-sm" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <button className={classes} {...rest}>
      {children}
    </button>
  );
}
