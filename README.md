# FlavorPress

> Your reading turns into your writing.

FlavorPress watches the sources you already follow, groups them into clusters when 3+ outlets cover the same story, and drafts a 600-word post in your voice ready to publish to WordPress. It is built for niche bloggers who already run a 60-90 minute morning reading routine and want the writing step to take 15 minutes instead of 60.

This repo is the open-source core. Self-host it, bring your own LLM key, run it on your own machine forever, or deploy to Vercel and use the hosted SaaS at flavorpress.io for the conveniences (managed forwarding, hosted MCP delivery, transcription credits).

**License:** MIT.
**Status:** v1 alpha. The foundation is solid (cluster engine, capability registry, event bus, MCP server, RSS connector, voice profile, streaming draft generator). Some pieces are stubbed for v1.0 and ship in v1.1: push notifications (desktop-first), depth panel, fact-check + originality LLM passes, OAuth-based source connectors.

---

## What you get out of the box

- **Subscribe** to your own sources: RSS, Reddit, podcasts, YouTube. (Newsletter forwarding and X arrive in v1.1.)
- **Group** them with a 3-layer cluster engine: canonical URL match, named-entity overlap + title trigram, sentence-embedding cosine.
- **Rank** clusters with a 3-signal personal model: archive overlap, beat match, source trust. Down-weight any signal per cluster; the ranker learns.
- **Draft** a 600-word post in your voice via streaming Anthropic Claude, with Haiku as the default and a mid-flight Burrows' Delta voice check that cancels and restarts if the draft drifts.
- **Publish** to your WordPress site via Application Password, as a draft, scheduled, or live.
- **Extend** with capabilities. Every internal feature (cluster engine, voice generator, fact-check, originality, source connectors) is a manifest in the capability registry. Future agents (research, scheduling, analytics) plug in via the same contract. The MCP server at `/api/mcp` exposes them to Claude Desktop and other AI agents.

## Quick start

Two paths depending on whether you want to hack on the code or just run the app.

### Option A: macOS app (Apple Silicon)

Self-contained `.app` that bundles its own Node and the Next.js server. No `npm` required to run it.

```sh
git clone https://github.com/wpcomvip/flavorpress.git
cd flavorpress
npm install
npm run mac:run
```

Drag `macos/build/FlavorPress.app` into `/Applications`. Right-click → Open the first time (Gatekeeper warns on ad-hoc signed bundles). Then open **FlavorPress → Open Settings** (⌘,) and paste your Anthropic API key. State lives in `~/Library/Application Support/FlavorPress/`; logs in `~/Library/Logs/FlavorPress/server.log`. See [`macos/README.md`](macos/README.md) for details.

### Option B: run from source (5 minutes)

```sh
git clone https://github.com/wpcomvip/flavorpress.git
cd flavorpress
npm install
cp .env.example .env
# edit .env: at minimum, set ANTHROPIC_API_KEY
npm run dev
```

Open http://localhost:3000. The app boots with an empty SQLite database at `.data/flavorpress.db`. Accounts are gated by single-use invite tokens; see the Auth section below for the full signup flow.

To verify the foundation is wired correctly:

```sh
npx tsx scripts/v1-smoke.ts
```

You should see 7 capabilities registered, 3 sources created, 1 cluster fired (entity overlap 5/5, cosine 0.99), and the ranker compute a composite. If any step fails, the trace logs are in the `trace_log` table; query by `trace_id` to debug.

## Auth

FlavorPress is multi-user. Accounts are gated by single-use invite tokens. The
first signup whose email matches `FLAVORPRESS_ADMIN_EMAIL` becomes the admin.

Quickstart:

1. Set `FLAVORPRESS_ADMIN_EMAIL` in `.env` to your email.
2. Set `FLAVORPRESS_SESSION_SECRET` to a 32+ byte random string.
3. Run `npm run dev -- --experimental-https` for browser signup and login.
4. In another terminal, issue your invite: `npm run auth:invite`.
5. Open the printed URL, sign up with the email from step 1, and pick a password.

Session cookies use the `__Host-` prefix and always require HTTPS. Plain
`npm run dev` still works with `FLAVORPRESS_AUTH=local`, because local mode
bypasses browser session cookies.

