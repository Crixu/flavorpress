/**
 * FlavorPress design system reference - WPDS-aligned.
 *
 * Documents the tokens, primitives, and patterns that compose every surface in
 * the app. The full spec lives in docs/design-system.md; this page is the
 * runtime live demo.
 *
 * If a screen needs something this page does not show, the screen is doing
 * something the system does not yet support. Either reuse what exists, or
 * promote the new pattern here so the next screen can reuse it too.
 */

import type { Metadata } from "next";
import {
  Button,
  Card,
  Chip,
  Notice,
  StatusBadge,
  Field,
  MasterDetail,
} from "@/components/wpds";
import { SideSheetDemo } from "./_components/SideSheetDemo";

export const metadata: Metadata = {
  title: "Design system · FlavorPress",
  description: "WPDS-aligned tokens, primitives, and patterns for the FlavorPress UI.",
};

export default function DesignPage() {
  return (
    <div className="fp-main">
      <header style={{ marginBottom: 40 }}>
        <div
          style={{
            fontSize: 10,
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            color: "var(--ink-muted)",
            fontWeight: 600,
            marginBottom: 8,
          }}
        >
          FlavorPress
        </div>
        <h1
          style={{
            fontFamily: "var(--font-serif), Georgia, serif",
            fontSize: 36,
            fontWeight: 500,
            margin: "0 0 8px",
            letterSpacing: "-0.01em",
            lineHeight: 1.1,
            color: "var(--ink-primary)",
          }}
        >
          Design system
        </h1>
        <p
          style={{
            fontSize: 13,
            color: "var(--ink-tertiary)",
            fontStyle: "italic",
            margin: 0,
          }}
        >
          WPDS-aligned tokens, primitives, and patterns. The full spec lives in{" "}
          <a
            href="https://github.com/Automattic/flavorpress/blob/main/docs/design-system.md"
            style={{ color: "var(--accent-blue)" }}
          >
            docs/design-system.md
          </a>
          .
        </p>
      </header>

      {/* Tokens */}
      <Section eyebrow="01" title="Tokens">
        <SubHead>Surfaces</SubHead>
        <SwatchGrid>
          <Swatch varName="--surface-canvas" value="#ffffff" />
          <Swatch varName="--surface-subtle" value="#fafafa" />
          <Swatch varName="--surface-muted" value="#f6f7f7" />
          <Swatch varName="--surface-tag" value="#f0f0f1" />
        </SwatchGrid>

        <SubHead>Ink</SubHead>
        <SwatchGrid>
          <Swatch varName="--ink-primary" value="#1e1e1e" />
          <Swatch varName="--ink-secondary" value="#3c434a" />
          <Swatch varName="--ink-tertiary" value="#646970" />
          <Swatch varName="--ink-muted" value="#787c82" />
        </SwatchGrid>

        <SubHead>Border</SubHead>
        <SwatchGrid>
          <Swatch varName="--border-default" value="#dcdcde" />
          <Swatch varName="--border-strong" value="#1e1e1e" />
          <Swatch varName="--border-input" value="#8c8f94" />
        </SwatchGrid>

        <SubHead>Accent</SubHead>
        <SwatchGrid>
          <Swatch varName="--accent" value="#1e1e1e" />
          <Swatch varName="--accent-blue" value="#3858e9" />
        </SwatchGrid>

        <SubHead>Semantic</SubHead>
        <SwatchGrid>
          <Swatch varName="--success-bg" value="#e6f7ec" />
          <Swatch varName="--success-fg" value="#0a5a2e" />
          <Swatch varName="--warn-bg" value="#fdf6e3" />
          <Swatch varName="--warn-fg" value="#896200" />
          <Swatch varName="--error-bg" value="#fcebec" />
          <Swatch varName="--error-fg" value="#8a1f24" />
        </SwatchGrid>

        <SubHead>Radius</SubHead>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          {(
            [
              { label: "sm", value: "2px", token: "--radius-sm" },
              { label: "md", value: "4px", token: "--radius-md" },
              { label: "lg", value: "6px", token: "--radius-lg" },
              { label: "pill", value: "999px", token: "--radius-pill" },
            ] as const
          ).map((r) => (
            <div
              key={r.token}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "8px 12px",
                border: "1px solid var(--border-default)",
                borderRadius: 4,
              }}
            >
              <div
                style={{
                  width: 32,
                  height: 32,
                  background: "var(--surface-tag)",
                  border: "1px solid var(--border-default)",
                  borderRadius: r.value,
                }}
              />
              <div>
                <div style={{ fontSize: 11, fontFamily: "monospace", color: "var(--ink-primary)" }}>
                  {r.token}
                </div>
                <div style={{ fontSize: 10, color: "var(--ink-muted)" }}>{r.value}</div>
              </div>
            </div>
          ))}
        </div>

        <SubHead>Motion</SubHead>
        <div
          style={{
            fontSize: 13,
            color: "var(--ink-secondary)",
            lineHeight: 1.7,
            fontFamily: "monospace",
          }}
        >
          <div>
            <span style={{ color: "var(--ink-muted)" }}>--duration:</span> 150ms
          </div>
          <div>
            <span style={{ color: "var(--ink-muted)" }}>--ease:</span>{" "}
            cubic-bezier(0.22, 1, 0.36, 1)
          </div>
        </div>
        <p style={{ fontSize: 12, color: "var(--ink-muted)", marginTop: 6, fontStyle: "italic" }}>
          Reduced-motion media query in globals.css zeros all transitions. Never bypass it.
        </p>
      </Section>

      {/* Type */}
      <Section eyebrow="02" title="Type scale">
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <TypeRow
            label="Display"
            spec="36px / Newsreader / weight 500"
            token="--type-display"
          >
            <span
              style={{
                fontFamily: "var(--font-serif), Georgia, serif",
                fontSize: 36,
                fontWeight: 500,
                letterSpacing: "-0.01em",
                lineHeight: 1.1,
                color: "var(--ink-primary)",
              }}
            >
              Publishing tool
            </span>
          </TypeRow>
          <TypeRow label="H1" spec="24px / Inter / weight 600" token="--type-h1">
            <span
              style={{
                fontSize: 24,
                fontWeight: 600,
                lineHeight: 1.2,
                color: "var(--ink-primary)",
              }}
            >
              Sources
            </span>
          </TypeRow>
          <TypeRow
            label="H2 editorial"
            spec="18px / Newsreader / weight 500"
            token="--type-h2"
          >
            <span
              style={{
                fontFamily: "var(--font-serif), Georgia, serif",
                fontSize: 18,
                fontWeight: 500,
                color: "var(--ink-primary)",
              }}
            >
              Cluster title
            </span>
          </TypeRow>
          <TypeRow label="H2 dense" spec="18px / Inter / weight 600" token="--type-h2">
            <span
              style={{ fontSize: 18, fontWeight: 600, color: "var(--ink-primary)" }}
            >
              Section header
            </span>
          </TypeRow>
          <TypeRow label="Body" spec="13px / Inter" token="--type-body">
            <span style={{ fontSize: 13, color: "var(--ink-secondary)", lineHeight: 1.6 }}>
              Excerpt copy, default body text, form labels.
            </span>
          </TypeRow>
          <TypeRow label="Meta" spec="11px / Inter" token="--type-meta">
            <span style={{ fontSize: 11, color: "var(--ink-muted)" }}>
              Eyebrows, footnotes, stats
            </span>
          </TypeRow>
          <TypeRow label="Eyebrow" spec="10px / Inter / uppercase / 0.06em" token="--type-eyebrow">
            <span
              style={{
                fontSize: 10,
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                color: "var(--ink-muted)",
                fontWeight: 600,
              }}
            >
              Section label
            </span>
          </TypeRow>
        </div>
      </Section>

      {/* Buttons */}
      <Section eyebrow="03" title="Button">
        <p style={{ fontSize: 13, color: "var(--ink-secondary)", marginBottom: 16 }}>
          Four variants. Primary is the most important action on a surface; use it once.
          Secondary for everything else. Danger for destructive actions. Link for
          "skip / dismiss / not a story" affordances.
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
          <Button>Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="danger">Danger</Button>
          <Button variant="link">Link</Button>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
          <Button disabled>Disabled primary</Button>
          <Button variant="secondary" disabled>
            Disabled secondary
          </Button>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Button size="sm">SM Primary</Button>
          <Button size="sm" variant="secondary">
            SM Secondary
          </Button>
          <Button size="sm" variant="danger">
            SM Danger
          </Button>
          <Button size="sm" variant="link">
            SM Link
          </Button>
        </div>
      </Section>

      {/* Cards */}
      <Section eyebrow="04" title="Card">
        <p style={{ fontSize: 13, color: "var(--ink-secondary)", marginBottom: 16 }}>
          White surface, hairline border, 4px radius, 18x20px padding. Hover lifts
          border to ink-muted. Emphasis variant adds a black left spine for single-source
          and "saved" cards.
        </p>
        <Card style={{ marginBottom: 10 }}>
          <strong>Default card</strong>
          <p style={{ margin: "6px 0 0", fontSize: 13, color: "var(--ink-secondary)" }}>
            White surface, hairline border, 4px radius.
          </p>
        </Card>
        <Card emphasis>
          <strong>Emphasis card</strong>
          <p style={{ margin: "6px 0 0", fontSize: 13, color: "var(--ink-secondary)" }}>
            Black left spine for "saved by user" and single-source treatment.
          </p>
        </Card>
      </Section>

      {/* Chips and badges */}
      <Section eyebrow="05" title="Chip and StatusBadge">
        <p style={{ fontSize: 13, color: "var(--ink-secondary)", marginBottom: 12 }}>
          Chips are pill-shaped filter selectors. Active state inverts (black bg, white
          text). StatusBadge shows connection state, trust level, or default-outlet flag.
        </p>
        <SubHead>Chip</SubHead>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 16 }}>
          <Chip label="All" count={28} active />
          <Chip label="Coffee" count={9} />
          <Chip label="Tech" count={7} />
          <Chip label="Science" count={4} />
        </div>
        <SubHead>StatusBadge</SubHead>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <StatusBadge status="ok">Connected</StatusBadge>
          <StatusBadge status="warn">Action needed</StatusBadge>
          <StatusBadge status="error">Disconnected</StatusBadge>
          <StatusBadge status="default-outlet">Default</StatusBadge>
        </div>
      </Section>

      {/* Notices */}
      <Section eyebrow="06" title="Notice">
        <p style={{ fontSize: 13, color: "var(--ink-secondary)", marginBottom: 16 }}>
          Left-bordered banner with semantic background tint. For inline page-level
          messages. Avoid inside cards; cards already carry the message.
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <Notice tone="info">Info: lead with the fact, not the setup.</Notice>
          <Notice tone="warn">Warn: stale draft, started 2 days ago.</Notice>
          <Notice tone="error">Error: connection failed.</Notice>
          <Notice tone="success">Success: voice profile saved.</Notice>
        </div>
      </Section>

      {/* Field */}
      <Section eyebrow="07" title="Field">
        <p style={{ fontSize: 13, color: "var(--ink-secondary)", marginBottom: 16 }}>
          Label + child input + optional hint. Label is uppercase eyebrow style. Inputs
          inside .wpds-field get the standard 1px input border and focus ring.
        </p>
        <Card>
          <Field label="Site URL" hint="The base URL of your WordPress site.">
            <input type="url" placeholder="https://example.com" />
          </Field>
          <Field label="Description" hint="Used to build your voice profile.">
            <textarea rows={3} placeholder="Wry, lightly contrarian..." />
          </Field>
          <Field label="App password">
            <input type="password" placeholder="xxxx xxxx xxxx xxxx" />
          </Field>
        </Card>
      </Section>

      {/* SideSheet */}
      <Section eyebrow="08" title="SideSheet">
        <p style={{ fontSize: 13, color: "var(--ink-secondary)", marginBottom: 16 }}>
          Right-side overlay, default 480px wide. Closes on Escape and scrim click.
          Title renders in Newsreader. Footer pinned to bottom with subtle background.
          Use for: Draft Wizard, Add Feed, Connect WP Site.
        </p>
        <SideSheetDemo />
      </Section>

      {/* MasterDetail */}
      <Section eyebrow="09" title="MasterDetail">
        <p style={{ fontSize: 13, color: "var(--ink-secondary)", marginBottom: 16 }}>
          Two-pane layout: 220px sidebar (configurable) + flexible right pane. Sidebar
          uses surface-subtle. Used by /voice and /settings.
        </p>
        <div
          style={{
            border: "1px solid var(--border-default)",
            borderRadius: 4,
            overflow: "hidden",
            minHeight: 160,
          }}
        >
          <MasterDetail
            sidebar={
              <nav style={{ padding: "12px 0" }}>
                {["General", "Voice", "Sources", "Outlets"].map((item, i) => (
                  <div
                    key={item}
                    style={{
                      padding: "8px 16px",
                      fontSize: 13,
                      color: i === 0 ? "var(--ink-primary)" : "var(--ink-secondary)",
                      boxShadow: i === 0 ? "inset 3px 0 0 var(--ink-primary)" : undefined,
                      fontWeight: i === 0 ? 500 : undefined,
                      cursor: "default",
                    }}
                  >
                    {item}
                  </div>
                ))}
              </nav>
            }
          >
            <div style={{ padding: 20 }}>
              <div
                style={{
                  fontSize: 10,
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  color: "var(--ink-muted)",
                  fontWeight: 600,
                  marginBottom: 8,
                }}
              >
                General
              </div>
              <p style={{ fontSize: 13, color: "var(--ink-secondary)", margin: 0 }}>
                Detail pane content. Selected sidebar item gets an inset left shadow
                (3px, ink-primary).
              </p>
            </div>
          </MasterDetail>
        </div>
      </Section>

      {/* Patterns */}
      <Section eyebrow="10" title="Patterns">
        <SubHead>Page header</SubHead>
        <p style={{ fontSize: 13, color: "var(--ink-secondary)", marginBottom: 12 }}>
          Used at the top of every full-page surface. page-title is Newsreader 30px weight
          500. page-sub is italic 13px tertiary ink. Canonical: src/app/page.tsx.
        </p>
        <div
          style={{
            border: "1px solid var(--border-default)",
            borderRadius: 4,
            padding: "16px 20px",
          }}
        >
          <header className="page-header">
            <h1 className="page-title">Today</h1>
            <div className="page-sub">Three clusters worth drafting</div>
            <div className="page-actions">
              <Button variant="secondary">Sync sources</Button>
            </div>
          </header>
        </div>

        <SubHead style={{ marginTop: 24 }}>Cluster card</SubHead>
        <p style={{ fontSize: 13, color: "var(--ink-secondary)", marginBottom: 12 }}>
          Default: white Card + meta eyebrow + title + summary + source list + tag row +
          action row. Single-source variant uses Card emphasis with a different eyebrow.
          Canonical: src/app/_components/TodayFolderStreams.tsx.
        </p>
        <Card>
          <div
            style={{
              fontSize: 10,
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              color: "var(--ink-muted)",
              fontWeight: 600,
              marginBottom: 6,
            }}
          >
            Cluster · 4 sources · 2h ago
          </div>
          <div
            style={{
              fontFamily: "var(--font-serif), Georgia, serif",
              fontSize: 18,
              fontWeight: 500,
              color: "var(--ink-primary)",
              marginBottom: 6,
            }}
          >
            Coffee shops are opening earlier to capture the morning commute
          </div>
          <p style={{ fontSize: 13, color: "var(--ink-secondary)", marginBottom: 8 }}>
            Three independent operators in Seattle extended opening to 5:30 AM this week,
            citing foot traffic data from the downtown transit hub.
          </p>
          <div style={{ fontSize: 11, color: "var(--ink-muted)", marginBottom: 8 }}>
            The Stranger · Seattle Times · Eater Seattle
          </div>
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 12 }}>
            {["coffee", "seattle", "hospitality"].map((tag) => (
              <span
                key={tag}
                style={{
                  fontSize: 11,
                  padding: "2px 7px",
                  borderRadius: 999,
                  background: "var(--surface-tag)",
                  color: "var(--ink-secondary)",
                }}
              >
                {tag}
              </span>
            ))}
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <Button>Draft for outlet</Button>
            <Button variant="secondary">Open cluster</Button>
            <Button variant="link" style={{ marginLeft: "auto" }}>
              Not a story
            </Button>
          </div>
        </Card>

        <SubHead style={{ marginTop: 24 }}>Compact row (Sources)</SubHead>
        <p style={{ fontSize: 13, color: "var(--ink-secondary)" }}>
          Grid layout: checkbox + name+URL+tags + stats + last-poll + trust + routing
          button + sync button. Hairline border-default divider between rows, no card
          frame. Canonical: src/app/sources/_components/SourcesExplorer.tsx.
        </p>
      </Section>

      {/* Anti-patterns */}
      <Section eyebrow="11" title="Anti-patterns">
        <p style={{ fontSize: 13, color: "var(--ink-secondary)", marginBottom: 12 }}>
          Flag these in code review. They break voice, introduce scope creep, or make the
          product look like an AI slop factory.
        </p>
        <ul
          style={{
            fontSize: 13,
            color: "var(--ink-secondary)",
            lineHeight: 1.8,
            paddingLeft: 18,
            margin: 0,
          }}
        >
          <li>No new hex codes in JSX. Use tokens. If the token does not exist, propose adding it to globals.css first.</li>
          <li>No pictographic emojis in chips, headers, buttons, or copy. Typographic glyphs (→ ↗ ✓ ✕) are fine.</li>
          <li>No em-dashes in code, comments, or copy. Use semicolons or rephrase.</li>
          <li>No setup-then-reveal sentences in copy. Lead with the fact.</li>
          <li>No closures, sign-offs, or "want me to" appendixes in any user-facing text.</li>
          <li>No multi-tenant chrome: no org switchers, role pickers, network admin links, or audit log links.</li>
          <li>No push notifications, digest emails, or scheduled auto-publish. This is a pull-based product.</li>
          <li>No "preview" buttons on cluster cards; the primary action ships the user toward writing.</li>
          <li>No voice-match score on cluster cards. Voice match is a post-draft check, not a pre-draft filter.</li>
          <li>No mobile-first breakpoints below 720px. Graceful degradation is fine; pixel-perfect mobile is out of scope.</li>
          <li>No tag editing UI. Tags are LLM-extracted at ingest; they are a matching primitive, not a user-curated taxonomy.</li>
        </ul>
      </Section>
    </div>
  );
}

