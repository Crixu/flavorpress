"use client";

import { SubmitButton } from "@/app/_components/SubmitButton";
import { disconnectOutletAction } from "@/lib/v1/actions";

interface Props {
  outletId: string;
  outletName: string;
}

export function DeleteOutletButton({ outletId, outletName }: Props) {
  return (
    <form
      action={disconnectOutletAction}
      onSubmit={(event) => {
        const ok = window.confirm(
          `Delete ${outletName} from FlavorPress? Existing WordPress drafts and posts are not affected.`,
        );
        if (!ok) event.preventDefault();
      }}
    >
      <input type="hidden" name="outletId" value={outletId} />
      <input type="hidden" name="purge" value="1" />
      <input type="hidden" name="redirectTo" value="/voice" />
      <SubmitButton className="fp-btn fp-btn-danger" pendingLabel="Deleting outlet">
        Delete Outlet
      </SubmitButton>
    </form>
  );
}
