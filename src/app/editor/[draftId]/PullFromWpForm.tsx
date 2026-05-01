import { pullFromWPAction } from "@/lib/v1/actions";
import { SubmitButton } from "@/app/_components/SubmitButton";
import type { CSSProperties, ReactNode } from "react";

interface Props {
  draftId: string;
  className?: string;
  style?: CSSProperties;
  pendingLabel?: ReactNode;
  children: ReactNode;
}

export function PullFromWpForm({
  draftId,
  className,
  style,
  pendingLabel = "Pulling",
  children,
}: Props) {
  return (
    <form action={pullFromWPAction}>
      <input type="hidden" name="draftId" value={draftId} />
      <SubmitButton className={className} style={style} pendingLabel={pendingLabel}>
        {children}
      </SubmitButton>
    </form>
  );
}
