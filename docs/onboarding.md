# Onboarding · FlavorPress OSS

A 30-minute walkthrough from clone to publishing your first voice-matched draft.

If you've already read the [README](../README.md), this is the companion: every step expanded with copy-pasteable commands, expected output, and what to check when something is wrong.

---

## What you need

- Node 20 or later. Verify: `node --version` (must be `v20.0.0` or higher).
- Git.
- An Anthropic API key. Get one at https://console.anthropic.com/. Free tier is enough to test.
- A WordPress site you can publish to. Self-hosted, multisite subsite, or WordPress.com all work. Application Passwords must be enabled (default in WP 5.6+).
- 5-10 RSS or Reddit sources you actually read. Bring an OPML export from your reader if you have one; otherwise we'll add manually.
- 30 minutes.

You will not need: an account, a credit card, a server, or any external service besides Anthropic.

---

## Step 1 · Clone and install (3 minutes)

```sh
git clone https://github.com/wpcomvip/flavorpress.git
cd flavorpress
npm install
```

Expected output: a clean `npm install` with no peer-dependency warnings. If you see a Node version error, upgrade to Node 20 with `nvm install 20 && nvm use 20`.

```sh
cp .env.example .env
```

Open `.env` in your editor. The minimum required key:

```
ANTHROPIC_API_KEY=sk-ant-paste-yours-here
```

Leave `LIBSQL_URL` and `LIBSQL_AUTH_TOKEN` unset. You'll get a local SQLite file instead, which is what you want for self-host.

Optional: set `ANTHROPIC_DRAFT_MODEL=claude-sonnet-4-5` if you want to pin a specific Sonnet build.

---

## Step 2 · Smoke-test the foundation (1 minute)

Before connecting anything, verify the core engine runs.

```sh
npx tsx scripts/v1-smoke.ts
```

Expected output:

```
== v1 foundation smoke ==
✓ created user smoke-user with 3 sources
[tr_smoke_1 cluster.engine.layer2] entity+trigram match {...}
[tr_smoke_2 cluster.engine.layer2] entity+trigram match {...}
✓ 1 cluster(s) formed for user smoke-user
  cluster <uuid> state=fired sources=3
✓ ranker composite 0.128 ...
✓ 4 events persisted in event_log
✓ trace tr_smoke_2 has 1 log span(s)
✓ 7 capabilities registered
== smoke complete ==
```

