"use client";

/**
 * Generic article overlay used by every editor extension. Walks the
 * union of annotations across all extensions and wraps each match in
 * a styled <mark>. The mark carries `data-fp-ext` and `data-fp-ann`
 * so click handling can scroll the matching Panel comment card into
 * view via `[data-fp-comment="<extId>:<annId>"]`.
 *
 * Highlight wrapping walks the article as one text stream, then uses a
 * DOM Range so claims can cross inline elements such as links.
 */

import { useEffect, useRef } from "react";
import type { ExtensionAnnotation, InitialAnnotationsByExtension } from "./types";
import { hydrateSlice, setActive, useActiveSelection, useAllAnnotations } from "./store";

interface Props {
  draftId: string;
  bodyHtml: string;
  initialAnnotationsByExt: InitialAnnotationsByExtension;
  enabledExtensionIds: string[];
}

export function ExtensionsArticle({
  draftId,
  bodyHtml,
  initialAnnotationsByExt,
  enabledExtensionIds,
}: Props) {
  const articleRef = useRef<HTMLElement | null>(null);

  for (const [extId, payload] of Object.entries(initialAnnotationsByExt)) {
    hydrateSlice(draftId, extId, payload.annotations, payload.ranAt);
  }

  const all = useAllAnnotations(draftId);
  const active = useActiveSelection(draftId);

  // Re-wrap whenever the annotation set changes. Filter by the enabled
  // set so a slice left over in the module-scoped store from before the
  // user disabled an extension stops painting highlights.
  useEffect(() => {
    const root = articleRef.current;
    if (!root) return;
    unwrapMarks(root);
    const enabled = new Set(enabledExtensionIds);
    const byShortestSpan = all
      .filter((a) => enabled.has(a.extensionId))
      .sort(
        (a, b) =>
          a.annotation.spanText.length - b.annotation.spanText.length ||
          a.annotation.index - b.annotation.index,
      );
    for (const { extensionId, annotation } of byShortestSpan) {
      wrapFirstOccurrence(root, extensionId, annotation);
    }
  }, [all, bodyHtml, enabledExtensionIds]);

  // Toggle active-ring styling on the matching mark.
  useEffect(() => {
    const root = articleRef.current;
    if (!root) return;
    root.querySelectorAll<HTMLElement>("mark[data-fp-ext]").forEach((m) => {
      const isActive =
        active !== null &&
        m.dataset.fpExt === active.extensionId &&
        m.dataset.fpAnn === active.annotationId;
      m.dataset.fpActive = isActive ? "1" : "0";
    });
  }, [active]);

  // Click on a highlight: select it and scroll the matching comment
  // card (rendered by the extension's Panel) into view.
  useEffect(() => {
    const root = articleRef.current;
    if (!root) return;
    function onClick(e: Event) {
      const target = (e.target as HTMLElement).closest("mark[data-fp-ext]") as HTMLElement | null;
      if (!target) return;
      const extensionId = target.dataset.fpExt;
      const annotationId = target.dataset.fpAnn;
      if (!extensionId || !annotationId) return;
      setActive(draftId, { extensionId, annotationId });
      const card = document.querySelector(
        `[data-fp-comment="${cssEscape(extensionId)}:${cssEscape(annotationId)}"]`,
      ) as HTMLElement | null;
      if (card) card.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    root.addEventListener("click", onClick);
    return () => {
      root.removeEventListener("click", onClick);
    };
  }, [draftId]);

  return (
    <article
      ref={articleRef}
      className="prose prose-stone mt-7 max-w-none"
      style={{
        fontFamily: "var(--font-serif), Georgia, serif",
        fontSize: 17.5,
        lineHeight: 1.72,
        color: "var(--fg)",
      }}
      dangerouslySetInnerHTML={{ __html: bodyHtml }}
    />
  );
}

function unwrapMarks(root: HTMLElement): void {
  const marks = root.querySelectorAll("mark[data-fp-ext]");
  marks.forEach((m) => {
    const parent = m.parentNode;
    if (!parent) return;
    while (m.firstChild) parent.insertBefore(m.firstChild, m);
    parent.removeChild(m);
  });
  root.normalize();
}

function wrapFirstOccurrence(
  root: HTMLElement,
  extensionId: string,
  annotation: ExtensionAnnotation,
): boolean {
  const needle = annotation.spanText.toLowerCase();
  if (!needle) return false;
  const stream = collectTextStream(root);
  const i = stream.text.toLowerCase().indexOf(needle);
  if (i === -1) return false;
  const start = findTextPosition(stream.nodes, i);
  const end = findTextPosition(stream.nodes, i + annotation.spanText.length);
  if (!start || !end) return false;
  const range = document.createRange();
  range.setStart(start.node, start.offset);
  range.setEnd(end.node, end.offset);
  if (range.collapsed) return false;
  const mark = createAnnotationMark(extensionId, annotation);
  mark.appendChild(range.extractContents());
  range.insertNode(mark);
  return true;
}

interface TextNodeSpan {
  node: Text;
  start: number;
  end: number;
}

function collectTextStream(root: HTMLElement): {
  text: string;
  nodes: TextNodeSpan[];
} {
  const nodes: TextNodeSpan[] = [];
  let text = "";
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode() as Text | null;
  while (node) {
    if (node.parentElement?.closest("mark[data-fp-ext], script, style, noscript")) {
      node = walker.nextNode() as Text | null;
      continue;
    }
    const value = node.nodeValue ?? "";
    if (value.length > 0) {
      nodes.push({ node, start: text.length, end: text.length + value.length });
      text += value;
    }
    node = walker.nextNode() as Text | null;
  }
  return { text, nodes };
}

function findTextPosition(
  nodes: TextNodeSpan[],
  position: number,
): { node: Text; offset: number } | null {
  for (const n of nodes) {
    if (position >= n.start && position <= n.end) {
      return { node: n.node, offset: position - n.start };
    }
  }
  return null;
}

function createAnnotationMark(extensionId: string, annotation: ExtensionAnnotation): HTMLElement {
  const mark = document.createElement("mark");
  mark.dataset.fpExt = extensionId;
  mark.dataset.fpAnn = annotation.id;
  mark.dataset.fpTone = annotation.tone;
  mark.dataset.fpActive = "0";
  return mark;
}

function cssEscape(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }
  return value.replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`);
}
