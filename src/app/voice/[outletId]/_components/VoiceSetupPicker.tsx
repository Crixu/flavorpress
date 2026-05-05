"use client";
import { useState } from "react";
import { FreeWritePanel } from "./FreeWritePanel";
import { InterviewPanel } from "./InterviewPanel";
import { PastePanel } from "./PastePanel";

type Tab = "freewrite" | "interview" | "paste";

const TABS: { key: Tab; label: string; blurb: string }[] = [
  { key: "freewrite", label: "Free-write", blurb: "Write fresh prose, ~10 minutes." },
  { key: "interview", label: "Interview", blurb: "Answer 7 voice-print questions." },
  { key: "paste", label: "Paste", blurb: "Already have prose? Paste it." },
];

export function VoiceSetupPicker({
  outletId,
  hasProfile,
  defaultTab = "freewrite",
}: {
  outletId: string;
  hasProfile: boolean;
  defaultTab?: Tab;
}) {
  const [tab, setTab] = useState<Tab>(defaultTab);
  return (
    <div className="space-y-4">
      <div
        className="flex flex-wrap gap-1 rounded-md p-1"
        style={{ background: "var(--bg-subtle)", border: "1px solid var(--border)" }}
      >
        {TABS.map((t) => {
          const active = t.key === tab;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className="flex-1 rounded px-3 py-2 text-[13px] font-medium transition"
              style={{
                background: active ? "var(--bg)" : "transparent",
                color: active ? "var(--fg)" : "var(--fg-muted)",
                boxShadow: active ? "0 1px 2px rgba(0,0,0,0.04)" : "none",
              }}
            >
              {t.label}
            </button>
          );
        })}
      </div>
      <p className="text-[12px]" style={{ color: "var(--fg-muted)" }}>
        {TABS.find((t) => t.key === tab)?.blurb}
      </p>
      {tab === "freewrite" ? <FreeWritePanel outletId={outletId} hasProfile={hasProfile} /> : null}
      {tab === "interview" ? <InterviewPanel outletId={outletId} hasProfile={hasProfile} /> : null}
      {tab === "paste" ? <PastePanel outletId={outletId} hasProfile={hasProfile} /> : null}
    </div>
  );
}