Admin CLIs:

- `npm run auth:invite -- [--days N]` issues a single-use invite token.
- `npm run auth:reset -- <email>` resets a user's password to a printed random
  temporary value and bumps the session version, killing any existing sessions.
- `npm run auth:promote -- <email>` flips an existing user to admin.
- `npm run auth:claim -- <email>` re-keys orphaned `default-user` rows to a
  real account if the auto-migration on first signup did not run.

These are wrappers around `tsx --conditions=react-server`; the flag is required
because the underlying modules use `import "server-only"`.

### Local mode (macOS app, single-user dev)

Set `FLAVORPRESS_AUTH=local` to skip signup and login entirely. Every
request resolves to a bootstrap admin user with id `default-user`. Any
pre-existing single-user data on disk (e.g., from an earlier FlavorPress
build) is picked up without an explicit migration. The macOS launcher
sets this for you; for local dev, add `FLAVORPRESS_AUTH=local` to `.env`.

Override the bootstrap email via `FLAVORPRESS_LOCAL_EMAIL=you@example.com`.
Set `FLAVORPRESS_DEBUG_ADMIN=1` to show `/settings/admin` in local mode.

### Email

Transactional email (signup verification + self-serve password reset) is
sent via Resend. In development, leave `RESEND_API_KEY` unset and emails
print to the console with the full body and URL. In production this key
is required.

Forgotten password (self-serve): visit `/reset-password`, enter your
email, click the link in the email, set a new password. The reset bumps
your session version so any old sessions die.

Admin-side reset (still available): `npm run auth:reset -- <email>`.

### Sign in with WordPress.com

When `WPCOM_OAUTH_CLIENT_ID` and `WPCOM_OAUTH_CLIENT_SECRET` are set,
"Sign in with WordPress.com" and "Sign up with WordPress.com" buttons
appear on the login and signup pages. Signup still requires an invite
token.

Register an app at developer.wordpress.com with redirect URI
`<FLAVORPRESS_ORIGIN>/api/auth/wpcom/callback`. For local development,
also register `http://localhost:3000/api/auth/wpcom/callback`.

## Configuration

`.env` keys. Anthropic auth is optional for local drafting when Claude Code is installed and logged in; fact-check still requires an API key.

