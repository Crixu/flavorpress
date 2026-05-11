"use client";

import type { ReactNode, CSSProperties } from "react";
import { useFormStatus } from "react-dom";
import { Button, type ButtonVariant, type ButtonSize } from "./Button";

interface Props {
  /** Default label shown when the form is idle. */
  children: ReactNode;
  /**
   * Label shown while the form action is in flight. Defaults to the idle
   * label followed by an ellipsis. The auth forms pass things like
   * "Signing in…" / "Creating account…".
   */
  pendingLabel?: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  style?: CSSProperties;
  className?: string;
}

/**
 * Submit button that hooks into the parent <form>'s pending state via
 * useFormStatus. While a server action is running, the button is
 * disabled and shows a spinning indicator next to its label so the user
 * sees feedback (Vercel cold-start round-trips can be several seconds).
 */
export function SubmitButton({ children, pendingLabel, variant, size, style, className }: Props) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      variant={variant}
      size={size}
      style={style}
      className={className}
      disabled={pending}
      aria-busy={pending}
    >
      {pending ? (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <Spinner />
          <span>{pendingLabel ?? <>{children}…</>}</span>
        </span>
      ) : (
        children
      )}
    </Button>
  );
}

function Spinner() {
  return (
    <span
      aria-hidden="true"
      style={{
        width: 14,
        height: 14,
        display: "inline-block",
        borderRadius: "50%",
        border: "2px solid currentColor",
        borderTopColor: "transparent",
        animation: "wpds-spinner-spin 0.7s linear infinite",
      }}
    />
  );
}
