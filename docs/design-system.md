# FlavorPress Design System (WPDS-aligned)

This is the contract for the FlavorPress UI. Every visible surface in the app composes the primitives and tokens listed here. New surfaces should not introduce inline hex codes, ad-hoc spacing, or one-off components without first checking whether one of these primitives or patterns already covers the case.

The runtime reference lives at `/design` in the app. This file is the build-time reference: read it before touching UI.

---

## Direction

WPDS chrome + editorial body. System sans for chrome and forms; Newsreader serif for page titles, article and cluster titles, manuscript headlines. Black accent (`#1e1e1e`); WP blue (`#3858e9`) reserved for inline links only. Hairline borders, 4px default radius, white surfaces on light gray page background, no shadows except on side-sheets and modals.

The aesthetic is "publishing tool" not "admin panel" — but its bones are admin-software conventions because that's what's predictable.

---

## Tokens

All tokens live as CSS custom properties in `src/app/globals.css` and are reachable in Tailwind utility names.

### Surfaces

| Token              | Value     | Use                                                  |
| ------------------ | --------- | ---------------------------------------------------- |
| `--surface-canvas` | `#ffffff` | Cards, manuscript, primary panels                    |
| `--surface-subtle` | `#fafafa` | Page background under cards, side-sheet footer       |
| `--surface-muted`  | `#f6f7f7` | Sidebar background                                   |
| `--surface-tag`    | `#f0f0f1` | Tag chips, page background, inactive surface accents |

### Ink

| Token             | Value     | Use                                        |
| ----------------- | --------- | ------------------------------------------ |
| `--ink-primary`   | `#1e1e1e` | Body text, primary buttons, active accents |
| `--ink-secondary` | `#3c434a` | Excerpt copy, dense body                   |
| `--ink-tertiary`  | `#646970` | Subheads, secondary copy                   |
| `--ink-muted`     | `#787c82` | Eyebrows, meta lines, hint text            |

### Border

| Token              | Value     | Use                                                                       |
| ------------------ | --------- | ------------------------------------------------------------------------- |
| `--border-default` | `#dcdcde` | All hairline borders                                                      |
| `--border-strong`  | `#1e1e1e` | Section dividers, emphasis card spine                                     |
| `--border-input`   | `#8c8f94` | Form inputs (slightly darker than surface borders to read as interactive) |

### Accent

| Token           | Value     | Use                                                                       |
| --------------- | --------- | ------------------------------------------------------------------------- |
| `--accent`      | `#1e1e1e` | Active tab underline, primary CTA, chips on state                         |
| `--accent-blue` | `#3858e9` | Inline links and inline-edit affordances **only** — never primary buttons |

### Semantic

| Token                           | Value                 | Use                                                  |
| ------------------------------- | --------------------- | ---------------------------------------------------- |
| `--success-bg` / `--success-fg` | `#e6f7ec` / `#0a5a2e` | "Connected", supported facts, positive trust         |
| `--warn-bg` / `--warn-fg`       | `#fdf6e3` / `#896200` | Stale drafts, medium trust, "Action needed"          |
| `--error-bg` / `--error-fg`     | `#fcebec` / `#8a1f24` | Disconnected, disputed facts, low trust, danger zone |

### Type

| Token            | Value  | Use                                                                    |
| ---------------- | ------ | ---------------------------------------------------------------------- |
| `--type-display` | `36px` | Page titles (Newsreader, weight 500)                                   |
| `--type-h1`      | `24px` | Page titles for dense surfaces (Sources, Drafts)                       |
| `--type-h2`      | `18px` | Section headers, card titles (Newsreader on editorial; Inter on dense) |
| `--type-body`    | `13px` | Default body                                                           |
| `--type-meta`    | `11px` | Eyebrows, footnotes, stats                                             |
| `--type-eyebrow` | `10px` | Uppercase eyebrow with letter-spacing 0.06em                           |

### Radius

| Token           | Value   | Use                                |
| --------------- | ------- | ---------------------------------- |
| `--radius-sm`   | `2px`   | Buttons, inputs (admin-tight)      |
| `--radius-md`   | `4px`   | Cards, side-sheets, panels         |
| `--radius-lg`   | `6px`   | Frame, app shell                   |
| `--radius-pill` | `999px` | Chips, status badges, deck buttons |

### Motion

| Token        | Value                            | Use             |
| ------------ | -------------------------------- | --------------- |
| `--duration` | `150ms`                          | All transitions |
| `--ease`     | `cubic-bezier(0.22, 1, 0.36, 1)` | All transitions |

Reduced-motion media query in `globals.css` zeros transitions and animations. Always works through that media query, not around it.

---

## Components (`src/components/wpds/`)

All primitives are TypeScript + React + Tailwind. They expose a small, focused prop surface and accept `className` for composition.

