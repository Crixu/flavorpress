import { parseHTML } from "linkedom";

const ALLOWED_TAGS = new Set([
  "a",
  "blockquote",
  "br",
  "cite",
  "em",
  "h2",
  "h3",
  "li",
  "ol",
  "p",
  "strong",
  "ul",
]);

const DROP_WITH_CONTENT = new Set([
  "frame",
  "frameset",
  "iframe",
  "math",
  "meta",
  "noscript",
  "object",
  "script",
  "style",
  "svg",
  "template",
]);

const ALLOWED_HREF_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

export function sanitizeDraftHtml(html: string): string {
  if (!html) return "";
  const { document } = parseHTML(`<!doctype html><html><body>${html}</body></html>`);
  sanitizeChildren(document.body);
  return document.body.innerHTML.trim();
}

function sanitizeChildren(parent: Node): void {
  for (const child of Array.from(parent.childNodes)) {
    sanitizeNode(child);
  }
}

function sanitizeNode(node: Node): void {
  if (node.nodeType === 8) {
    node.parentNode?.removeChild(node);
    return;
  }

  if (node.nodeType !== 1) return;

  const element = node as Element;
  const tagName = element.tagName.toLowerCase();

  if (DROP_WITH_CONTENT.has(tagName)) {
    element.remove();
    return;
  }

  sanitizeChildren(element);

  if (!ALLOWED_TAGS.has(tagName)) {
    unwrapElement(element);
    return;
  }

  sanitizeAttributes(element, tagName);
}

function unwrapElement(element: Element): void {
  const parent = element.parentNode;
  if (!parent) return;
  while (element.firstChild) {
    parent.insertBefore(element.firstChild, element);
  }
  parent.removeChild(element);
}

function sanitizeAttributes(element: Element, tagName: string): void {
  const href = tagName === "a" ? sanitizeHref(element.getAttribute("href")) : null;

  for (const attr of Array.from(element.attributes)) {
    element.removeAttribute(attr.name);
  }

  if (tagName !== "a") return;
  if (!href) {
    unwrapElement(element);
    return;
  }
  element.setAttribute("href", href);
}

function sanitizeHref(raw: string | null): string | null {
  if (raw === null) return null;
  const href = raw.trim();
  if (!href || /[\u0000-\u001f\u007f\s]/.test(href)) return null;

  try {
    const url = new URL(href);
    if (!ALLOWED_HREF_PROTOCOLS.has(url.protocol.toLowerCase())) return null;
    return href;
  } catch {
    return null;
  }
}
