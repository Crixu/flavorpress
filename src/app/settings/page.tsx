/**
 * Settings panel.
 *
 * Anthropic key, draft model, and inbound webhook secret. Lookup
 * precedence is DB → process.env, so anyone running with .env-only keeps
 * working; values stored here override when present.
 */

import {
  loadSettingsSnapshot,
  SETTING_DEFAULTS,
  SETTING_KEYS,
  type SettingKey,
} from "@/lib/v1/settings";
import {
  clearSettingAction,
  saveSettingAction,
  toggleExtensionAction,
} from "@/lib/v1/settings-actions";
import { resolveAnthropicAuth, type AuthMode } from "@/lib/anthropic";
import { ensureSchema } from "@/lib/db";
import { EXTENSION_METADATA, findExtensionMetadata } from "@/extensions/registry";
import { PendingMessage, SubmitButton } from "../_components/SubmitButton";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{
    saved?: string;
    cleared?: string;
    error?: string;
    extension?: string;
    state?: string;
  }>;
}

export default async function SettingsPage({ searchParams }: PageProps) {
  await ensureSchema();
  const sp = await searchParams;
  const [snapshot, auth] = await Promise.all([
    loadSettingsSnapshot(),
    resolveAnthropicAuth().catch(
      () =>
        ({ mode: "none", apiKey: null, claudePath: null }) as Awaited<
          ReturnType<typeof resolveAnthropicAuth>
        >,
    ),
  ]);

  return (
    <div className="space-y-8" style={{ maxWidth: 720 }}>
      <header className="space-y-2">
        <div className="fp-eyebrow">Settings</div>
        <h1 className="fp-h1 fp-h1-serif" style={{ maxWidth: "20ch" }}>
          Configure FlavorPress without editing .env.
        </h1>
        <p className="text-sm leading-relaxed" style={{ color: "var(--fg-muted)" }}>
          Values you save here are stored locally in the FlavorPress database and override any
          matching <code>.env</code> entry. Clear a value to fall back to the environment variable.
        </p>
      </header>

      <AuthModeRow mode={auth.mode} hasApiKey={auth.apiKey !== null} />

      {sp.saved ? <Banner kind="success">✓ Saved {labelFor(sp.saved)}.</Banner> : null}
      {sp.cleared ? (
        <Banner kind="success">✓ Cleared {labelFor(sp.cleared)}. Falling back to .env.</Banner>
      ) : null}
      {sp.extension && (sp.state === "enabled" || sp.state === "disabled") ? (
        <Banner kind="success">
          ✓ {sp.state === "enabled" ? "Enabled" : "Disabled"} {extensionLabelFor(sp.extension)}.
        </Banner>
      ) : null}
      {sp.error === "anthropic_key_invalid" ? (
        <Banner kind="error">
          ⚠ Anthropic key didn't match the expected <code>sk-ant-…</code> format. Nothing was saved.
        </Banner>
      ) : null}
      {sp.error === "invalid_key" ? <Banner kind="error">⚠ Unknown setting key.</Banner> : null}
      {sp.error === "invalid_extension" ? <Banner kind="error">⚠ Unknown extension.</Banner> : null}

      <SettingForm
        title="Anthropic API key"
        hint="Used for drafting when configured, and required for fact-check. Without a key, drafting can use your local Claude Code login; if neither auth path is available, drafts fall back to a deterministic stub for local dev."
        settingKey={SETTING_KEYS.anthropicApiKey}
        envVar="ANTHROPIC_API_KEY"
        source={snapshot.anthropicApiKey.source}
        preview={snapshot.anthropicApiKey.preview}
        inputType="password"
        placeholder="sk-ant-..."
        saveLabel="Save key"
      />

      <SettingForm
        title="Draft model"
        hint="Anthropic model used by the draft generator. Default is Haiku 4.5; bump to Sonnet for higher quality at higher cost."
        settingKey={SETTING_KEYS.anthropicDraftModel}
        envVar="ANTHROPIC_DRAFT_MODEL"
        source={snapshot.anthropicDraftModel.source}
        preview={snapshot.anthropicDraftModel.value}
        inputType="text"
        placeholder={SETTING_DEFAULTS.anthropicDraftModel}
        saveLabel="Save model"
        defaultValue={
          snapshot.anthropicDraftModel.source === "db" ? snapshot.anthropicDraftModel.value : ""
        }
      />

      <ExtensionsSection disabledExtensionIds={snapshot.disabledExtensionIds} />

      <ExportSection />
    </div>
  );
}

