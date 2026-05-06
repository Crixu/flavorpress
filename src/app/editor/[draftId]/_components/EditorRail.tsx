"use client";

import { useState, type ReactNode } from "react";

type RailTab = "sources" | "extensions" | "remix";

interface Source {
  id: string;
  title: string;
  source: string;
  link?: string;
}

interface Props {
  sources: Source[];
  extensions: ReactNode;
  remix: ReactNode;
  extensionAnnotationCount?: number;
}

export function EditorRail({ sources, extensions, remix, extensionAnnotationCount = 0 }: Props) {
  const [tab, setTab] = useState<RailTab>("sources");
  return (
    <aside className="fp-editor-rail">
      <div className="fp-editor-rail-tabs">
        <button
          type="button"
          className={`fp-editor-rail-tab ${tab === "sources" ? "on" : ""}`}
          onClick={() => setTab("sources")}
        >
          Sources <span className="ct">{sources.length}</span>
        </button>
        <button
          type="button"
          className={`fp-editor-rail-tab ${tab === "extensions" ? "on" : ""}`}
          onClick={() => setTab("extensions")}
        >
          Extensions{" "}
          {extensionAnnotationCount > 0 && (
            <span className="ct">{extensionAnnotationCount}</span>
          )}
        </button>
        <button
          type="button"
          className={`fp-editor-rail-tab ${tab === "remix" ? "on" : ""}`}
          onClick={() => setTab("remix")}
        >
          Remix
        </button>
      </div>
      <div className="fp-editor-rail-body">
        {tab === "sources" && (
          <div className="fp-editor-rail-sources">
            {sources.length === 0 && (
              <div className="fp-editor-rail-empty">No sources</div>
            )}
            {sources.map((s) => (
              <a
                key={s.id}
                href={s.link ?? "#"}
                className="fp-editor-rail-source"
                target={s.link ? "_blank" : undefined}
                rel={s.link ? "noopener noreferrer" : undefined}
              >
                <div className="meta">{s.source}</div>
                <div className="ttl">{s.title}</div>
              </a>
            ))}
          </div>
        )}
        {tab === "extensions" && (
          <div className="fp-editor-rail-extensions">{extensions}</div>
        )}
        {tab === "remix" && (
          <div className="fp-editor-rail-remix">{remix}</div>
        )}
      </div>
    </aside>
  );
}
