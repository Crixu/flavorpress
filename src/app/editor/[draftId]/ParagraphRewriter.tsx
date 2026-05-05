"use client";

/**
 * Per-paragraph "Rewrite in voice" overlay. Walks the rendered article body,
 * tags each top-level `<p>` with its 0-based index, and injects a hover-only
 * button that calls `rewriteDraftParagraphAction` for that paragraph.
 *
 * The article itself is rendered by `ExtensionsArticle` via
 * `dangerouslySetInnerHTML`, so we don't own the React tree of paragraphs.
 * We find the article via `[data-fp-article-draft-id]` and mutate the DOM
 * directly. ExtensionsArticle's mark-wrapping effect runs against text
 * nodes, so adding sibling buttons to each `<p>` doesn't collide with it.
 */

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FACT_CHECK_ID } from "@/extensions/fact-check/types";
import { setActive, setSlice, useActiveSelection } from "@/extensions/store";
import { rewriteDraftParagraphAction } from "@/lib/v1/actions";

interface Props {
  draftId: string;
  /** Bumps the rewrite-button injection effect when the body changes
   *  (e.g., after a successful rewrite revalidates the page). */
  bodyHtml: string;
}

export function ParagraphRewriter({ draftId, bodyHtml }: Props) {
  const router = useRouter();
  const active = useActiveSelection(draftId);
  const [pendingIndex, setPendingIndex] = useState<number | null>(null);
  const [, startTransition] = useTransition();
  const pendingIndexRef = useRef<number | null>(null);
  const activeRef = useRef(active);

  useEffect(() => {
    pendingIndexRef.current = pendingIndex;
  }, [pendingIndex]);

  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  useEffect(() => {
    const article = document.querySelector<HTMLElement>(
      `[data-fp-article-draft-id="${cssEscape(draftId)}"]`,
    );
    if (!article) return;

    const cleanups: Array<() => void> = [];
    const paragraphs = Array.from(article.children).filter(
      (el): el is HTMLParagraphElement => el.tagName === "P",
    );

    paragraphs.forEach((p, index) => {
      // Wrap the paragraph in a hover-aware row so the button can sit
      // outside the `<p>`'s box without losing the parent's :hover state
      // when the cursor crosses the gap between paragraph and button.
      const row = document.createElement("div");
      row.className = "fp-para-row";
      row.dataset.fpParaIndex = String(index);
      const parent = p.parentNode;
      if (!parent) return;
      parent.insertBefore(row, p);
      row.appendChild(p);
      p.dataset.fpParaIndex = String(index);

      const button = document.createElement("button");
      button.type = "button";
      button.className = "fp-para-rewrite";
      button.dataset.fpParaIndex = String(index);
      button.title = "Rewrite this paragraph in your voice";
      button.setAttribute("aria-label", "Rewrite paragraph in voice");
      button.textContent = "Rewrite";

      const onClick = (event: MouseEvent) => {
        event.preventDefault();
        event.stopPropagation();
        if (pendingIndexRef.current !== null) return;
        setPendingIndex(index);
        const formData = new FormData();
        formData.set("draftId", draftId);
        formData.set("paragraphIndex", String(index));
        startTransition(async () => {
          try {
            await rewriteDraftParagraphAction(formData);
            setSlice(draftId, FACT_CHECK_ID, {
              annotations: [],
              ranAt: null,
              status: "idle",
              error: null,
            });
            if (activeRef.current?.extensionId === FACT_CHECK_ID) setActive(draftId, null);
            router.refresh();
          } finally {
            setPendingIndex(null);
          }
        });
      };
      button.addEventListener("click", onClick);
      row.appendChild(button);

      cleanups.push(() => {
        button.removeEventListener("click", onClick);
        // Move the paragraph back out of the row, then drop the row, so a
        // subsequent re-injection finds the article's children in the
        // shape ExtensionsArticle expects.
        if (row.parentNode && p.parentNode === row) {
          row.parentNode.insertBefore(p, row);
        }
        if (row.parentNode) row.parentNode.removeChild(row);
        delete p.dataset.fpParaIndex;
      });
    });

    return () => {
      for (const fn of cleanups) fn();
    };
  }, [draftId, bodyHtml, router]);

  // Reflect pending state on the matching paragraph so the user sees the
  // affected block dim while the model rewrites it. We toggle a data
  // attribute and let the CSS rule in globals.css handle visuals.
  useEffect(() => {
    const article = document.querySelector<HTMLElement>(
      `[data-fp-article-draft-id="${cssEscape(draftId)}"]`,
    );
    if (!article) return;
    article.querySelectorAll<HTMLElement>("p[data-fp-para-index]").forEach((p) => {
      const idx = Number(p.dataset.fpParaIndex);
      p.dataset.fpParaPending = pendingIndex !== null && idx === pendingIndex ? "1" : "0";
    });
  }, [pendingIndex, bodyHtml, draftId]);

  return null;
}

function cssEscape(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }
  return value.replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`);
}
