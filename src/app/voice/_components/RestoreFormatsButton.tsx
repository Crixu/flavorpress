"use client";

import { SubmitButton } from "@/app/_components/SubmitButton";
import { restoreDefaultOutletFormatsAction } from "@/lib/v1/actions";

interface Props {
  outletId: string;
  hasCustomizations: boolean;
}

export function RestoreFormatsButton({ outletId, hasCustomizations }: Props) {
  return (
    <form
      action={restoreDefaultOutletFormatsAction}
      onSubmit={(event) => {
        const message = hasCustomizations
          ? "Restore the default draft formats? Your custom formats and any edits to preset instructions will be deleted."
          : "Restore the default draft formats for this outlet?";
        const ok = window.confirm(message);
        if (!ok) event.preventDefault();
      }}
    >
      <input type="hidden" name="outletId" value={outletId} />
      <SubmitButton className="fp-btn fp-btn-danger" pendingLabel="Restoring">
        Restore defaults
      </SubmitButton>
    </form>
  );
}
