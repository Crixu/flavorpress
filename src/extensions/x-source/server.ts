import "server-only";

/**
 * x-source extension: server half.
 *
 * Reads the configured RSS bridge template from app_settings, parses
 * X handles or profile URLs, and emits the bridge URL to poll. The
 * polling loop itself uses the standard RSS connector because the
 * bridge serves RSS XML, so this extension does not own a poll path.
 *
 * Acceptable inputs:
 *   @handle
 *   https://x.com/handle
 *   https://x.com/handle/status/123
 *   https://twitter.com/handle (and the same with /status/...)
 *   https://www. variants
 */

import type { ExtensionSettingField, ResolvedSource, SourceExtensionEntry } from "../types";
import { getSetting } from "@/lib/v1/settings";
import {
  ERR_TEMPLATE_INVALID,
  ERR_TEMPLATE_NO_PLACEHOLDER,
  X_BRIDGE_TEMPLATE_ENV,
  X_BRIDGE_TEMPLATE_ERROR_MESSAGES,
  X_BRIDGE_TEMPLATE_HINT,
  X_BRIDGE_TEMPLATE_KEY,
  X_BRIDGE_TEMPLATE_PLACEHOLDER,
  X_BRIDGE_TEMPLATE_SAVE_LABEL,
  X_BRIDGE_TEMPLATE_TITLE,
  X_SOURCE_ID,
  X_SOURCE_LABEL,
} from "./types";

const HANDLE_RE = /^[A-Za-z0-9_]{1,15}$/;

export function extractHandle(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith("@")) {
    const rest = trimmed.slice(1);
    return HANDLE_RE.test(rest) ? rest : null;
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (host !== "x.com" && host !== "twitter.com") return null;

  const seg = url.pathname.split("/").filter(Boolean);
  if (seg.length === 0) return null;
  const handle = seg[0]!;
  return HANDLE_RE.test(handle) ? handle : null;
}

export async function getXBridgeTemplate(): Promise<string | null> {
  return (await getSetting(X_BRIDGE_TEMPLATE_KEY)) ?? process.env[X_BRIDGE_TEMPLATE_ENV] ?? null;
}

export function buildBridgeUrl(handle: string, template: string): string {
  if (!template.includes("{handle}")) {
    throw new Error(ERR_TEMPLATE_NO_PLACEHOLDER);
  }
  return template.replace(/\{handle\}/g, handle);
}

function validateBridgeTemplate(value: string): string | null {
  if (!/^https?:\/\//i.test(value)) return ERR_TEMPLATE_INVALID;
  if (!value.includes("{handle}")) return ERR_TEMPLATE_INVALID;
  return null;
}

const bridgeTemplateField: ExtensionSettingField = {
  key: X_BRIDGE_TEMPLATE_KEY,
  envVar: X_BRIDGE_TEMPLATE_ENV,
  title: X_BRIDGE_TEMPLATE_TITLE,
  hint: X_BRIDGE_TEMPLATE_HINT,
  placeholder: X_BRIDGE_TEMPLATE_PLACEHOLDER,
  saveLabel: X_BRIDGE_TEMPLATE_SAVE_LABEL,
  inputType: "text",
  validate: validateBridgeTemplate,
  errorMessages: X_BRIDGE_TEMPLATE_ERROR_MESSAGES,
};

export const xSourceExtension: SourceExtensionEntry = {
  id: X_SOURCE_ID,
  label: X_SOURCE_LABEL,
  kind: "x",

  claims(input: string): boolean {
    return extractHandle(input) !== null;
  },

  async resolve(input: string): Promise<ResolvedSource> {
    const handle = extractHandle(input);
    if (!handle) {
      throw new Error(`x-source: refused to resolve non-X input: ${input}`);
    }
    const template = await getXBridgeTemplate();
    if (!template) {
      throw new Error(
        "X bridge template is missing. Add an RSS bridge template in Settings before adding X sources.",
      );
    }
    const bridgeUrl = buildBridgeUrl(handle, template);
    return {
      url: bridgeUrl,
      displayName: `@${handle}`,
    };
  },

  settings: [bridgeTemplateField],
};
