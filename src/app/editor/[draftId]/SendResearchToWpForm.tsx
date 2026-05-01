"use client";

import { useActionState, useEffect, type ReactNode } from "react";
import { sendResearchToWPAction } from "@/lib/v1/actions";
import { SubmitButton } from "@/app/_components/SubmitButton";

interface Props {
  draftId: string;
  className?: string;
  pendingLabel: ReactNode;
  children: ReactNode;
}

interface State {
  editLink: string;
  nonce: number;
}

export function SendResearchToWpForm({ draftId, className, pendingLabel, children }: Props) {
  const [state, formAction] = useActionState<State | null, FormData>(async (_prev, formData) => {
    const result = await sendResearchToWPAction(formData);
    return { editLink: result.editLink, nonce: Date.now() };
  }, null);

  useEffect(() => {
    if (state?.editLink) {
      window.open(state.editLink, "_blank", "noopener,noreferrer");
    }
  }, [state]);

  return (
    <form action={formAction}>
      <input type="hidden" name="draftId" value={draftId} />
      <SubmitButton className={className} pendingLabel={pendingLabel}>
        {children}
      </SubmitButton>
    </form>
  );
}
