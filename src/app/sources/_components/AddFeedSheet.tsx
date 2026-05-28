"use client";

/**
 * Side-sheet for adding feeds to the source list.
 *
 * Three entry paths: paste URLs (one per line), OPML upload (delegates to
 * the existing OpmlImportButton picker), and starter packs (pre-filled URL
 * sets). The OPML upload button opens the existing OpmlImportButton flow in
 * its own modal; the AddFeedSheet stays open behind it.
 *
 * Starter packs copy URLs into the paste textarea so the user still reviews
 * what they're importing.
 */

import { useState, useTransition } from "react";
import { addSourceResultAction } from "@/lib/v1/actions";
import { SideSheet } from "@/components/wpds/SideSheet";
import { Button } from "@/components/wpds/Button";
import { Field } from "@/components/wpds/Field";
import { OpmlImportButton } from "./OpmlImportButton";

const STARTER_PACKS: { id: string; label: string; urls: string[] }[] = [
  {
    id: "indie-tech",
    label: "Indie tech",
    urls: [
      "https://stratechery.com/feed",
      "https://www.theverge.com/rss/index.xml",
      "https://hnrss.org/frontpage",
      "https://ma.tt/rss",
      "https://daringfireball.net/feeds/main",
    ],
  },
  {
    id: "apple-blogger",
    label: "Apple-blogger",
    urls: [
      "https://9to5mac.com/feed/",
      "https://appleinsider.com/rss/news",
      "https://feeds.macrumors.com/MacRumors-Front",
      "https://daringfireball.net/feeds/main",
      "https://feedpress.me/sixcolors",
    ],
  },
  {
    id: "specialty-coffee",
    label: "Specialty coffee",
    urls: [
      "https://sprudge.com/feed",
      "https://dailycoffeenews.com/feed",
      "https://reddit.com/r/specialtycoffee/.rss",
    ],
  },
  {
    id: "ai-ecosystem",
    label: "AI ecosystem",
    urls: [
      "https://www.anthropic.com/news/rss.xml",
      "https://openai.com/blog/rss.xml",
      "https://www.latent.space/feed",
      "https://newsletter.pragmaticengineer.com/feed",
    ],
  },
];

interface Props {
  open: boolean;
  onClose: () => void;
  folders: { id: string; name: string }[];
  currentFolderId?: string | null;
  sourceCount: number;
  sourceLimit: number;
}

export function AddFeedSheet({
  open,
  onClose,
  folders,
  currentFolderId,
  sourceCount,
  sourceLimit,
}: Props) {
  const [urls, setUrls] = useState("");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const remainingSources = Math.max(0, sourceLimit - sourceCount);

  function loadPack(packUrls: string[]) {
    setUrls((prev) => {
      const existing = prev
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);
      const merged = Array.from(new Set([...existing, ...packUrls]));
      return merged.join("\n");
    });
  }

  function submit() {
    setError(null);
    const lines = urls
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length === 0) {
      setError("Paste at least one feed URL.");
      return;
    }
    start(async () => {
      const fd = new FormData();
      fd.set("urls", lines.join("\n"));
      if (currentFolderId) fd.set("folderId", currentFolderId);
      const result = await addSourceResultAction(fd);
      if (!result.ok) {
        setError(result.error ?? "Could not add feed.");
        return;
      }
      setUrls("");
      onClose();
    });
  }

  return (
    <SideSheet
      open={open}
      onClose={onClose}
      title="Add feeds"
      footer={
        <>
          <span style={{ flex: 1 }} />
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={pending}>
            {pending ? "Adding..." : "Add feeds"}
          </Button>
        </>
      }
    >
      <Field label="Paste feed URLs (one per line)">
        <textarea
          rows={6}
          value={urls}
          onChange={(e) => setUrls(e.target.value)}
          placeholder={"https://example.com/feed\nhttps://another.com/rss"}
          style={{
            width: "100%",
            fontFamily: "monospace",
            fontSize: 12,
            borderRadius: "var(--radius-sm)",
            border: "1px solid var(--border-input)",
            padding: "8px 10px",
            resize: "vertical",
          }}
        />
      </Field>
      <div style={{ color: "var(--ink-muted)", fontSize: 11, marginTop: -6, marginBottom: 12 }}>
        {remainingSources} source{remainingSources === 1 ? "" : "s"} left on this plan.
      </div>

      {error ? (
        <div style={{ color: "var(--error-fg)", fontSize: 12, marginBottom: 12 }}>{error}</div>
      ) : null}

      <div style={{ marginBottom: 20 }}>
        <div
          style={{
            fontSize: 11,
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            color: "var(--ink-muted)",
            fontWeight: 600,
            marginBottom: 6,
          }}
        >
          Or import OPML
        </div>
        <OpmlImportButton
          folders={folders}
          currentFolderId={currentFolderId}
          sourceRemaining={remainingSources}
        />
        <p style={{ fontSize: 11, color: "var(--ink-muted)", marginTop: 6, lineHeight: 1.5 }}>
          Export your subscriptions from Feedly, Inoreader, or NetNewsWire and import here.
        </p>
      </div>

      <div>
        <div
          style={{
            fontSize: 11,
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            color: "var(--ink-muted)",
            fontWeight: 600,
            marginBottom: 8,
          }}
        >
          Or start from a pack
        </div>
        <p style={{ fontSize: 11, color: "var(--ink-muted)", marginBottom: 10, lineHeight: 1.5 }}>
          Packs copy URLs into the textarea above so you can review before adding.
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {STARTER_PACKS.map((p) => (
            <Button key={p.id} variant="secondary" size="sm" onClick={() => loadPack(p.urls)}>
              {p.label}
            </Button>
          ))}
        </div>
      </div>
    </SideSheet>
  );
}