// ------ Helpers ------

function Section({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section style={{ marginBottom: 56 }}>
      <div
        style={{
          fontSize: 10,
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          color: "var(--ink-muted)",
          fontWeight: 600,
          marginBottom: 4,
        }}
      >
        {eyebrow}
      </div>
      <h2
        style={{
          fontFamily: "var(--font-serif), Georgia, serif",
          fontSize: 22,
          fontWeight: 500,
          margin: "0 0 18px",
          color: "var(--ink-primary)",
          letterSpacing: "-0.01em",
        }}
      >
        {title}
      </h2>
      {children}
    </section>
  );
}

function SubHead({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <div
      style={{
        fontSize: 11,
        textTransform: "uppercase",
        letterSpacing: "0.06em",
        color: "var(--ink-muted)",
        fontWeight: 600,
        margin: "16px 0 8px",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

function SwatchGrid({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
        gap: 8,
        marginBottom: 4,
      }}
    >
      {children}
    </div>
  );
}

function Swatch({ varName, value }: { varName: string; value: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: 8,
        border: "1px solid var(--border-default)",
        borderRadius: 4,
      }}
    >
      <div
        style={{
          width: 32,
          height: 32,
          background: `var(${varName})`,
          borderRadius: 4,
          border: "1px solid var(--border-default)",
          flexShrink: 0,
        }}
      />
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            fontSize: 11,
            fontFamily: "monospace",
            color: "var(--ink-primary)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {varName}
        </div>
        <div style={{ fontSize: 10, color: "var(--ink-muted)" }}>{value}</div>
      </div>
    </div>
  );
}

function TypeRow({
  label,
  spec,
  token,
  children,
}: {
  label: string;
  spec: string;
  token: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "160px 1fr",
        gap: 12,
        alignItems: "center",
        padding: "12px 0",
        borderBottom: "1px solid var(--border-default)",
      }}
    >
      <div>
        <div style={{ fontSize: 11, fontWeight: 600, color: "var(--ink-secondary)", marginBottom: 2 }}>
          {label}
        </div>
        <div style={{ fontSize: 10, color: "var(--ink-muted)", fontFamily: "monospace" }}>
          {token}
        </div>
        <div style={{ fontSize: 10, color: "var(--ink-muted)", marginTop: 1 }}>{spec}</div>
      </div>
      <div>{children}</div>
    </div>
  );
}
