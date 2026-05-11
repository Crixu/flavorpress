"use client";

import { useState } from "react";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { startClusterPassAction } from "@/lib/v1/actions";
import { Button } from "@/components/wpds";

export function LookForClustersButton() {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [itemsQueued, setItemsQueued] = useState<number | null>(null);
  return (
    <div className="flex items-center gap-2">
      {running ? (
        <span
          className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px]"
          style={{
            background: "var(--surface)",
            border: "1px solid var(--border)",
            color: "var(--fg-muted)",
          }}
          role="status"
          aria-live="polite"
        >
          <span className="fp-spinner" aria-hidden />
          <span>
            {itemsQueued === null
              ? "Looking"
              : itemsQueued === 0
                ? "No unclustered items"
                : `Checking ${itemsQueued} ${itemsQueued === 1 ? "item" : "items"}`}
          </span>
        </span>
      ) : null}
      <Button
        variant="secondary"
        disabled={pending}
        onClick={() => {
          setRunning(true);
          startTransition(async () => {
            const result = await startClusterPassAction();
            setItemsQueued(result.itemsQueued);
            router.refresh();
            window.setTimeout(() => setRunning(false), 25_000);
          });
        }}
      >
        {pending ? "Starting" : "Look for new clusters"}
      </Button>
    </div>
  );
}