| Key                                    | Required          | Purpose                                                                                                                                                                                                                                                                        |
| -------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ANTHROPIC_API_KEY`                    | no                | Claude calls for the draft generator when configured, and required for fact-check. Without it, drafting can use a local Claude Code login; if neither auth path is available, the generator returns a deterministic stub so the loop still closes for local dev.               |
| `FLAVORPRESS_ADMIN_EMAIL`              | yes in production | Email address of the initial admin user. The first signup matching this address is promoted to admin and can issue invites.                                                                                                                                                    |
| `FLAVORPRESS_SESSION_SECRET`           | yes in production | Secret used to sign the HttpOnly session cookie. Use at least 32 random bytes. Defaults to a placeholder in local dev only.                                                                                                                                                    |
| `FLAVORPRESS_ORIGIN`                   | yes in production | Public app origin, for example `https://your-flavorpress.example.com`. Production fails closed without this so callbacks and mutation checks do not trust arbitrary Host headers.                                                                                              |
| `FLAVORPRESS_ENCRYPTION_KEY`           | yes               | AES-GCM key required before FlavorPress boots in every non-test runtime. Protects WordPress Application Passwords and sensitive settings stored in the database. Generate one with `npm run gen-encryption-key`.                                                               |
| `FLAVORPRESS_ALLOWED_ORIGINS`          | no                | Optional comma-separated allowlist for trusted reverse proxy origins on mutation requests. The current request origin is always allowed.                                                                                                                                       |
| `FLAVORPRESS_DEBUG_ADMIN`              | no                | Set to `1` to expose `/settings/admin` while `FLAVORPRESS_AUTH=local` is active. Local mode hides admin by default.                                                                                                                                                            |
| `CRON_SECRET`                          | yes on Vercel     | Bearer token Vercel Cron sends to `/api/cron/poll`. Production returns 500 when unset so source polling is not exposed as a public mutation route.                                                                                                                             |
| `FLAVORPRESS_CRON_MAX_BATCH`           | no                | Maximum active sources a cron tick polls before returning. Defaults to 5 so minute-level Vercel Cron stays under the function timeout while still working through due sources continuously.                                                                                    |
| `FLAVORPRESS_CRON_TIME_BUDGET_MS`      | no                | Wall-clock budget for a cron tick. Defaults to 45000ms; the runner stops claiming sources before the budget expires so Vercel gets a normal response instead of a timeout.                                                                                                     |
| `ANTHROPIC_DRAFT_MODEL`                | no                | Model name. Defaults to `claude-haiku-4-5-20251001`.                                                                                                                                                                                                                           |
| `FLAVORPRESS_LOCAL_CLAUDE`             | no                | Set to `1` to force the local Claude Code login path. When unset, FlavorPress auto-detects: if no API key is configured and `claude` is on PATH, it rides your Claude Code login via `@anthropic-ai/claude-agent-sdk` (same approach Conductor uses). Not supported on Vercel. |
| `FLAVORPRESS_ANTHROPIC_PROXY_URL`      | no                | Optional server-side Anthropic-compatible proxy base URL. When paired with `FLAVORPRESS_ANTHROPIC_PROXY_TOKEN`, this takes precedence over user API keys so hosted deployments can route provider calls through their own gateway.                                             |
| `FLAVORPRESS_ANTHROPIC_PROXY_TOKEN`    | no                | Secret token for the server-side Anthropic proxy. Sent as `X-Api-Key`. Keep this in deployment env only; never expose it to browsers or app clients.                                                                                                                           |
| `FLAVORPRESS_ANTHROPIC_PROXY_FEATURE`  | no                | Optional feature header value for gateways that attribute usage by feature.                                                                                                                                                                                                    |
| `LIBSQL_URL`                           | no                | Set for hosted Turso. Leave unset for local SQLite at `.data/flavorpress.db`.                                                                                                                                                                                                  |
| `LIBSQL_AUTH_TOKEN`                    | no                | Required if `LIBSQL_URL` is set.                                                                                                                                                                                                                                               |
| `INBOUND_SECRET`                       | no                | Webhook secret for `/api/inbound` (newsletter forwarding, v1.1).                                                                                                                                                                                                               |
| `FLAVORPRESS_NOTIFICATION_WEBHOOK_URL` | no                | Optional endpoint for first-activation notifications: email signup, first WordPress site connected, first source connected, first draft created, and first post pushed to WordPress.                                                                                           |
| `FLAVORPRESS_MCP_TOKEN`                | no                | Bearer token for `/api/mcp` `tools/call`. When unset, tool calls are disabled; discovery works only without an Authorization header.                                                                                                                                           |
| `FLAVORPRESS_TIER`                     | no                | `oss` (default) or `saas`. Gates capability registration: SaaS-only manifests refuse to register on the OSS tier.                                                                                                                                                              |
| `OPENAI_API_KEY`                       | no                | Used for `text-embedding-3-small` once cluster engine layer 3 ships. v1.0 layers 1 and 2 only.                                                                                                                                                                                 |

## How to use it

### 1. Connect a WordPress site

Visit `/site`. You need:

- **Site URL:** the home URL of your WordPress site, e.g. `https://yourblog.com`. Multisite users: paste the subsite URL, not the network root.
- **Username:** your WordPress username.
- **Application Password:** create one in WP Admin → Users → Profile → Application Passwords. Name it "FlavorPress" so you can revoke later. The plaintext password is shown once; paste it here.

FlavorPress runs an auth-detection probe (`GET /wp/v2/users/me`) before saving. If your site has Jetpack SSO, miniOrange, or another custom auth plugin in the way, you'll see a clear error and a routing suggestion (Jetpack-managed sites are deferred to v1.1).

The Application Password is encrypted at rest with AES-GCM and decrypted only inside the publish capability. To revoke everywhere: WP Admin → Application Passwords → Revoke. FlavorPress's kill-switch endpoint (`POST /api/v1/wp/revoke`) issues the WordPress REST `DELETE` for you.

### 2. Build a voice profile

