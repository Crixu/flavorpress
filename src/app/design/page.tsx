/**
 * FlavorPress design system reference.
 *
 * Single source of truth for Canvas: tokens (color, type, shape, motion),
 * components (button, chip, card, input, stat, skeleton), and patterns
 * (page header, empty state, progress strip, annotations). Documents what
 * already ships in globals.css; does not introduce new primitives.
 *
 * If a screen needs something this page does not show, the screen is doing
 * something the system does not yet support; either reuse what exists, or
 * promote the new pattern here so the next screen can reuse it too.
 */

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Design system · FlavorPress",
  description: "Tokens, components, and patterns for the FlavorPress UI.",
};

export default function DesignSystemPage() {
  return (
    <div className="space-y-16">
      <Hero />
      <Section
        eyebrow="01"
        title="Principles"
        intro="Five guardrails behind every UI choice. If a screen breaks one, the screen is wrong, not the rule."
      >
        <Principles />
      </Section>

      <Section
        eyebrow="02"
        title="Voice"
        intro="Copy rules apply to chat, code comments, draft prompts, button labels, empty states, error messages."
      >
        <VoiceRules />
      </Section>

      <Section
        eyebrow="03"
        title="Color"
        intro="Warm cream paper, deep ink. Peach is the editorial accent; mint confirms; amber warns; plum carries information. Tints are 8–14% washes for backgrounds, never for text on white."
      >
        <ColorTokens />
      </Section>

      <Section
        eyebrow="04"
        title="Typography"
        intro="Inter for UI; Newsreader for editorial body and display H1. Tabular numerals on anything counted. ss01 + cv11 stylistic sets enabled globally; do not override per surface."
      >
        <TypeScale />
      </Section>

      <Section
        eyebrow="05"
        title="Shape & elevation"
        intro="Chunky radii, soft diffuse shadows. Every interactive surface gets at least shadow-xs so it lifts off the cream paper."
      >
        <ShapeAndElevation />
      </Section>

      <Section
        eyebrow="06"
        title="Motion"
        intro="One duration, one ease. View transitions on cluster reorder; reduced-motion users get an instant cut."
      >
        <MotionTokens />
      </Section>

      <Section
        eyebrow="07"
        title="Buttons"
        intro="Three variants, pill-shaped, 14px label, 36px tall. Primary is ink on cream; ghost is outlined on white; danger is amber on hairline. All three share focus glow, hover lift, and an 0.72-opacity disabled state."
      >
        <Buttons />
      </Section>

      <Section
        eyebrow="08"
        title="Chips"
        intro="Tinted pills for status and metadata. 11px, no shadow. Pick the colour by meaning, not aesthetics: mint = positive, peach = editorial accent, amber = warning, plum/ink = informational."
      >
        <Chips />
      </Section>

      <Section
        eyebrow="09"
        title="Inputs"
        intro="One input shape, two heights. Focus state is a peach hairline plus the shared glow ring; never a blue browser default."
      >
        <Inputs />
      </Section>

      <Section
        eyebrow="10"
        title="Cards"
        intro="Three card moods. Default (cream paper, no border), feature (peach surface, draws the eye to one moment), gradient (peach-cream wash for onboarding warmth)."
      >
        <Cards />
      </Section>

      <Section
        eyebrow="11"
        title="Feedback"
        intro="States users see when the app is thinking. Skeleton on first paint, indeterminate bar during a known job, pulse ring on the live thing, spinner inline with copy."
      >
        <Feedback />
      </Section>

      <Section
        eyebrow="12"
        title="Patterns"
        intro="Compositions that recur across pages. If you find yourself rebuilding one of these, use the snippet below verbatim so screens stay quiet next to each other."
      >
        <Patterns />
      </Section>

      <Section
        eyebrow="13"
        title="Avoid"
        intro="The shortlist of moves that read as AI slop or break voice. These are dropped, not deferred."
      >
        <DontList />
      </Section>
    </div>
  );
}

