"use client";

import { useRef } from "react";
import { deleteDraftAction } from "@/lib/v1/actions";

interface Props {
  draftId: string;
  confirmMessage: string;
  label: string;
}

export function ConfirmDeleteButton({ draftId, confirmMessage, label }: Props) {
  const formRef = useRef<HTMLFormElement | null>(null);

  return (
    <form
      ref={formRef}
      action={deleteDraftAction}
      onSubmit={(event) => {
        if (!window.confirm(confirmMessage)) {
          event.preventDefault();
        }
      }}
    >
      <input type="hidden" name="draftId" value={draftId} />
      <input type="hidden" name="redirectTo" value="/drafts" />
      <button
        type="submit"
        className="rounded-full px-3 py-1.5 text-[12px] transition hover:underline"
        style={{ color: "var(--fg-subtle)" }}
      >
        {label}
      </button>
    </form>
  );
}