If you see this, the cluster engine, ranker, event bus, capability registry, and trace logger are all wired correctly. If you see errors, jump to [Troubleshooting](#troubleshooting) below before continuing.

---

## Step 3 · Start the dev server (1 minute)

```sh
npm run dev
```

Open http://localhost:3000.

You'll land on the Today screen, which will be empty until you connect a WordPress site, build a voice profile, and add some sources. Let's do that next.

---

## Step 4 · Connect your WordPress site (5 minutes)

In the FlavorPress UI, click "Sources" → "Connect WordPress."

In a different browser tab, log in to your WordPress admin and go to **Users → Profile → Application Passwords**. Type `FlavorPress` as the application name and click "Add New Application Password." WordPress shows the password once, in the format `xxxx xxxx xxxx xxxx xxxx xxxx`. Copy it. (If you lose it, just create another one.)

Back in FlavorPress, fill in:

- **Site URL:** the full URL of your WordPress site, including `https://`. Multisite users: paste the subsite URL, not the network root. Examples:
  - Self-hosted: `https://example.com`
  - WordPress.com: `https://your-site.wordpress.com`
  - Multisite subsite: `https://example.com/site2`
- **Username:** your WordPress username (not display name; the one you log in with).
- **Application Password:** paste the 24-character password from the WP admin. Spaces are fine; FlavorPress strips them.

Click "Connect." FlavorPress runs an auth-detection probe (`GET /wp/v2/users/me`). One of three things happens:

| Result | What it means | Action |
| --- | --- | --- |
| ✓ Connected | Application Password works on the REST API. | Continue to next step. |
| ⚠ Jetpack-managed | Site uses Jetpack SSO; Application Passwords are blocked. | v1.1 will route through Jetpack Connect; for now, deactivate Jetpack SSO temporarily. |
| ✗ 401 / 403 | Custom auth plugin is intercepting REST. | Disable LoginRadius / miniOrange / Auth0 / similar plugins, retry. Re-enable after onboarding. |

The Application Password is encrypted at rest with AES-GCM; the key is derived from a server-side pepper plus a per-user salt, so a DB leak alone doesn't decrypt your credential. To revoke completely, go to WP admin → Application Passwords → Revoke. FlavorPress also has a kill-switch endpoint that issues the WordPress REST `DELETE` for you (useful in incidents).

---

## Step 5 · Build your voice profile (5 minutes)

Click "Voice profile" in the nav. You'll see the empty state with a single button: "Build voice profile from my last 50 posts."

Click it. FlavorPress pulls your archive via `GET /wp/v2/posts?per_page=50&orderby=date` and runs offline stylometric extraction. This takes 30-60 seconds for 50 posts.

When it's done, you'll see:

- **Corpus:** number of posts indexed and total word count.
- **Style sheet:** your average sentence length, sentence-length variance, hedge frequency, em-dash density, opener pattern, closer pattern, quote density. Every line is editable.
- **Vocabulary fingerprint:** signature terms (top 20 over-used vs baseline) and banned terms (bottom 20 under-used). Both are chip-input editable.
- **Anchored exemplars:** initially empty. Click the star next to any past post to anchor it as a "writes like me" reference.

Read through the style sheet. The values should feel right. If they don't:

- Sentence length wrong? You probably have a few outlier posts (e.g. event announcements with very short sentences). Flag them by un-checking from the corpus on the next rebuild.
- Em-dash density above 0 when you don't use em-dashes? Some plugins auto-replace `--` with `—`; FlavorPress just counts what it sees. Ignore for now and add `—` to banned terms.
- Banned terms list looks weird? It's auto-generated from words you under-use vs a generic-blog corpus. Override freely.

Anchor 3-5 posts as exemplars. Pick posts you would say "yeah, that's exactly how I write." These get extra weight at draft time.

Optional but recommended: re-build the profile every month or after every 5 published posts. The decay-weighting tracks recent voice automatically, but a fresh build catches drift faster.

---

## Step 6 · Add sources (5 minutes)

Click "Sources" → "Add source."

Three ways:

**(a) OPML import.** Drag your OPML export into the OPML drop zone. FlavorPress parses and creates a source row per feed. Mixed kinds (RSS, Atom, podcast feeds) all work; FlavorPress detects and routes.

**(b) Paste URLs.** Paste any RSS URL, Reddit subreddit (`https://reddit.com/r/yourthing`), or YouTube channel URL. FlavorPress derives the feed automatically. One paste, multiple URLs (newline-separated), N sources.

**(c) Manual.** Click "+ Add source," type a URL, pick a kind from the dropdown.

Add 5-10 sources to start. Mix types; the cluster engine works best when 3+ outlets cover the same story across distinct domains.

After adding, sources appear in the table with status `active` and `last_polled_at = null`. The first poll happens within 60 seconds; refresh the page to see items flowing in.

---

## Step 7 · Watch the cluster engine work (10-30 minutes)

Cluster formation needs 3 sources covering the same story within a 72-hour window. For most niches, this means waiting a few hours for a real news cluster to form.

To force a cluster for testing, you have three options:

**Test with synthetic sources.** Run the smoke test (`npx tsx scripts/v1-smoke.ts`) again — it always produces a fired cluster.

**Test with a fast-moving niche.** Add 5-10 sources in tech, finance, or gaming; clusters typically form within an hour.

**Just wait.** Open `/sources` → Diagnostics to see live counts. Once `clusters cleared lane-fit floor` is at least 1, you have a draftable cluster.

When a cluster fires, the bus emits `cluster.threshold_crossed` and the voice draft generator runs. Drafts are pre-rendered server-side for the top 5 ranker-ordered clusters per user; cards 2-5 render on tap with a 12-second budget.

---

## Step 8 · Generate your first draft (2 minutes)

Open the home page (`/`) — the Today screen.

You'll see up to 3 cluster cards stacked, ranked by your personal model. Each card shows:

- The cluster headline (auto-extracted from the dominant source title)
- Source list with timestamps
- "Why you" rationale (which past posts this extends, what gap it fills)
- A "Why?" button that flips the card to show the contestable signal panel

Tap "Draft →" on the top card. The editor opens with the pre-rendered draft already loaded — no spinner.

In the editor:

- **Body** is on the left. Headline on top with 3 alternates.
- **Decision Strip** at the top has 2 cells: voice-match (gating) and fact-check (trust). Below 75 voice-match, the draft is flagged.
- **Right rail** has the angle picker, voice-tighten regenerate, quote pool, originality score, and "needs quote" checklist.

Read the draft. If it sounds like you, hit "Publish to WordPress draft" → it lands as a draft on your WP site within 5 seconds. Edit there, hit publish.

If the voice doesn't sound like you:

- **Below 75 voice-match.** Click "Voice-tighten regenerate" — runs the streaming generator again with a stricter prompt and tighter exemplar selection. Should land above 75.
- **Wrong angle.** Click an alternate in the angle picker. Body regenerates under the new angle.
- **Banned word slipped through.** Add it to the banned terms list in `/voice` and regenerate. Future drafts will avoid it.
- **Quote feels forced.** Click swap on the quote in the right rail; the next-best quote from a different source slots in.

Ship it.

---

## Step 9 · Watch the loop work for a week

That's the full v1 loop. From here:

- Drafts pile up as new clusters fire. Top 3 surface; rest live in "Show pool."
- Down-weight any signal in the contestable panel — the ranker learns per-cluster without changing global weights.
- Anchor more posts as you publish ones you like. The voice profile sharpens.
- Add or remove sources as your beat shifts. Ranker recomputes daily.

You'll know v1 is working for you when: you publish 1-2 posts a week with under 20 minutes of editing, and the voice-match score sits above 80 consistently.

---

## Troubleshooting

### `npm install` fails with peer dependency errors

```sh
rm -rf node_modules package-lock.json
npm install
```

### `npx tsx scripts/v1-smoke.ts` fails

Check the trace log:

```sh
sqlite3 .data/flavorpress.db "SELECT span, level, message FROM trace_log ORDER BY occurred_at DESC LIMIT 20"
```

Common failures:

| Failure | Fix |
| --- | --- |
| `ANTHROPIC_API_KEY` missing | Set in `.env`. The smoke test doesn't actually call Anthropic, but the bootstrap registers a capability that requires the key be present. |
| `cluster.engine` failed | Run `sqlite3 .data/flavorpress.db ".schema items"` and verify the schema matches `src/lib/db.ts`. If columns are missing, delete `.data/flavorpress.db` and re-run. |
| `0 capabilities registered` | Check that `ensureRegisteredCapabilities()` is called. It is on first request to `/api/mcp` and on every smoke run. |

### "No clusters forming" after a day

Check Diagnostics on `/sources`. If items are ingesting but clusters aren't firing:

- **Sources too topically diverse.** You need 3+ sources covering the same story. Add more sources per beat.
- **All sources from one domain.** The cluster engine requires 2+ distinct domains. Add a few outlets from different publishers.
- **Window too tight.** The 72-hour rolling window means stories over 3 days old don't combine. This is intentional; we want fresh clusters.

### Voice match consistently below 75

- Profile probably wasn't built well. Re-run from `/voice` with at least 20 posts.
- Anchor 3-5 exemplars. The streaming draft uses them as in-context style examples.
- Check the banned terms list. If real banned words are missing, add them.
- If em-dash density is reading non-zero when you don't use em-dashes, your archive may have plugin-converted dashes. Add `—` and `–` to banned terms.

### WordPress publish failing

- **401 Unauthorized.** Application Password was revoked, or you pasted the wrong username. Re-create.
- **403 Forbidden on `/wp/v2/posts`.** Your role doesn't have publish permissions. Use an Author or Editor account.
- **Connection timeout.** Site is behind Cloudflare with bot protection. Add FlavorPress's User-Agent (`FlavorPressBot/1.0`) to your allowlist or disable bot protection for the REST API path.
- **Posts publish as Classic block.** Confirm Gutenberg block markup output in `src/lib/wordpress.ts`. v1.0 generates `<!-- wp:paragraph -->` for paragraphs, headings, blockquotes, lists. If your theme is custom, test against Twenty Twenty-Five first to isolate.

### Pre-render takes longer than 12 seconds

- `ANTHROPIC_API_KEY` not set → generator returns a stub instantly. Set it.
- Voice profile not built → cold-start regeneration triggers more often. Build it.
- Cluster has too many sources (>10) → context window pressure. Cap source bundle at top-5 by trust score.

### Want to wipe and start over

```sh
rm -rf .data/flavorpress.db
npm run dev
```

The schema rebuilds on first request.

---

## Where to go next

- **Add a custom capability.** Read `src/lib/v1/bootstrap.ts` for examples of every v1 manifest. Add yours, register it, restart the dev server. It shows up in `/api/mcp` automatically.
- **Connect Claude Desktop to the MCP server.** Add `http://localhost:3000/api/mcp` to Claude Desktop's MCP server list with a bearer token. Claude can now call `cluster_read`, `generate_draft`, `voice_check`, and `publish_post` as tools.
- **Run on Vercel.** See the README for deployment. Plan for Turso for libSQL and Upstash for Redis if you go cross-region.
- **Contribute.** Issues and PRs welcome at https://github.com/wpcomvip/flavorpress.

---

## What's next on the roadmap

| Version | Ships when | What |
| --- | --- | --- |
| v1.0 | now | Subscribe (RSS, Reddit, podcasts, YouTube), group, rank, draft, publish |
| v1.1 | ~4 weeks after v1.0 | Push notifications (desktop-first), newsletter forwarding inbox, X connector via official API, Jetpack-managed WordPress, research agent |
| v2 | Q3 2026 | Depth panel, scheduling agent, analytics agent (Jetpack Stats feedback loop), per-user voice LoRA fine-tuning, mobile read view, multisite WordPress |

You can drive any of these forward as a contributor; the architecture is built to plug in without rewriting core code.