function Hero() {
  return (
    <header className="space-y-3">
      <div className="fp-eyebrow">FlavorPress · Canvas</div>
      <h1 className="fp-h1 fp-h1-serif" style={{ maxWidth: "20ch" }}>
        The cream-paper, deep-ink design system.
      </h1>
      <p className="max-w-2xl text-base leading-relaxed" style={{ color: "var(--fg-muted)" }}>
        Tokens, components, and patterns that hold the prototype together. The brief is editorial,
        not enterprise; everything below earns its place by helping a single prosumer turn reading
        into a same-day draft, in their voice, without looking like an AI slop factory.
      </p>
    </header>
  );
}

function Section({
  eyebrow,
  title,
  intro,
  children,
}: {
  eyebrow: string;
  title: string;
  intro: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-5">
      <div className="space-y-1.5">
        <div className="fp-eyebrow">{eyebrow}</div>
        <h2 className="fp-h1-serif" style={{ fontSize: 28, lineHeight: 1.15, fontWeight: 500 }}>
          {title}
        </h2>
        <p className="max-w-3xl text-sm leading-relaxed" style={{ color: "var(--fg-muted)" }}>
          {intro}
        </p>
      </div>
      <div className="fp-divider" />
      <div>{children}</div>
    </section>
  );
}

function Principles() {
  const items = [
    {
      h: "Reading turns into writing",
      b: "Every visible affordance moves the user from a feed item toward a WordPress draft. Decoration that does not advance that loop is removed, not styled.",
    },
    {
      h: "Voice over volume",
      b: "Drafts match the user's last 50 posts before they match anything else. Generic copy, generic charts, generic empty states all read as slop; we do not ship them.",
    },
    {
      h: "Same day or not at all",
      b: "If a feature cannot get a user to a publishable draft today, it gets deferred. No background queues, no overnight digests, no schedulers.",
    },
    {
      h: "Pull, never push",
      b: "Notifications, emails, and badges are out of scope. The app is a destination the user opens, not a stream that interrupts them.",
    },
    {
      h: "One outlet, one editor, one keyboard",
      b: "Single-site, single-user. No orgs, no roles, no shared cursors. Multi-tenant features get DROP, not DEFER.",
    },
  ];
  return (
    <ol className="grid gap-4 md:grid-cols-2">
      {items.map((it, i) => (
        <li key={it.h} className="fp-card p-5">
          <div className="text-xs tabular" style={{ color: "var(--fg-subtle)" }}>
            {String(i + 1).padStart(2, "0")}
          </div>
          <div className="mt-1 text-sm font-medium">{it.h}</div>
          <p className="mt-2 text-sm leading-relaxed" style={{ color: "var(--fg-muted)" }}>
            {it.b}
          </p>
        </li>
      ))}
    </ol>
  );
}

function VoiceRules() {
  const rules: Array<{ k: string; bad: string; good: string }> = [
    {
      k: "Lead with the fact",
      bad: "Here is what we are going to do: we will poll your feeds and then…",
      good: "Polling your feeds for the first time.",
    },
    {
      k: "No em dashes",
      bad: "Three steps — connect, train, plug in — and you are done.",
      good: "Three steps from a blank slate to your first draft.",
    },
    {
      k: "No closures or CTAs in chat",
      bad: "Hope this helps! Want me to make those changes?",
      good: "Done. Buttons updated; see /design for the canonical set.",
    },
    {
      k: "Match the user's language",
      bad: "User wrote in German; reply auf Englisch.",
      good: "User wrote in German; reply auf Deutsch.",
    },
    {
      k: "Prose first, lists for collections",
      bad: "A bulleted list summarising a single decision.",
      good: "A short paragraph; a list only when items are genuinely parallel.",
    },
  ];
  return (
    <div className="space-y-3">
      {rules.map((r) => (
        <div key={r.k} className="fp-card p-5">
          <div className="text-sm font-medium">{r.k}</div>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <Quote tone="bad" label="Avoid">
              {r.bad}
            </Quote>
            <Quote tone="good" label="Use">
              {r.good}
            </Quote>
          </div>
        </div>
      ))}
    </div>
  );
}