### `<Button />`

```tsx
<Button>Save</Button>
<Button variant="secondary">Cancel</Button>
<Button variant="danger">Discard</Button>
<Button variant="link">Skip</Button>
<Button size="sm" variant="secondary">Sync</Button>
```

**Variants:** `primary` (default, black), `secondary` (white outlined), `danger` (white bg, red text), `link` (transparent).
**Sizes:** `md` (default, 6×14px padding) and `sm` (4×10px padding).
**Forwards** all native `<button>` props (`onClick`, `disabled`, `type`, `aria-*`, etc.).

Use `primary` for the most important action on a surface. Use `secondary` for everything else. Use `danger` for destructive actions. Use `link` for "skip / dismiss / not a story" style affordances.

### `<Card />`

```tsx
<Card>...</Card>
<Card emphasis>...</Card> {/* black left border, used for single-source / "saved" cards */}
```

White surface, hairline border, 4px radius, 18×20px padding. Hover lifts the border to `--ink-muted`.

### `<Chip />`

```tsx
<Chip label="Coffee" count={9} />
<Chip label="All" active />
```

Pill-shaped, 11px text. Active state inverts (black bg, white text). Use for filters, folder selectors, tag-style labels.

### `<SideSheet />`

```tsx
<SideSheet open={isOpen} onClose={close} title="Add feed" footer={<Button>Add</Button>}>
  ...
</SideSheet>
```

Right-side overlay, default 480px wide. Closes on Escape and scrim click. Title is rendered in Newsreader. Footer pinned to bottom with `--surface-subtle` background.

Use for: Draft Wizard, Add Feed, Connect WP Site, any flow that the user needs to complete-or-cancel without losing the page underneath.

### `<Notice />`

```tsx
<Notice tone="info">First-run guidance</Notice>
<Notice tone="warn">Stale draft</Notice>
<Notice tone="error">Connection failed</Notice>
<Notice tone="success">Saved</Notice>
```

Left-bordered banner with semantic background tint. Use for inline page-level messages. Avoid in cards (cards already carry the message).

### `<StatusBadge />`

```tsx
<StatusBadge status="ok">Connected</StatusBadge>
<StatusBadge status="warn">Action needed</StatusBadge>
<StatusBadge status="error">Disconnected</StatusBadge>
<StatusBadge status="default-outlet">Default</StatusBadge>
```

Small rounded pill. Use for connection state, trust level, default-outlet flag.

### `<Field />`

```tsx
<Field label="Site URL" hint="The base URL of your WordPress site.">
  <input type="url" />
</Field>
```

Renders a label + child input + optional hint. The label is uppercase eyebrow style. Inputs/textareas inside `.wpds-field` get the standard 1px input border and focus ring (1px shadow on `--ink-primary`).

### `<MasterDetail />`

```tsx
<MasterDetail sidebar={<Sidebar />}>
  <Detail />
</MasterDetail>
```

Two-pane layout: 220px sidebar (configurable via `sidebarWidth`) + flexible right pane. Sidebar uses `--surface-subtle`. Used by `/voice` and `/settings`.

### `<Tabs />` (planned, Task 2.x)

Wraps the app shell tab nav and the bucket tabs on `/drafts`. Style is "underline-active." Each tab is a link or a button depending on whether it routes.

---

## Patterns

These compose primitives. Each pattern has one canonical implementation; copy from the canonical file when introducing the pattern on a new surface.

### Page header

Used at the top of every full-page surface.

```tsx
<header className="page-header">
  <h1 className="page-title">Today</h1>
  <div className="page-sub">Three clusters worth drafting</div>
  <div className="page-actions">
    <Button variant="secondary">Sync sources</Button>
  </div>
</header>
```

- `page-title` is Newsreader, 30px, weight 500, letter-spacing -0.01em.
- `page-sub` is italic, 13px, tertiary ink.
- `page-actions` is right-aligned via flex (or absolute-positioned for tighter top-right placement).

Canonical: `src/app/page.tsx` (Today).

### Stats strip

Compact horizontal stats row. Three or four `<span><b>N</b> label</span>` items. Used on Today.

```css
.fp-today-stats {
  /* see globals.css */
}
```

Canonical: `src/app/_components/TodayStats.tsx`.

### Folder section (collapsible)

Bordered `Newsreader` header + collapsible body. One folder expanded by default; rest collapsed. Used on Today.

Canonical: `src/app/_components/TodayFolderStreams.tsx`.

### Cluster card (default)