function ExportSection() {
  return (
    <section className="fp-card p-5 space-y-3">
      <div>
        <div className="text-base font-semibold">Export your data</div>
        <p className="mt-1 text-[13px] leading-relaxed" style={{ color: "var(--fg-muted)" }}>
          Download a JSON snapshot of your drafts, voice profiles, outlets, source folders, sources,
          and source-to-outlet assignments. Application Passwords and other secrets are stripped
          before download.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <a className="fp-btn fp-btn-primary" href="/api/export" download>
          Download export
        </a>
        <span className="text-[12px]" style={{ color: "var(--fg-muted)" }}>
          Generated on demand. Nothing is stored on disk.
        </span>
      </div>
    </section>
  );
}

function AuthModeRow({ mode, hasApiKey }: { mode: AuthMode; hasApiKey: boolean }) {
  const config =
    mode === "api"
      ? {
          chip: { label: "API key", cls: "fp-chip fp-chip-emerald" },
          line: "FlavorPress is using your Anthropic API key. All features (drafting, fact-check) work.",
        }
      : mode === "cli"
        ? {
            chip: { label: "Claude Code login", cls: "fp-chip fp-chip-emerald" },
            line: hasApiKey
              ? "FlavorPress is riding your local Claude Code login for drafting. Fact-check uses the API key you also have configured below."
              : "FlavorPress is riding your local Claude Code login. Drafting works without an API key. Fact-check still requires a key (it uses Anthropic's web_search tool); add one below to enable it.",
          }
        : {
            chip: { label: "Not connected", cls: "fp-chip fp-chip-rose" },
            line: "No Anthropic auth configured. Paste an API key below, or install and sign in to Claude Code to use the local-login path.",
          };
  return (
    <section className="fp-card p-5 space-y-2">
      <div className="flex items-center gap-2 text-sm">
        <span style={{ color: "var(--fg-muted)" }}>Active auth:</span>
        <span className={config.chip.cls}>{config.chip.label}</span>
      </div>
      <p className="text-[13px] leading-relaxed" style={{ color: "var(--fg-muted)" }}>
        {config.line}
      </p>
    </section>
  );
}