function Quote({
  tone,
  label,
  children,
}: {
  tone: "bad" | "good";
  label: string;
  children: React.ReactNode;
}) {
  const isGood = tone === "good";
  return (
    <div
      className="rounded-[14px] p-3"
      style={{
        background: isGood ? "var(--emerald-tint)" : "var(--rose-tint)",
        color: "var(--fg)",
      }}
    >
      <div className="fp-eyebrow" style={{ color: isGood ? "#3f7556" : "#9c4a22", fontSize: 10 }}>
        {label}
      </div>
      <p className="mt-1 text-sm leading-relaxed">{children}</p>
    </div>
  );
}

const COLORS: Array<{
  group: string;
  swatches: Array<{ name: string; cssVar: string; hex: string; on?: "ink" | "paper" }>;
}> = [
  {
    group: "Surfaces",
    swatches: [
      { name: "bg", cssVar: "--bg", hex: "#f5f1ea" },
      { name: "bg-subtle", cssVar: "--bg-subtle", hex: "#efe9dd" },
      { name: "surface", cssVar: "--surface", hex: "#ffffff" },
      { name: "surface-elev", cssVar: "--surface-elev", hex: "#ffffff" },
    ],
  },
  {
    group: "Ink",
    swatches: [
      { name: "fg", cssVar: "--fg", hex: "#1a1814", on: "ink" },
      { name: "fg-muted", cssVar: "--fg-muted", hex: "#6e695f", on: "ink" },
      { name: "fg-subtle", cssVar: "--fg-subtle", hex: "#a39a8b", on: "ink" },
    ],
  },
  {
    group: "Border",
    swatches: [
      { name: "border", cssVar: "--border", hex: "#e5decf" },
      { name: "border-strong", cssVar: "--border-strong", hex: "#d5cdb9" },
    ],
  },
  {
    group: "Brand & semantic",
    swatches: [
      { name: "indigo (ink CTA)", cssVar: "--indigo", hex: "#1a1814", on: "ink" },
      { name: "rose (peach accent)", cssVar: "--rose", hex: "#ff8b60", on: "ink" },
      { name: "emerald (mint OK)", cssVar: "--emerald", hex: "#6fb593", on: "ink" },
      { name: "amber (warn)", cssVar: "--amber", hex: "#874a1a", on: "ink" },
      { name: "plum (info)", cssVar: "--plum", hex: "#9f7aea", on: "ink" },
    ],
  },
  {
    group: "Tints",
    swatches: [
      { name: "indigo-tint", cssVar: "--indigo-tint", hex: "#f0eae0" },
      { name: "rose-tint", cssVar: "--rose-tint", hex: "#ffe3c9" },
      { name: "emerald-tint", cssVar: "--emerald-tint", hex: "#e2f0ea" },
      { name: "amber-tint", cssVar: "--amber-tint", hex: "#fce2c7" },
      { name: "plum-tint", cssVar: "--plum-tint", hex: "#f0e5f5" },
    ],
  },
];