```tsx
<Card>
  <div className="cc-meta">Cluster · 4 sources · 2h ago</div>
  <h3 className="cc-title">{title}</h3>
  <p className="cc-summary">{summary}</p>
  <div className="cc-sources">{sources.join(" · ")}</div>
  <div className="cc-tags">
    {tags.map((t) => (
      <span className="tag">{t}</span>
    ))}
  </div>
  <div className="cc-actions">
    <Button>Draft for {outlet}</Button>
    <Button variant="secondary">Open cluster</Button>
    <Button variant="link" style={{ marginLeft: "auto" }}>
      Not a story
    </Button>
  </div>
</Card>
```

Single-source variant uses `<Card emphasis>` and changes the eyebrow to `Saved · {source name} · marked Xh ago`. No source list.

Canonical: `src/app/_components/TodayFolderStreams.tsx`.

### Compact row (Sources)

Grid layout: checkbox · name+URL+tags · stats · last-poll · trust · routing button · sync button. Hairline `--border-default` divider between rows, no card frame.

Canonical: `src/app/sources/_components/SourcesExplorer.tsx`.

### Bucket tabs (Drafts, Editor rail)

Underline-active tabs in a horizontal row. Counts shown inline as small `--surface-tag` pills next to the label.

Canonical: `src/app/drafts/_components/BucketTabs.tsx` and `src/app/editor/[draftId]/_components/EditorRail.tsx`.

### Master-detail

Sidebar of items + right pane of detail. Sidebar items use `display:block` with selected state shown via `inset 3px 0 0 var(--ink-primary)` left shadow. Width: 220–240px sidebar.

Canonical: `src/app/voice/page.tsx` and `src/app/settings/page.tsx`.

### Side-sheet wizard (multi-step)

Step bar at top (label + 3 progress pills). Step body. Footer with Back / Just go / Next or Submit. Uses `<SideSheet>`.

Canonical: `src/app/_components/DraftWizardSheet.tsx`.

### Inline status

`<StatusBadge>` placed inline next to a name or row. For long lists (like outlets), disconnected items dim to 0.7 opacity in addition to showing the badge.

---

## Anti-patterns

These are what NOT to do; flag them in code review.

- **No new hex codes in JSX.** If you need a color, it's a token. If the token doesn't exist, propose adding it to `globals.css` first.
- **No pictographic emojis** in chips, headers, buttons, copy. Typographic glyphs (`→`, `↗`, `✓`, `✕`) are fine.
- **No em-dashes** in code, comments, copy, or generated text. Use semicolons or rephrase.
- **No setup-then-reveal sentences** in copy. Lead with the fact.
- **No closures, sign-offs, or "want me to" appendixes** in any user-facing text.
- **No multi-tenant chrome** (org switchers, role pickers, network admin, audit log links). Single-author single-app.
- **No push notifications, digest emails, or scheduled auto-publish.** This is a pull-based product.
- **No "preview" buttons** on cluster cards or anywhere else as a hook for engagement; if a card is interactive, its primary action ships the user toward writing.
- **No voice-match score on cluster cards.** Voice match is a post-draft check; surfacing it earlier is decoration that breaks the no-slop rule (it tempts the user to game the score before drafting).
- **No mobile-first breakpoints** below 720px. Graceful degradation is fine; pixel-perfect mobile is out of scope.
- **No tag editing UI.** Tags are LLM-extracted at item ingest. They're a matching primitive, not a user-curated taxonomy.

---

## Adding a new component

If a new surface needs a primitive that doesn't exist:

1. Check `src/components/wpds/` first.
2. Check the patterns above.
3. If still nothing fits, propose the addition. Three questions to answer:
   - Is this used in two or more places? (If not, it's not a primitive — it's a one-off.)
   - Does it carry a clear, single responsibility?
   - Does it compose existing primitives, or does it duplicate them?
4. Add to `src/components/wpds/`, write tests in `src/components/wpds/__tests__/`, document here.
5. Don't forget the barrel export in `src/components/wpds/index.ts`.

---

## File map

```
src/components/wpds/
├── Button.tsx
├── Card.tsx
├── Chip.tsx
├── Field.tsx
├── MasterDetail.tsx
├── Notice.tsx
├── SideSheet.tsx
├── StatusBadge.tsx
├── Tabs.tsx                    (planned)
├── index.ts                    (barrel)
└── __tests__/
    ├── Button.test.tsx
    ├── Card.test.tsx
    ├── Chip.test.tsx
    ├── Field.test.tsx
    ├── MasterDetail.test.tsx
    ├── Notice.test.tsx
    ├── SideSheet.test.tsx
    └── StatusBadge.test.tsx

src/app/globals.css             (tokens + utility classes)
src/app/_components/ShellNav.tsx (top tabs)
src/app/_components/DraftWizardSheet.tsx (wizard reference impl)

docs/design-system.md           (this file)
docs/superpowers/specs/2026-05-06-wpds-ui-redesign-design.md (spec)
docs/superpowers/plans/2026-05-06-wpds-ui-redesign.md (plan)
```