function ExtensionsSection({ disabledExtensionIds }: { disabledExtensionIds: string[] }) {
  const disabled = new Set(disabledExtensionIds);
  return (
    <section className="fp-card p-5 space-y-4">
      <div>
        <div className="text-base font-semibold">Editor extensions</div>
        <p className="mt-1 text-[13px] leading-relaxed" style={{ color: "var(--fg-muted)" }}>
          Toggle which inspectors run on each draft. Disabling an extension stops loading its
          annotations and hides its right-rail panel; the underlying data stays in the database so
          you can re-enable later.
        </p>
      </div>
      <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
        {EXTENSION_METADATA.map((ext) => {
          const isEnabled = !disabled.has(ext.id);
          return (
            <li key={ext.id} className="flex items-start gap-4 py-3">
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-[14px] font-semibold">{ext.label}</span>
                  <span className={isEnabled ? "fp-chip fp-chip-emerald" : "fp-chip fp-chip-rose"}>
                    {isEnabled ? "Enabled" : "Disabled"}
                  </span>
                </div>
                <p className="text-[12.5px] leading-relaxed" style={{ color: "var(--fg-muted)" }}>
                  {ext.description}
                </p>
              </div>
              <form action={toggleExtensionAction} className="shrink-0">
                <input type="hidden" name="extensionId" value={ext.id} />
                <input type="hidden" name="enabled" value={isEnabled ? "0" : "1"} />
                <SubmitButton
                  className={isEnabled ? "fp-btn fp-btn-ghost" : "fp-btn fp-btn-primary"}
                  pendingLabel={isEnabled ? "Disabling" : "Enabling"}
                >
                  {isEnabled ? "Disable" : "Enable"}
                </SubmitButton>
              </form>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

interface SettingFormProps {
  title: string;
  hint: string;
  settingKey: SettingKey;
  envVar: string;
  source: "db" | "env" | "default" | "none";
  preview: string | null;
  inputType: "password" | "text";
  placeholder: string;
  saveLabel: string;
  defaultValue?: string;
}

function SettingForm({
  title,
  hint,
  settingKey,
  envVar,
  source,
  preview,
  inputType,
  placeholder,
  saveLabel,
  defaultValue,
}: SettingFormProps) {
  return (
    <section className="fp-card p-5 space-y-3">
      <div>
        <div className="text-base font-semibold">{title}</div>
        <p className="mt-1 text-[13px] leading-relaxed" style={{ color: "var(--fg-muted)" }}>
          {hint}
        </p>
      </div>
      <SourceLine source={source} preview={preview} envVar={envVar} />
      <form action={saveSettingAction} className="space-y-3">
        <input type="hidden" name="key" value={settingKey} />
        <input
          type={inputType}
          name="value"
          defaultValue={defaultValue ?? ""}
          placeholder={
            preview && inputType === "password" ? `Replace current (${preview})` : placeholder
          }
          autoComplete="off"
          spellCheck={false}
          className="fp-input w-full font-mono text-xs"
        />
        <div className="flex flex-wrap items-center gap-2">
          <SubmitButton className="fp-btn fp-btn-primary" pendingLabel="Saving">
            {saveLabel}
          </SubmitButton>
          {source === "db" ? (
            <button type="submit" formAction={clearSettingAction} className="fp-btn fp-btn-ghost">
              Clear & use .env
            </button>
          ) : null}
          <PendingMessage>Writing to local FlavorPress database.</PendingMessage>
        </div>
      </form>
    </section>
  );
}

function SourceLine({
  source,
  preview,
  envVar,
}: {
  source: "db" | "env" | "default" | "none";
  preview: string | null;
  envVar: string;
}) {
  const chip =
    source === "db"
      ? { label: "Stored locally", cls: "fp-chip fp-chip-emerald" }
      : source === "env"
        ? { label: `from ${envVar}`, cls: "fp-chip fp-chip-amber" }
        : source === "default"
          ? { label: "default", cls: "fp-chip" }
          : { label: "not set", cls: "fp-chip fp-chip-rose" };
  return (
    <div className="flex items-center gap-2 text-[12px]" style={{ color: "var(--fg-muted)" }}>
      <span className={chip.cls}>{chip.label}</span>
      {preview ? <span className="font-mono">{preview}</span> : null}
    </div>
  );
}

function labelFor(key: string): string {
  switch (key) {
    case SETTING_KEYS.anthropicApiKey:
      return "Anthropic API key";
    case SETTING_KEYS.anthropicDraftModel:
      return "draft model";
    default:
      return "setting";
  }
}

function extensionLabelFor(id: string): string {
  return findExtensionMetadata(id)?.label ?? "extension";
}

function Banner({
  kind,
  children,
}: {
  kind: "success" | "warn" | "error";
  children: React.ReactNode;
}) {
  const palette =
    kind === "success"
      ? {
          bg: "var(--emerald-tint)",
          fg: "var(--emerald)",
          border: "color-mix(in srgb, var(--emerald) 25%, var(--border))",
        }
      : kind === "warn"
        ? {
            bg: "var(--amber-tint)",
            fg: "var(--amber)",
            border: "color-mix(in srgb, var(--amber) 25%, var(--border))",
          }
        : {
            bg: "var(--rose-tint)",
            fg: "var(--rose)",
            border: "color-mix(in srgb, var(--rose) 25%, var(--border))",
          };
  return (
    <div
      className="rounded-lg px-4 py-3 text-sm"
      style={{
        background: palette.bg,
        color: palette.fg,
        border: `1px solid ${palette.border}`,
      }}
    >
      {children}
    </div>
  );
}