function ColorTokens() {
  return (
    <div className="space-y-6">
      {COLORS.map((g) => (
        <div key={g.group}>
          <div className="mb-2 text-xs font-medium" style={{ color: "var(--fg-muted)" }}>
            {g.group}
          </div>
          <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
            {g.swatches.map((s) => (
              <div key={s.cssVar} className="fp-card overflow-hidden">
                <div
                  className="h-20 w-full"
                  style={{
                    background: `var(${s.cssVar})`,
                    borderBottom: "1px solid var(--border)",
                  }}
                />
                <div className="p-3">
                  <div className="text-sm font-medium">{s.name}</div>
                  <div
                    className="mt-0.5 font-mono text-[11px] tabular"
                    style={{ color: "var(--fg-muted)" }}
                  >
                    {s.cssVar} · {s.hex}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function TypeScale() {
  const samples: Array<{
    label: string;
    body: string;
    className?: string;
    style?: React.CSSProperties;
    note: string;
  }> = [
    {
      label: "Editorial H1 — fp-h1 fp-h1-serif",
      body: "Your reading turns into your writing.",
      className: "fp-h1 fp-h1-serif",
      note: "Newsreader 500, clamp(32, 4.5vw, 48), -0.02em letter-spacing. Page heroes only.",
    },
    {
      label: "Section heading — Newsreader 500 · 28",
      body: "Three streams worth your attention",
      className: "fp-h1-serif",
      style: { fontSize: 28, lineHeight: 1.15, fontWeight: 500 },
      note: "Used by /design Section, cluster section titles, the focus card on onboarding.",
    },
    {
      label: "Card heading — Inter 600 · 14",
      body: "Connect your WordPress",
      style: { fontSize: 14, fontWeight: 600 },
      note: "Default for fp-card titles, list items, dialog titles.",
    },
    {
      label: "Body — Inter 400 · 14 / 1.55",
      body: "Each folder is a reading lane. Open the strongest cluster, ask for more, or set that lane aside for now.",
      style: { fontSize: 14, lineHeight: 1.55 },
      note: "Default UI body. Set color: var(--fg-muted) for secondary lines.",
    },
    {
      label: "Eyebrow — fp-eyebrow",
      body: "MONDAY, MAY 4",
      className: "fp-eyebrow",
      note: "11px, 0.16em tracking, var(--fg-subtle). Date stamps, section numbers, step counters.",
    },
    {
      label: "Tabular — .tabular",
      body: "0123456789 · 12 of 38 · 4.7%",
      className: "tabular",
      style: { fontSize: 14 },
      note: "Required on any number that gets read against another number.",
    },
    {
      label: "Editorial body — .serif",
      body: "The orchard had been there since before the war, and the warden walked it every Sunday.",
      className: "serif",
      style: { fontSize: 17, lineHeight: 1.6 },
      note: "Newsreader for the manuscript column inside /editor only.",
    },
  ];
  return (
    <div className="space-y-3">
      {samples.map((s) => (
        <div key={s.label} className="fp-card p-5">
          <div className="text-xs" style={{ color: "var(--fg-subtle)" }}>
            {s.label}
          </div>
          <div className={`mt-2 ${s.className ?? ""}`} style={s.style}>
            {s.body}
          </div>
          <div className="mt-3 text-xs" style={{ color: "var(--fg-muted)" }}>
            {s.note}
          </div>
        </div>
      ))}
    </div>
  );
}

function ShapeAndElevation() {
  const radii: Array<{ name: string; varName: string; px: string }> = [
    { name: "sm", varName: "--radius-sm", px: "10px" },
    { name: "md", varName: "--radius-md", px: "14px" },
    { name: "lg", varName: "--radius-lg", px: "20px" },
    { name: "xl", varName: "--radius-xl", px: "28px" },
  ];
  const shadows: Array<{ name: string; varName: string; use: string }> = [
    { name: "xs", varName: "--shadow-xs", use: "Buttons at rest, stat tiles." },
    { name: "sm", varName: "--shadow-sm", use: "Default card lift." },
    { name: "md", varName: "--shadow-md", use: "Card hover, focus, modal at rest." },
    { name: "lg", varName: "--shadow-lg", use: "Floating menus, popovers." },
    { name: "glow", varName: "--shadow-glow", use: "Focus ring on inputs and buttons." },
  ];
  return (
    <div className="space-y-6">
      <div>
        <div className="mb-2 text-xs font-medium" style={{ color: "var(--fg-muted)" }}>
          Radii
        </div>
        <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-4">
          {radii.map((r) => (
            <div key={r.name} className="fp-card p-4">
              <div
                className="mb-3 h-16 w-full"
                style={{
                  background: "var(--bg-subtle)",
                  borderRadius: `var(${r.varName})`,
                  border: "1px solid var(--border)",
                }}
              />
              <div className="text-sm font-medium">radius-{r.name}</div>
              <div
                className="mt-0.5 font-mono text-[11px] tabular"
                style={{ color: "var(--fg-muted)" }}
              >
                {r.varName} · {r.px}
              </div>
            </div>
          ))}
        </div>
      </div>
      <div>
        <div className="mb-2 text-xs font-medium" style={{ color: "var(--fg-muted)" }}>
          Shadows
        </div>
        <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
          {shadows.map((s) => (
            <div
              key={s.name}
              className="rounded-[20px] bg-white p-5"
              style={{ boxShadow: `var(${s.varName})` }}
            >
              <div className="text-sm font-medium">shadow-{s.name}</div>
              <div
                className="mt-0.5 font-mono text-[11px] tabular"
                style={{ color: "var(--fg-muted)" }}
              >
                {s.varName}
              </div>
              <div className="mt-2 text-xs" style={{ color: "var(--fg-muted)" }}>
                {s.use}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function MotionTokens() {
  return (
    <div className="grid gap-3 md:grid-cols-3">
      <div className="fp-card p-5">
        <div className="text-sm font-medium">Duration</div>
        <div className="mt-1 font-mono text-[12px] tabular" style={{ color: "var(--fg-muted)" }}>
          --duration · 240ms
        </div>
        <p className="mt-2 text-xs" style={{ color: "var(--fg-muted)" }}>
          Single duration for hover, focus, transform, and color transitions.
          Reorder/view-transitions run at 260ms.
        </p>
      </div>
      <div className="fp-card p-5">
        <div className="text-sm font-medium">Ease</div>
        <div className="mt-1 font-mono text-[12px] tabular" style={{ color: "var(--fg-muted)" }}>
          --ease · cubic-bezier(0.16, 1, 0.3, 1)
        </div>
        <p className="mt-2 text-xs" style={{ color: "var(--fg-muted)" }}>
          One ease for everything. Anti-twitch curve; the alternate --ease-out exists but should not
          be reached for without a reason.
        </p>
      </div>
      <div className="fp-card p-5">
        <div className="text-sm font-medium">Reduced motion</div>
        <p className="mt-2 text-xs" style={{ color: "var(--fg-muted)" }}>
          prefers-reduced-motion forces all transitions, animations, and view-transitions to 0ms.
          Components must remain legible without motion; do not hide state behind animation.
        </p>
      </div>
    </div>
  );
}

function Buttons() {
  return (
    <div className="space-y-4">
      <div className="fp-card p-6">
        <div className="mb-3 text-xs" style={{ color: "var(--fg-muted)" }}>
          At rest
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button className="fp-btn fp-btn-primary">Draft from this cluster →</button>
          <button className="fp-btn fp-btn-ghost">Set aside</button>
          <button className="fp-btn fp-btn-danger">Disconnect outlet</button>
        </div>
      </div>
      <div className="fp-card p-6">
        <div className="mb-3 text-xs" style={{ color: "var(--fg-muted)" }}>
          Disabled / pending
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button className="fp-btn fp-btn-primary" aria-disabled disabled>
            <span className="fp-spinner" /> Drafting…
          </button>
          <button className="fp-btn fp-btn-ghost" aria-disabled disabled>
            Save
          </button>
        </div>
      </div>
      <div className="fp-card p-6">
        <div className="mb-3 text-xs" style={{ color: "var(--fg-muted)" }}>
          Focus ring (Tab to focus)
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button className="fp-btn fp-btn-primary">Connect WordPress</button>
          <button className="fp-btn fp-btn-ghost">Cancel</button>
        </div>
      </div>
    </div>
  );
}

function Chips() {
  return (
    <div className="fp-card p-6">
      <div className="flex flex-wrap items-center gap-2">
        <span className="fp-chip">Default</span>
        <span className="fp-chip fp-chip-emerald">✓ Voice match 92%</span>
        <span className="fp-chip fp-chip-rose">Featured</span>
        <span className="fp-chip fp-chip-amber">⚠ Stuck feed</span>
        <span className="fp-chip fp-chip-indigo">3 sources</span>
      </div>
      <div className="mt-4 text-xs" style={{ color: "var(--fg-muted)" }}>
        Typographic glyphs (→ ✓ ⚠) are fine inside chips and copy. Pictographic emojis are not used
        anywhere in the UI.
      </div>
    </div>
  );
}

function Inputs() {
  return (
    <div className="fp-card p-6 space-y-4">
      <div>
        <label className="mb-1.5 block text-sm font-medium">Source URL</label>
        <input className="fp-input" placeholder="https://example.com/feed.xml" defaultValue="" />
      </div>
      <div>
        <label className="mb-1.5 block text-sm font-medium">Voice notes</label>
        <textarea
          className="fp-textarea"
          rows={3}
          placeholder="Anything stylometry would miss; banned vocab, pet phrases, sentences you would never write."
        />
      </div>
    </div>
  );
}

function Cards() {
  return (
    <div className="grid gap-4 md:grid-cols-3">
      <div className="fp-card fp-card-hover p-5">
        <div className="fp-eyebrow">Default</div>
        <div className="mt-2 text-sm font-medium">fp-card</div>
        <p className="mt-1 text-xs" style={{ color: "var(--fg-muted)" }}>
          Cream paper, no border, soft shadow. Add fp-card-hover for the 2px lift on hover.
        </p>
      </div>
      <div className="fp-card-feature p-5">
        <div className="fp-eyebrow">Feature</div>
        <div className="mt-2 text-sm font-medium">fp-card-feature</div>
        <p className="mt-1 text-xs">
          Peach surface for the one moment a screen wants the eye on. Used on the onboarding focus
          card and empty-cluster panels. One per screen.
        </p>
      </div>
      <div className="fp-card fp-gradient-surface p-5">
        <div className="fp-eyebrow">Gradient</div>
        <div className="mt-2 text-sm font-medium">fp-gradient-surface</div>
        <p className="mt-1 text-xs" style={{ color: "var(--fg-muted)" }}>
          Peach-cream + plum wash. Reserved for warmth-forward surfaces; do not stack two on the
          same screen.
        </p>
      </div>
      <div className="md:col-span-3">
        <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-4">
          <Stat label="Sources polled" value="38" hint="last 5 min" />
          <Stat label="Items today" value="217" hint="across 12 feeds" />
          <Stat label="Clusters fired" value="6" hint="3+ source convergence" />
          <Stat label="Drafts ready" value="2" hint="awaiting your call" />
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="fp-stat">
      <div className="fp-eyebrow">{label}</div>
      <div className="mt-1 tabular" style={{ fontSize: 28, fontWeight: 500, lineHeight: 1.1 }}>
        {value}
      </div>
      <div className="mt-0.5 text-xs" style={{ color: "var(--fg-muted)" }}>
        {hint}
      </div>
    </div>
  );
}

function Feedback() {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="fp-card p-5">
        <div className="text-sm font-medium">Skeleton</div>
        <p className="mt-1 text-xs" style={{ color: "var(--fg-muted)" }}>
          Shimmer on first paint while data loads. Match the shape of the real content; do not show
          a generic spinner if a skeleton exists.
        </p>
        <div className="mt-3 space-y-2">
          <div className="fp-skeleton h-4 w-3/4" />
          <div className="fp-skeleton h-4 w-1/2" />
          <div className="fp-skeleton h-20 w-full" />
        </div>
      </div>
      <div className="fp-card p-5">
        <div className="text-sm font-medium">Indeterminate progress</div>
        <p className="mt-1 text-xs" style={{ color: "var(--fg-muted)" }}>
          Used while drafting; we know it is happening, we do not know how long.
        </p>
        <div
          className="relative mt-3 h-1 overflow-hidden rounded-full"
          style={{ background: "var(--border)" }}
        >
          <div
            className="fp-bar-indeterminate absolute h-full w-1/3 rounded-full"
            style={{ background: "linear-gradient(90deg, var(--indigo) 0%, var(--rose) 100%)" }}
          />
        </div>
      </div>
      <div className="fp-card p-5">
        <div className="text-sm font-medium">Inline pending</div>
        <p className="mt-1 text-xs" style={{ color: "var(--fg-muted)" }}>
          For background actions that report back inline. Status dot, label, no shouting.
        </p>
        <div className="mt-3 fp-pending-message">
          <span className="fp-pending-dot" /> Re-polling 5 sources…
        </div>
      </div>
      <div className="fp-card p-5">
        <div className="text-sm font-medium">Pulse ring</div>
        <p className="mt-1 text-xs" style={{ color: "var(--fg-muted)" }}>
          For the live thing: the source currently fetching, the stage that is running, the cluster
          that just fired.
        </p>
        <div className="mt-3 flex items-center gap-3">
          <span className="relative inline-flex h-2.5 w-2.5">
            <span
              className="fp-pulse-ring absolute inline-flex h-full w-full rounded-full"
              style={{ background: "var(--emerald)" }}
            />
            <span
              className="relative inline-flex h-full w-full rounded-full"
              style={{ background: "var(--emerald)" }}
            />
          </span>
          <span className="text-sm">Polling theverge.com</span>
        </div>
      </div>
    </div>
  );
}

function Patterns() {
  return (
    <div className="space-y-6">
      <div className="fp-card p-6">
        <div className="fp-eyebrow mb-3">Pattern · Page header</div>
        <header className="space-y-1.5">
          <div className="fp-eyebrow">Monday, May 4</div>
          <h3 className="fp-h1 fp-h1-serif" style={{ fontSize: 36 }}>
            Three clusters worth your attention
          </h3>
          <p className="text-sm" style={{ color: "var(--fg-muted)" }}>
            Each folder is a reading lane. Open the strongest cluster, ask for more, or set that
            lane aside for now.
          </p>
        </header>
      </div>

      <div className="fp-card p-6">
        <div className="fp-eyebrow mb-3">Pattern · Empty state</div>
        <div className="fp-card-feature p-8 text-center" style={{ background: "var(--surface)" }}>
          <div
            className="mx-auto mb-3 inline-flex h-12 w-12 items-center justify-center rounded-2xl"
            style={{ background: "var(--indigo-tint)" }}
          >
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--indigo)"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.3-4.3" />
            </svg>
          </div>
          <h4 className="fp-h1-serif" style={{ fontSize: 20 }}>
            Polling your feeds for the first time.
          </h4>
          <p className="mx-auto mt-2 max-w-md text-sm" style={{ color: "var(--fg-muted)" }}>
            Items appear as the first fetch completes. A cluster fires when 3 sources converge on
            the same story within 72 hours.
          </p>
          <div className="mt-4 flex justify-center">
            <button className="fp-btn fp-btn-primary">Run first poll →</button>
          </div>
        </div>
      </div>

      <div className="fp-card p-6">
        <div className="fp-eyebrow mb-3">Pattern · Progress strip</div>
        <div className="flex items-center justify-between text-sm">
          <span className="font-medium">Welcome guide</span>
          <span className="tabular" style={{ color: "var(--fg-muted)" }}>
            2 of 3 done
          </span>
        </div>
        <div
          className="mt-3 h-1.5 overflow-hidden rounded-full"
          style={{ background: "var(--border)" }}
        >
          <div
            className="h-full rounded-full"
            style={{
              width: "66%",
              background: "linear-gradient(90deg, var(--indigo) 0%, var(--rose) 100%)",
            }}
          />
        </div>
        <ol className="mt-3 grid grid-cols-3 gap-2 text-xs">
          {[
            { id: 1, label: "Connect", state: "done" },
            { id: 2, label: "Voice", state: "done" },
            { id: 3, label: "Sources", state: "current" },
          ].map((s) => (
            <li
              key={s.id}
              className="flex items-center gap-1.5"
              style={{
                color:
                  s.state === "done"
                    ? "var(--emerald)"
                    : s.state === "current"
                      ? "var(--indigo)"
                      : "var(--fg-subtle)",
              }}
            >
              <span
                className="inline-flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-semibold tabular"
                style={{
                  background:
                    s.state === "done"
                      ? "var(--emerald-tint)"
                      : s.state === "current"
                        ? "var(--indigo)"
                        : "var(--bg-subtle)",
                  color:
                    s.state === "done"
                      ? "var(--emerald)"
                      : s.state === "current"
                        ? "#fff"
                        : "var(--fg-subtle)",
                }}
              >
                {s.state === "done" ? "✓" : s.id}
              </span>
              <span style={{ fontWeight: s.state === "current" ? 500 : 400 }}>{s.label}</span>
            </li>
          ))}
        </ol>
      </div>

      <div className="fp-card p-6">
        <div className="fp-eyebrow mb-3">Pattern · Editor annotations</div>
        <p className="serif" style={{ fontSize: 17, lineHeight: 1.6 }}>
          The orchard had been there{" "}
          <mark data-fp-ext data-fp-tone="positive">
            since before the war
          </mark>
          , and the warden walked it{" "}
          <mark data-fp-ext data-fp-tone="neutral">
            every Sunday
          </mark>
          ; the grafts had{" "}
          <mark data-fp-ext data-fp-tone="negative">
            begun to fail
          </mark>{" "}
          by the third spring.
        </p>
        <p className="mt-3 text-xs" style={{ color: "var(--fg-muted)" }}>
          Tone-coded underlines for inline extension findings. Positive = mint, neutral = amber,
          negative = peach. Active annotation gets a 2px ink ring on focus.
        </p>
      </div>
    </div>
  );
}

function DontList() {
  const items: Array<{ k: string; why: string }> = [
    {
      k: "No pictographic emojis in UI chrome",
      why: "Buttons, headers, chips stay typographic. Glyphs like → ✓ ⚠ are fine; 🚀 🎉 ✨ are not.",
    },
    {
      k: "No em dashes",
      why: "Use semicolons or two sentences. Em dashes read as AI-default punctuation.",
    },
    {
      k: "No setup-then-reveal headlines",
      why: 'Lead with the fact. "Here\'s what changed: …" becomes "Drafts now sort by voice match."',
    },
    {
      k: "No closures or CTAs",
      why: 'Skip "Hope this helps," "Let me know," "Want me to…" in chat, copy, and empty states.',
    },
    {
      k: "No horizontal rules",
      why: "Use the dotted .fp-divider or whitespace. Solid <hr> reads as Markdown spillover.",
    },
    {
      k: "No multi-tenant chrome",
      why: 'No org switcher, no role badges, no "Acme team" copy. Single-site-single-user is the rule.',
    },
    {
      k: "No push surfaces",
      why: "No badges counting unread, no notification bells, no email digests. Pull-not-push is structural.",
    },
  ];
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {items.map((it) => (
        <div key={it.k} className="fp-card p-5">
          <div className="text-sm font-medium">{it.k}</div>
          <p className="mt-1 text-xs leading-relaxed" style={{ color: "var(--fg-muted)" }}>
            {it.why}
          </p>
        </div>
      ))}
    </div>
  );
}
