"use client";

import Link from "next/link";

export type Bucket = "in-progress" | "notes" | "sent";

interface Props {
  active: Bucket;
  counts: Record<Bucket, number>;
}

const ITEMS: { key: Bucket; label: string }[] = [
  { key: "in-progress", label: "In progress" },
  { key: "notes", label: "Notes" },
  { key: "sent", label: "Sent" },
];

export function BucketTabs({ active, counts }: Props) {
  return (
    <div className="fp-bucket-tabs">
      {ITEMS.map((item) => (
        <Link
          key={item.key}
          href={item.key === "in-progress" ? "/drafts" : `/drafts?bucket=${item.key}`}
          className={`fp-bucket-tab ${active === item.key ? "on" : ""}`}
        >
          {item.label}
          <span className="fp-bucket-tab-count">{counts[item.key]}</span>
        </Link>
      ))}
    </div>
  );
}
