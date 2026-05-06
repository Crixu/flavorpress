"use client";

import { useTransition } from "react";
import { runClusterPassAction } from "@/lib/v1/actions";
import { Button } from "@/components/wpds";

export function LookForClustersButton() {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="secondary"
      disabled={pending}
      onClick={() => {
        startTransition(async () => {
          await runClusterPassAction();
        });
      }}
    >
      {pending ? "Looking…" : "Look for new clusters"}
    </Button>
  );
}
