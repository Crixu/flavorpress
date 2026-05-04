# FlavorPress agent rules

This is the **FlavorPress** prototype (capital F, capital P, no space; never "Flavor", "Flavorpress", "Flavor Press", or "Flavortown"). Read these rules before writing code, scoping a feature, suggesting an architecture change, or replying to Lucas about anything in this directory.

## The single scope rule

Every feature, code change, ticket, dependency add, UX decision, prompt edit, and architectural choice has to move this loop:

**Reading to writing.** The user's existing reading turns into a WordPress draft on their site, in their voice, on the same day, without becoming an AI slop factory.

Mission: help prosumer bloggers publish on-brand stories consistently and fast, without turning into an AI slop factory.

Vision: the user's reading turns into their writing. The sources they already follow become a first draft on the same day, in their voice, on their WordPress site.

If a proposed move does not advance "reading to writing," flag it and surface the verdict before doing anything else. Do not silently build it because it sounds reasonable.

## Behavior expected on every interaction

Before writing code, accepting a feature ask, or replying to a scope question, do this:

1. **Restate the feature in one sentence** with an explicit user-visible verb. If you cannot, ask Lucas to clarify rather than guessing.
2. **Run the seven-question test** (the same one in the `/reading-to-writing` skill). Reading, writing, same day, voice, no slop, pull-not-push, single-site-single-user. Mark each YES, NO, MAYBE, or N/A in your reply with one-line reasons.
3. **Output a verdict**: KEEP, DEFER, or DROP, with two to four sentences of reasoning.
4. **On DEFER**: propose the smallest reframe that would make it pass.
5. **On DROP**: name what this is instead (a different product, an enterprise feature, a v3 surface).

Use the formal skill `/reading-to-writing` when the case is borderline, when Lucas asks for an explicit verdict, or when you want a structured record. For inline checks during a normal coding session, do the test in your reply without invoking the skill.

This applies to UX moves too: every visible button, copy line, onboarding step, default setting, or empty state has to defend itself against the rule. If a UI element does not move reading to writing, it is decoration; remove or defer it.

## What the test looks like in practice

Trivial bug fix or refactor: skip the test, just do the work. The test is for product-scope decisions, not operational tasks.

New feature, new dependency, new route, new model call, new background job, new env var: run the test.

Suggested copy or naming: run the test if the suggestion changes what the user thinks the product does. Otherwise just match the existing tone.

## Out of scope by construction (do not propose without explicit approval)

These were cut on 2026-04-28 and the test consistently rejects them. Do not slip them back into scope without Lucas saying so out loud:

- Multi-site routing, multi-tenant voice profiles, organizations, memberships
- Wire services (AP, Reuters, dpa, AFP, Bloomberg)
- Cross-web trending or discovery feeds
- Auto-publish on a schedule; daily push notifications; "morning digest" emails out
- Marketplace of source connectors; L402 micropayments
- Browser extensions; mobile apps
- Admin portal, sudo / impersonation, staff roles
- Anything tagged "enterprise" until an enterprise customer signs

OPML (#34), multi-story RSS extraction (#64), X via Nitter (#62, #65), and Reddit ingestion shipped between 2026-04-28 and today under the SaaS direction set 2026-04-30, which supersedes the original prototype deferral. The 2026-04-28 reset rules in this file still guard against enterprise scope creep, but the previous "revisit at 2+ prosumers" gate on source ingestion is no longer load-bearing; new source kinds are evaluated against the seven-question test directly.

## Voice rules for any output you generate

Match Lucas's absolute-mode rules from his Obsidian AGENTS.md (`~/Library/Mobile Documents/iCloud~md~obsidian/Documents/Lucas/AGENTS.md`):

- No em dashes; use semicolons or new sentences instead.
- No horizontal rules.
- No setup-then-reveal sentences; lead with the fact.
- No closures, sign-offs, CTAs, or "want me to" appendixes.
- No emojis unless he asks.
- Prose first; lists only for collecting items.
- Short declarative openers; mid-paragraph sentences may run longer.
- Match his language: German in, German out; English in, English out.

These rules apply to chat replies, code comments, README content, P2 drafts, voice profile defaults, draft generation prompts, and any user-facing copy you produce.

## Stack ground truth

Reset prototype, scaffolded 2026-04-28. Single-site, single-user, prosumer.

- Next.js 16.2 (Turbopack), React 19, TypeScript, Tailwind 4
- libSQL via `@libsql/client` (file URL locally, Turso on Vercel)
- Anthropic SDK direct (no AI Framework wrapper)
- Vercel as deployment target (provisional; reversed from prior VIP Node.js decision)
- No Supabase, no Auth.js, no MySQL, no Redis, no BullMQ, no orgs, no admin portal

If a proposed change pulls in any of those stricken pieces, the test should catch it as DEFER or DROP with an enterprise-tier reframe.

## When in doubt

Default to DEFER, not KEEP. The cost of leaving a feature out is one missed conversation; the cost of letting scope creep back is the entire 2026-04-28 reset.

## Source plug-in paths

Two registration paths exist for adding a new source kind; pick deliberately.

- Built-in connector: a file in `src/lib/v1/connectors/<kind>.ts` implementing the `SourceConnector` contract from `src/lib/v1/source-connector.ts`, imported and registered in `src/lib/v1/bootstrap.ts`. Use this when the source ships on for every user by default. RSS and Reddit live here.
- Editor extension: a directory in `src/extensions/<id>/` with metadata in `src/extensions/registry.ts` and live Panel components in `client.ts`. Use this when the source or surface is user-installable, toggled per site, or needs its own panel UI. X via Nitter, fact-check, related images, and comment courtroom live here.

The default for a new source is the connector path. Switch to the extension path only if it needs opt-in per site or its own panel; do not split a source across both.

## Files worth knowing about

- `src/lib/db.ts`: schema. Single `site`, single `voice_profile`, `inbound_emails`, `drafts`. If you add a table, the test runs first.
- `src/lib/draft.ts`: drafting prompt. Hard rules on verbatim quotes, attribution, no invented facts. Treat the prompt as load-bearing; voice and slop guardrails live there.
- `src/lib/voice.ts`: voice profile builder. Pulls last 20 posts; user can edit the result.
- `src/lib/seed.ts`: demo data. Extend cautiously; demo state shapes user perception.
- `src/app/api/inbound/route.ts`: real webhook for forwarding services. Auth via `x-flavorpress-secret`.

## How this rule was set

Established 2026-04-28 alongside the FlavorPress scope reset. See Lucas's Obsidian vault: `01 - Projects/A8C/_active/flavor/flavor.md` (reset banner) and `01 - Projects/A8C/_active/flavor/daily-updates/2026-04-28.md` (full session log). The rule supersedes the original FlavorPress framing (enterprise newsrooms, multi-site routing, wire services); that prior scope is preserved as archive in the same file but is no longer load-bearing for this prototype.