Visit `/voice`. Click "Build voice profile from my last 50 posts." FlavorPress pulls your archive via the WP REST API and extracts a stylometric fingerprint:

- Function-word distribution (Burrows' Delta basis)
- Sentence-length mean and variance
- Hedge frequency (per 1000 tokens)
- Em-dash density (per 1000 tokens; for many writers this is 0)
- Vocabulary fingerprint (top 20 over-used signature terms; bottom 20 banned terms)
- Opener patterns (first 3 tokens of each sentence; top 20)

Recency-decay weighting kicks in automatically: posts in the last 30 days carry weight 1.0; 31-90 days 0.7; 91-365 days 0.4; older 0.1. Voice profile naturally tracks authentic voice drift.

The whole style sheet is editable. Click any line to override an extracted value. The banned terms list is a chip-input; add or remove terms as you go and they take effect on the next draft generation.

If your archive contains posts written by ghostwriters or guest authors, the voice profile build runs a k=2 cluster on per-post function-word distributions; if two distinct writer-clusters appear, you'll get a "your archive looks like two writers; pick which one is you" prompt before profile build.

Anchor up to 10 posts as exemplars by clicking the star next to a post in the list. Anchored posts get extra weight in retrieval at draft time.

### 3. Add sources

Visit `/sources`. Three ways to add:

**OPML import.** Drag your OPML export from Feedly, Inoreader, Reeder, or NetNewsWire into the OPML drop zone. FlavorPress parses it and creates a source row per feed.

**Paste URLs.** Paste any RSS/Atom URL, a Reddit subreddit URL, a YouTube channel URL, or a podcast RSS URL. FlavorPress auto-detects the type. Mixed lists work; one paste, N sources.

**Manual add.** Click "+ Add source," type a URL, pick a kind. For Reddit, paste the subreddit URL (`https://reddit.com/r/yourthing`); FlavorPress derives the RSS feed automatically.

Sources poll on a per-kind cadence: RSS every 5 minutes, Reddit every 5 minutes, podcasts and YouTube every hour. Sources you cite often poll faster automatically once the ranker has data.

### 4. Watch the cluster engine

Once you have ~10 sources active, the cluster engine starts forming clusters in the background. Open `/sources` and expand the Diagnostics panel to see live counts:

- Items ingested (last 24h)
- Clusters formed today
- Clusters cleared the lane-fit threshold (3+ sources from 2+ distinct domains)
- Time since last fetch

You don't have to watch any of this; the Today screen surfaces the top 3 ranker-ordered clusters whenever you open it.

### 5. Draft and publish

Open `/` (the Today screen). You'll see exactly 3 cluster cards, ranked by your personal model. The top card has a draft pre-rendered server-side; tap it and the editor opens instantly. Cards 2 and 3 render on tap with a 12-second budget.

In the editor:

- The draft body is on the left.
- The Decision Strip at the top shows two cells: **voice-match** (gating signal; below 75 the draft surfaces with a warning) and **fact-check** (trust signal; flagged claims get yellow chips).
- The right rail handles angle picker (archive habit vs cluster-derived gap), voice-tighten regenerate, quote pool with rejected-pool audit, originality score, and a "needs quote" checklist for any unresolved markers in the draft.

Hit Publish to push to WordPress. Default is `status=draft`; pick `publish` for live or `future` to schedule. Drafts use Gutenberg block markup, not raw HTML, so they render cleanly in the editor and on block-themed sites.

### 6. Extend with capabilities (advanced)

FlavorPress is built around a typed capability registry and an event bus. Every feature, including cluster engine, voice draft generator, fact-check, originality, WordPress publish, and source connectors, is a manifest. New capabilities ship as new files in `src/lib/v1/capabilities/` plus a `register()` call in `src/lib/v1/bootstrap.ts`.

Minimal example: a research agent that subscribes to `cluster.threshold_crossed` and pulls primary sources from arXiv:

```ts
import { z } from "zod";
import { getRegistry } from "@/lib/v1/capability-registry";

await getRegistry().register({
  id: "research-agent.arxiv",
  version: "1.0.0",
  description: "Pulls arXiv primary sources for an academic-cluster topic.",
  inputSchema: z.object({ clusterId: z.string() }),
  outputSchema: z.object({ papers: z.array(z.object({ url: z.string(), title: z.string() })) }),
  latencyBudgetMs: 8000,
  tier: "both",
  requiresAuth: false,
  subscribesTo: ["cluster.threshold_crossed"],
  emits: [],
  costClass: "medium",
  tags: ["agent.editor", "agent.research"],
  invoke: async (input, ctx) => {
    // your arXiv search; emit to event bus or render in agent slot
    return { papers: [] };
  },
});
```

Once registered, your capability shows up in the editor's right-rail agent slot and is callable as an MCP tool from external agents (Claude Desktop, GPT, custom).

## Architecture

A 30-second tour. The data flow is `subscribe → group → rank → draft → publish`, end-to-end driven by the event bus.

```
+----------------+      +------------------+      +----------------+
| Source         |      | Cluster engine   |      | Personal       |
| connectors     +----->+ (3-layer dedupe  +----->+ ranker         |
| (RSS, Reddit,  |      | + cluster fire)  |      | (3 signals)    |
|  podcast, YT)  |      +------------------+      +-------+--------+
+----------------+                                        |
                                                          v
+----------------+      +------------------+      +----------------+
| Voice profile  |<-----+ Draft generator  |<-----+ Pre-render     |
| (style sheet + |      | (streaming +     |      | (top-5)        |
| RAG index)     |      | mid-flight check)|      +----------------+
+----------------+      +--------+---------+
                                 |
                  +--------------+--------------+
                  v              v              v
          +-------+----+  +------+-----+  +-----+------+
          | Fact-check |  | Originality|  | WordPress  |
          | pass       |  | check      |  | publish    |
          +------------+  +------------+  +------------+

                Event bus (in-memory + Redis cross-region)
                MCP server at /api/mcp surfaces all capabilities
```

The full architecture spec lives in [`docs/architecture.md`](docs/architecture.md). Read alongside this README. Key calls:

- **Multi-tenancy:** single shared libSQL with logical tenancy via `user_id` row filtering. Per-user encryption is application-layer envelope encryption on sensitive columns (Application Password, archive blobs).
- **Event bus:** Upstash Redis pub/sub primary in production; in-memory `EventEmitter` for local dev and within-request fanout. Every event persists to `event_log` before fanout for audit and replay.
- **Cluster cache:** canonical-URL + content-hash keyed embedding cache shared across users (no user attribution). Embedding model + version columns on every cache row so model upgrades don't silently break clusters.
- **Voice profile:** RAG over the user's WordPress archive plus a Burrows' Delta style sheet. Not per-user LoRA; fine-tuning loses to in-context retrieval at MVP scale and the LoRA economics break under 500 published posts per user.
- **Capability registry:** typed manifests with version pinning. Drafts in `state='pre-rendered'` keep their original capability version through to publish so a v2 capability ship doesn't break in-flight work.
- **MCP server:** `/api/mcp` advertises protocol version `2024-11-05`. `tools/list` discovery works without credentials when no `Authorization` header is sent. `tools/call` requires `Authorization: Bearer <FLAVORPRESS_MCP_TOKEN>` and is disabled when `FLAVORPRESS_MCP_TOKEN` is unset. When MCP 2.0 ships, we serve `/api/mcp/v2` alongside `/api/mcp` (1.x) and the registry routes capability invocations to the right protocol.

## Development

```sh
npm run dev        # Next.js dev server on :3000; add -- --experimental-https for login
npm run build      # production build
npm run lint       # ESLint
npx tsx scripts/v1-smoke.ts    # smoke test the v1 foundation
```

Project layout:

```
src/
├── app/
│   ├── api/
│   │   ├── inbound/route.ts    # newsletter forwarding webhook (v1.1)
│   │   └── mcp/route.ts        # MCP server endpoint
│   ├── draft/[id]/             # editor view (v0.1; v1 ships /editor next pass)
│   ├── forward/                # v0.1 forward-and-draft UI; deprecated for v1
│   ├── site/                   # WordPress connection UI
│   ├── voice/                  # voice profile UI
│   └── page.tsx                # home (v1 will be Today / three-card)
├── lib/
│   ├── db.ts                   # libSQL client + schema (v0.1 + v1 tables)
│   ├── anthropic.ts            # Anthropic SDK helpers
│   ├── wordpress.ts            # WP REST + Application Password
│   └── v1/                     # v1 niche-blogger architecture
│       ├── types.ts            # canonical type contract
│       ├── trace.ts            # trace ID + structured logger
│       ├── event-bus.ts        # Redis-primary event bus
│       ├── capability-registry.ts
│       ├── source-connector.ts # connector contract
│       ├── connectors/
│       │   └── rss.ts          # RSS/Atom connector
│       ├── cluster-engine.ts   # 3-layer pipeline
│       ├── ranker.ts           # 3-signal personal ranker
│       ├── style-sheet.ts      # Burrows' Delta extraction
│       ├── draft-generator.ts  # streaming Claude draft + voice check
│       └── bootstrap.ts        # capability registration
└── scripts/
    └── v1-smoke.ts             # foundation verification
```

## Deploying

### Self-host with Docker

```sh
docker compose up
```

The compose file boots the Next.js app + a libSQL container with a mounted volume. Default port 3000. Production sites should set `ANTHROPIC_API_KEY` in `.env` and either use the bundled libSQL or point `LIBSQL_URL` at a hosted Turso instance.

### Vercel

```sh
vercel link
vercel env add ANTHROPIC_API_KEY
vercel env add LIBSQL_URL
vercel env add LIBSQL_AUTH_TOKEN
vercel deploy
```

The deployment is a single Vercel project. Edge functions handle high-velocity poll endpoints; node functions handle LLM calls. Turso provides per-region libSQL; Upstash Redis handles event bus pub/sub if you want cross-region fanout.

## Troubleshooting

**"No clusters forming."** Check `/sources` Diagnostics. If items are ingesting but clusters aren't firing, you probably need 3+ sources covering the same topic within 72 hours. Layer 1 needs an exact canonical URL match (rare across domains); Layer 2 needs entity overlap of 3 of 5 plus a title trigram cosine of 0.6+. If your sources are too topically diverse, consider grouping by beat and adding more sources per beat.

**"Voice match below 75 on every draft."** The voice profile probably wasn't trained well. Re-run the build from `/voice` with at least 20 posts. If it's still low, anchor 3-5 posts as exemplars. The streaming draft will use them as in-context style examples.

**"WordPress publish failing."** Run the auth-detection probe at `/site`. If you see a Jetpack SSO error, the site uses Jetpack's REST auth and Application Passwords are blocked; v1.1 routes through Jetpack Connect. Custom auth plugins (LoginRadius, miniOrange, Auth0) are also detected; the error message tells you which plugin to disable for FlavorPress's REST API access.

**"Pre-render takes longer than 12 seconds."** Check that `ANTHROPIC_API_KEY` is set; without it the generator returns a stub. Also check that your voice profile is built; cold-start without exemplars takes longer because the streaming voice check fails more often and triggers regeneration.

**"`npx tsx scripts/v1-smoke.ts` fails."** Run `npm install` first. The smoke script needs `tsx` from devDependencies. If specific assertions fail, check the trace logs:

```sh
sqlite3 .data/flavorpress.db "SELECT * FROM trace_log ORDER BY occurred_at DESC LIMIT 20"
```

## Contributing

We are two people building this in 21 days. Issues and PRs are welcome but expect slow review. The fastest path to seeing your contribution land is:

1. Open an issue first describing what you want to build.
2. If it's a new capability, ship the manifest + invoke + a test rather than touching core code.
3. Match the writing style of the existing code (no em-dashes anywhere, including comments).

The architecture spec ([`docs/architecture.md`](docs/architecture.md)) is the canonical contract. If you're proposing a change to the loop or the data model, propose the spec change first.

## License

MIT. See [LICENSE](LICENSE).

## Built by

Lucas Radke and Matthias Reinholz, during Automattic's Radical Speed Month, April-May 2026. Two product people, agent-driven build, three weeks. The pitch deck and process notes are at [flavorpress.io/notes](https://flavorpress.io/notes).
