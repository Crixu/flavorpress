"use client";

import { useActionState, useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { sendNotesToWPAction } from "@/lib/v1/actions";
import { SubmitButton } from "@/app/_components/SubmitButton";
import { stashPublishToast } from "@/app/_components/Toast";

interface Props {
  draftId: string;
  topic: string;
  className?: string;
  pendingLabel: ReactNode;
  children: ReactNode;
}

interface State {
  editLink: string;
  nonce: number;
}

const HANDOFF_BEAT_MS = 800;

export function SendNotesToWpForm({ draftId, topic, className, pendingLabel, children }: Props) {
  const router = useRouter();
  const [sent, setSent] = useState(false);
  const [state, formAction] = useActionState<State | null, FormData>(async (_prev, formData) => {
    const result = await sendNotesToWPAction(formData);
    return { editLink: result.editLink, nonce: Date.now() };
  }, null);

  useEffect(() => {
    if (!state?.editLink) return;
    setSent(true);
    stashPublishToast({
      headline: topic,
      editLink: state.editLink,
      draftId,
      mode: "researcher",
    });
    const id = window.setTimeout(() => {
      router.push("/");
    }, HANDOFF_BEAT_MS);
    return () => window.clearTimeout(id);
  }, [state, topic, draftId, router]);

  if (sent) {
    return (
      <div
        className="flex items-center gap-2 rounded-full px-3 py-2 text-[12px]"
        style={{
          background: "var(--bg-subtle)",
          color: "var(--fg-muted)",
          border: "1px solid var(--border)",
        }}
        aria-live="polite"
      >
        <span aria-hidden style={{ color: "var(--emerald, #2F8F66)" }}>
          ✓
        </span>
        <span>Sent to WordPress</span>
      </div>
    );
  }

  return (
    <form action={formAction}>
      <input type="hidden" name="draftId" value={draftId} />
      <SubmitButton className={className} pendingLabel={pendingLabel}>
        {children}
      </SubmitButton>
    </form>
  );
}
