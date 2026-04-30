/**
 * Glossary entries for the help flyout. Each entry has a one-line tooltip,
 * a longer body, optional formula/example, and related links.
 *
 * Add new terms here; they automatically become available via
 * <HelpTrigger id="..."> anywhere in the app and via /voice?help=...
 * deep links.
 */

export interface GlossaryEntry {
  id: string;
  term: string;
  /** One-line definition shown as hover tooltip and at the top of the flyout. */
  short: string;
  /** Plain-paragraphs body. Each item becomes a paragraph. */
  body: string[];
  /** Optional. Renders as a code block. */
  formula?: string;
  /** Optional. Concrete example after the body. */
  example?: string;
  /** IDs of related glossary entries to surface as click-throughs. */
  related?: string[];
  /** Where this term shows up in the product. */
  appearsIn?: string[];
}

export const GLOSSARY: Record<string, GlossaryEntry> = {
  trust: {
    id: "trust",
    term: "Source trust",
    short: "Per-source confidence score that contributes 15% to a cluster's ranker composite. 0.5 default; learns from your behavior over time.",
    body: [
      "Each source carries a trust score between 0 and 1. It starts at 0.5 the moment you add the source, then moves up or down based on signals from your reading behavior, your editing decisions, and explicit user actions like 'demote' or 'fertilize'.",
      "Trust is one of the three signals in the v1 personal ranker, weighted at 15% of the composite. The cluster's source trust value is the average across all sources contributing to that cluster, so a story breaking across high-trust outlets ranks higher than the same story confined to low-trust ones.",
      "Why it matters: two writers can subscribe to the exact same RSS feeds and end up with completely different rankings, because their trust scores diverge based on which sources they've actually drafted from versus which they consistently skipped.",
      "How to influence it: skip a cluster repeatedly and the underlying sources lose trust on that topic. Anchor a post that quotes a specific source and that source gains trust. v1.1 will add explicit per-source thumb-up / thumb-down on the cards.",
    ],
    formula:
      "composite = 0.55 * archive_overlap + 0.30 * beat_match + 0.15 * source_trust + sum(applicable_corrections)",
    example:
      "Reuters at 0.92 trust + Sprudge at 0.88 + Daily Coffee News at 0.74 → mean trust 0.85, contributing 0.13 to the composite (0.85 × 0.15).",
    related: ["ranker", "archive-overlap", "beat-match", "ranker-correction"],
    appearsIn: ["Sources cards", "Today cluster cards", "Decision Strip"],
  },

  ranker: {
    id: "ranker",
    term: "Personal ranker",
    short: "3-signal heuristic that scores every cluster for every user. The Today screen shows the top 3 by composite.",
    body: [
      "Every fired cluster gets a per-user score combining three signals: archive overlap (55%), beat match (30%), and source trust (15%). The composite ranges 0-1 and feeds the Today screen ordering.",
      "The ranker is heuristic in v1, not ML-trained. Weights are config not code, so we can tune them as we see real user behavior. Voice fit and gap fill are deferred to v1.1.",
      "Per-cluster down-weights persist as ranker_corrections. When you down-weight a signal for a specific cluster, future clusters with overlapping entity-set fingerprints inherit a portion of that correction. This lets you teach the ranker per-topic without changing global weights.",
    ],
    related: [
      "archive-overlap",
      "beat-match",
      "trust",
      "voice-fit",
      "gap-fill",
      "ranker-correction",
    ],
    appearsIn: ["Today cards", "Sources diagnostics"],
  },

  "archive-overlap": {
    id: "archive-overlap",
    term: "Archive overlap",
    short: "How much a cluster overlaps with topics you've already written about. Heaviest signal at 55% of the composite.",
    body: [
      "Archive overlap measures how much a fired cluster's primary entities appear in the signature_terms of your voice profile (which is built from your last 50 published posts).",
      "If you write about Apple weight design, a cluster about iPhone 18 grams will have high archive overlap with you and low overlap with a finance blogger reading the same wire.",
      "It's the heaviest signal because past beats are the strongest predictor of future drafting. New beats start with low archive overlap and need to earn their way up — anchor a post on a new topic and the next cluster on that topic gets a boost.",
    ],
    related: ["voice-profile", "signature-terms", "ranker"],
    appearsIn: ["Today cards (Why panel)"],
  },

  "beat-match": {
    id: "beat-match",
    term: "Beat match",
    short: "Fraction of a cluster's entities that show up in your top-50 archive entities. 30% of the composite.",
    body: [
      "While archive overlap looks at vocabulary fingerprint, beat match looks at named entities directly: people, products, organizations, places. If a cluster mentions 'European Commission' and 'green coffee' and you've written about both before, the beat match is high.",
      "Beat match catches new stories on familiar topics that haven't yet entered your signature term list. Useful early on while the voice profile is still maturing.",
    ],
    related: ["archive-overlap", "voice-profile", "ranker"],
    appearsIn: ["Today cards (Why panel)"],
  },

  cluster: {
    id: "cluster",
    term: "Cluster",
    short: "A group of items from different sources that the cluster engine has identified as covering the same story.",
    body: [
      "Clusters form continuously as items are ingested. The cluster engine uses three layers: canonical URL match (exact), entity overlap + title trigram cosine (medium), and sentence-embedding cosine on the lede (expensive, deferred to v1.1).",
      "A cluster fires when 3 or more sources cross within a 72-hour rolling window from at least 2 distinct domains. The 72-hour window keeps clusters fresh; the 2-domain rule prevents one outlet's syndication network from inflating cluster size.",
      "Once a cluster fires, the ranker scores it for the user. The Today screen surfaces the top 3 fired clusters by composite score. Below-the-fold clusters never trigger pre-render; they're available via Show pool.",
    ],
    formula: "fired ⇔ source_count >= 3 AND distinct_domains >= 2 AND window_seconds <= 72*3600",
    related: ["cluster-fire", "ranker", "lane-fit"],
    appearsIn: ["Today screen", "Sources diagnostics"],
  },

  "cluster-fire": {
    id: "cluster-fire",
    term: "Cluster fires",
    short: "The moment a forming cluster crosses the 3-source / 2-domain / 72-hour threshold and starts being scored for users.",
    body: [
      "Before firing, a cluster is in 'forming' state and not visible anywhere. Items accumulate against the cluster's primary entities and centroid as they ingest. Once the threshold crosses, the state flips to 'fired', the ranker computes signals for every user, and the cluster.threshold_crossed event publishes on the bus.",
      "Two safeguards keep firing precise: source diversity (at least 2 distinct domains) prevents wire syndication networks from gaming the count, and a 15-minute confirmation delay (planned for v1.1) gives late-arriving items time to merge in.",
    ],
    related: ["cluster", "lane-fit", "event-bus"],
    appearsIn: ["Today cards", "Diagnostics"],
  },

  "voice-match": {
    id: "voice-match",
    term: "Voice-match score",
    short: "0-100 score for how stylistically close a generated draft is to your past writing. Computed via Burrows' Delta on function-word distribution.",
    body: [
      "Every draft, the system computes a function-word distribution (top 100 English function words) on the generated text and compares it to the user's voice profile via Burrows' Delta — a stylometric distance measure used in authorship attribution research.",
      "Score is 100 - (delta * 100), capped at 100. The threshold for acceptance is 75. Below 75, the streaming generator regenerates once with a tightened prompt before surfacing the draft with a 'voice drift' warning.",
      "The score updates live as you edit: every 2 seconds of edit pause, voice-match recomputes against the current draft body, so you can see in real time whether your edits are pulling closer to or further from your style.",
    ],
    formula:
      "voice_match = max(0, round((1 - burrows_delta(generated, profile)) * 100))",
    related: ["burrows-delta", "voice-profile", "function-words"],
    appearsIn: ["Decision Strip", "Editor right rail"],
  },

  "burrows-delta": {
    id: "burrows-delta",
    term: "Burrows' Delta",
    short: "A stylometric distance measure based on function-word distributions. Used to detect when a draft sounds like the writer's archive.",
    body: [
      "Burrows' Delta was introduced by John Burrows in 2002 for authorship attribution. The idea: function words (the, of, and, in, that...) appear with a stable per-author frequency that's hard to fake even when topic and vocabulary change. Compare two distributions and you get a delta; smaller delta = more likely the same author.",
      "FlavorPress uses a simplified version: top 100 function words, normalized frequency vectors, mean absolute z-score difference. The result is normalized to 0-1 where 0 is identical and ~1.5 is maximally different. Voice-match score = (1 - delta) × 100 capped at 100.",
      "Why it works at MVP scale: function-word distribution converges fast on partial text (~200 words is enough). The streaming draft generator runs the delta check at 200 tokens during generation, cancels and restarts if the partial output is drifting too far. No per-user fine-tuning required.",
    ],
    formula:
      "delta = mean(|z(a_i) - z(b_i)|) over function word features i\nvoice_match = round((1 - min(delta/1.5, 1)) * 100)",
    related: ["voice-match", "voice-profile", "function-words", "decay-weighting"],
    appearsIn: ["Editor", "Voice profile diagnostics"],
  },

  "function-words": {
    id: "function-words",
    term: "Function words",
    short: "Common, low-content words (the, of, and, in...) used in stylometric analysis to fingerprint a writer.",
    body: [
      "Function words carry grammatical structure rather than content meaning. Their frequency is remarkably stable across what a writer writes about, which is why they form the basis of authorship attribution.",
      "FlavorPress tracks the top 100 function words by English corpus frequency. The distribution gets stored on the voice profile and is the load-bearing input to Burrows' Delta and voice-match scoring.",
    ],
    related: ["burrows-delta", "voice-profile", "voice-match"],
    appearsIn: ["Voice profile", "Editor voice-match"],
  },

  "voice-profile": {
    id: "voice-profile",
    term: "Voice profile",
    short: "Per-outlet stylometric fingerprint extracted from your last 50 WordPress posts. Built once, refreshes weekly.",
    body: [
      "The voice profile captures how you write, not what you write about. It includes: function-word distribution (Burrows' Delta basis), sentence-length mean and variance, hedge frequency, em-dash density, vocabulary fingerprint (signature terms + banned terms), and opener patterns.",
      "Profiles are per-outlet, not per-user. If you publish to two WordPress sites with different voices, each gets its own profile. Drafts inherit the profile of the outlet they're being drafted for.",
      "Decay weighting keeps profiles tracking authentic voice drift: posts in the last 30 days carry weight 1.0, 31-90 days 0.7, 91-365 days 0.4, older 0.1. Recent voice dominates without ignoring older corpus entirely.",
    ],
    related: [
      "burrows-delta",
      "voice-match",
      "signature-terms",
      "banned-terms",
      "decay-weighting",
      "outlet",
    ],
    appearsIn: ["Voice & Publishing", "Editor"],
  },

  "signature-terms": {
    id: "signature-terms",
    term: "Signature terms",
    short: "Words you use 5x more than the baseline blog corpus. Define your beat as a vocabulary fingerprint.",
    body: [
      "Signature terms are the top 20 over-used vocabulary items in your archive vs a generic-blog corpus. They're the words that make your writing yours — specialty/roaster/tariff for a coffee blogger, multisite/Gutenberg/REST for a WordPress dev.",
      "The cluster ranker uses signature terms as part of archive overlap: clusters whose entities match your signature terms rank higher.",
      "You can edit signature terms directly on the voice profile (v1.1). Any term you add takes effect on the next ranker computation.",
    ],
    related: ["voice-profile", "archive-overlap", "banned-terms"],
    appearsIn: ["Voice profile"],
  },

  "banned-terms": {
    id: "banned-terms",
    term: "Banned terms",
    short: "Words the draft generator must avoid. Default list includes typical AI-slop tells; user-extensible.",
    body: [
      "The default banned terms list catches the most-flagged AI-slop vocabulary: ostensibly, delve, moreover, crucial, leverage (verb), utilize. The draft generator's system prompt receives this list explicitly and avoids producing them.",
      "User-extensible: add your own. If you've banned em-dashes from your voice forever, add '—' to the list. If your readers hate when you write 'frankly,' ban it.",
      "Banned terms are a hard constraint on the LLM, not a soft suggestion. Output containing a banned term triggers regeneration.",
    ],
    related: ["voice-profile", "signature-terms", "voice-match"],
    appearsIn: ["Voice profile chips"],
  },

  "decay-weighting": {
    id: "decay-weighting",
    term: "Decay weighting",
    short: "Per-post weight that decays with age, so recent posts shape the voice profile more than old ones.",
    body: [
      "Without decay weighting, a 2-year-old post about a topic you no longer write counts as much as last week's. Recent voice gets diluted, old voice gets mistaken for current.",
      "FlavorPress applies tiered decay during voice profile build: posts in the last 30 days × 1.0, 31-90 days × 0.7, 91-365 days × 0.4, older × 0.1. The function-word distribution and sentence-length statistics all use the weighted aggregation.",
      "Net effect: voice naturally tracks authentic drift over months without an explicit 'rebuild from scratch' step.",
    ],
    formula:
      "weight(age_days) = age <= 30 ? 1.0 : age <= 90 ? 0.7 : age <= 365 ? 0.4 : 0.1",
    related: ["voice-profile", "voice-match"],
    appearsIn: ["Voice profile"],
  },

  outlet: {
    id: "outlet",
    term: "Outlet",
    short: "A connected WordPress site you publish to. One author can have many outlets, each with its own voice profile.",
    body: [
      "An outlet is a WordPress publishing destination plus credentials plus voice. The 1:N relationship matters: contextwindow.blog and a side-blog have different voices and need separate profiles.",
      "Each outlet stores its base URL, the encrypted Application Password, the WP kind (org/com/jetpack-managed), connection state, and a default flag. Drafts pick which outlet at the moment of draft.",
      "Cluster ranking is user-scoped, not outlet-scoped: your reading roster and ranker corrections are shared across outlets. Voice profile and publish destination are per-outlet.",
    ],
    related: ["voice-profile", "application-password", "preflight"],
    appearsIn: ["Voice & Publishing"],
  },

  "application-password": {
    id: "application-password",
    term: "Application Password",
    short: "WordPress's built-in token-style auth (since 5.6). FlavorPress uses it for REST API access.",
    body: [
      "Application Passwords are 24-character tokens you generate from WP Admin → Users → Profile → Application Passwords. Each one is named (you'll see 'FlavorPress' in the list) and revocable independently.",
      "FlavorPress stores the token AES-GCM encrypted at rest, decrypted only inside the publish capability's invocation scope. To revoke completely, go to your WP Admin and revoke the FlavorPress entry — the credential dies immediately for all uses.",
      "The one-click authorize flow generates the password for you and sends it back via redirect; no copy-paste. Manual paste works for sites where the redirect doesn't work (HTTPS site, http localhost callback).",
    ],
    related: ["outlet", "preflight", "wp-callback"],
    appearsIn: ["Voice & Publishing connect form"],
  },

  preflight: {
    id: "preflight",
    term: "Preflight check",
    short: "Pre-flight validation that runs before the WordPress authorize redirect to catch failure modes early.",
    body: [
      "Five checks run before you leave FlavorPress for your WP site: URL parse, /wp-json reachable + WordPress, Application Passwords endpoint exists, callback scheme compatible (http→https issues), Jetpack presence.",
      "If any check fails, the redirect doesn't happen. You see the structured findings inline with green/amber/red badges and a hint about what to do next.",
      "Run preflight on its own with the 'Check site' button before authorizing. Run preflight + redirect with 'Authorize on WordPress'. Bypass preflight (after seeing warnings) by re-clicking Authorize from the result card; it sets skipPreflight=1.",
    ],
    related: ["application-password", "outlet"],
    appearsIn: ["Voice & Publishing connect form"],
  },

  "fact-check": {
    id: "fact-check",
    term: "Fact-check pass",
    short: "Per-claim binary check against the cluster source bundle. Flagged claims surface in the Decision Strip.",
    body: [
      "Top 3 claims get extracted from the draft via a lightweight LLM call. Each is checked against the cluster's retrieved sources via a single Claude call. Output: pass / flag with confidence and source attribution.",
      "Flagged claims render as yellow chips in the Decision Strip and as a 'review' annotation on the draft body. The user decides whether to keep, edit, or remove.",
      "v1 ships fact-check as a stub returning pass=true. Real LLM-backed pass is week 2 of the build plan.",
    ],
    related: ["originality", "decision-strip"],
    appearsIn: ["Decision Strip"],
  },

  originality: {
    id: "originality",
    term: "Originality score",
    short: "Character n-gram overlap against the cluster sources. 0-100. Below 90 the draft is considered too close to source text.",
    body: [
      "Originality is computed locally with an n-gram (n=8) overlap check between the draft body and concatenated cluster source text. No LLM call.",
      "Score = 100 - max_overlap_fraction × 100. Below 90, the draft surfaces flagged spans inline and prevents publish until edited. The intent is to keep drafts safely in fair-use territory while quoting freely with citations.",
    ],
    related: ["fact-check", "decision-strip"],
    appearsIn: ["Decision Strip", "Editor"],
  },

  "decision-strip": {
    id: "decision-strip",
    term: "Decision Strip",
    short: "The 2-cell pre-publish check at the top of the editor: voice-match and fact-check.",
    body: [
      "Reduced from 6 cells (per engineer review) to the two that gate publish: voice-match (does this sound like me) and fact-check (are the claims sourced).",
      "Other signals (angle pick, quote count, originality, headline rank) live in the right rail where they're explorable but not required reading. Strip stays glanceable.",
    ],
    related: ["voice-match", "fact-check", "originality"],
    appearsIn: ["Editor"],
  },

  "lane-fit": {
    id: "lane-fit",
    term: "Lane fit",
    short: "Per-user score that gates whether a fired cluster is worth pre-rendering and (in v1.1) pushing.",
    body: [
      "Lane fit applies the personal ranker's composite to a fired cluster and tests it against a per-user floor (default 0.55). Below the floor, the cluster doesn't pre-render and (when push ships in v1.1) doesn't fire a notification.",
      "The floor is auto-tuned over time from your dismiss-vs-publish ratio. Skip a lot of pushed stories and the floor rises; publish more and it relaxes.",
    ],
    related: ["ranker", "cluster-fire"],
    appearsIn: ["Today cards", "Diagnostics"],
  },

  "ranker-correction": {
    id: "ranker-correction",
    term: "Ranker correction",
    short: "Per-cluster-pattern down-weight you apply when a cluster is mis-ranked. Inherited by future similar clusters.",
    body: [
      "When you down-weight a signal on a cluster ('archive overlap shouldn't matter here'), the correction stores against that cluster's entity-set fingerprint. Future clusters whose fingerprint overlaps by 60% inherit a portion of the correction.",
      "Corrections clamp at ±0.4 of composite influence so a single down-weight can't bury a cluster entirely. The correction log is exportable as YAML; it's part of your data, not the system's.",
    ],
    related: ["ranker", "trust"],
    appearsIn: ["Today cards (Why panel)", "Voice profile diagnostics"],
  },

  "voice-fit": {
    id: "voice-fit",
    term: "Voice fit (v1.1)",
    short: "Predicted voice-match score for a cluster before drafting. Deferred to v1.1 in the ranker.",
    body: [
      "Voice fit is the predicted voice-match score for a cluster's likely draft, computed cheaply from cluster lede word distributions vs the voice profile. Lets the ranker prefer clusters whose drafts will land cleanly.",
      "Deferred to v1.1 because we need data on how well the prediction tracks actual voice-match scores in production drafts before tuning the weight.",
    ],
    related: ["voice-match", "ranker"],
    appearsIn: ["Roadmap"],
  },

  "gap-fill": {
    id: "gap-fill",
    term: "Gap fill (v1.1)",
    short: "Inverse of how many of your sources have already covered a cluster. Boosts under-covered angles. Deferred to v1.1.",
    body: [
      "Gap fill is high when your roster has 8 sources but only 2 have covered a cluster — there's headroom to add coverage. It's low when 8 of your 8 sources are already on it; you'd be late.",
      "Deferred to v1.1 because it requires a 'has this user's source covered this cluster' index that's not in v1's data model yet. Currently we just count distinct domains in the cluster, not user roster coverage.",
    ],
    related: ["ranker", "cluster"],
    appearsIn: ["Roadmap"],
  },

  "event-bus": {
    id: "event-bus",
    term: "Event bus",
    short: "Internal pub/sub. Capabilities subscribe to events; every event persists for audit before fanout.",
    body: [
      "Event types include item.ingested, cluster.formed, cluster.threshold_crossed, draft.rendered, draft.fact_checked, post.published, signal.downweighted. Every event writes to event_log before any handler runs, so we can replay or audit a trace.",
      "v1 alpha runs in-memory inside a Vercel function. v1.1 swaps to Upstash Redis pub/sub for cross-region. Same interface; capabilities don't care about the transport.",
    ],
    related: ["capability", "trace"],
    appearsIn: ["Diagnostics", "MCP server"],
  },

  capability: {
    id: "capability",
    term: "Capability",
    short: "A typed unit of work (cluster engine, voice draft generator, fact-check, etc). Plugs in via manifest.",
    body: [
      "Every internal feature ships as a capability with input/output schemas, latency budget, tier (oss/saas), event subscriptions, and an invoke function. The registry holds them and exposes them to the editor's agent slot and the MCP server.",
      "Future agents (research, scheduling, analytics) plug in by shipping a manifest. No core code changes required.",
    ],
    related: ["mcp", "event-bus"],
    appearsIn: ["MCP", "Agents view (v1.1)"],
  },

  mcp: {
    id: "mcp",
    term: "MCP server",
    short: "Model Context Protocol endpoint at /api/mcp. Exposes capabilities as tools for external AI agents.",
    body: [
      "MCP is the standard protocol Claude Desktop, GPT-style agents, and other tools use to call external capabilities. FlavorPress exposes its registry: cluster_read, generate_draft, voice_check, fact_check, originality_check, publish_post.",
      "Auth is per-user API keys (v1.1 ships proper key management with scopes). Currently any bearer token authenticates as 'demo' in dev mode.",
    ],
    related: ["capability"],
    appearsIn: ["/api/mcp"],
  },

  trace: {
    id: "trace",
    term: "Trace ID",
    short: "Per-pipeline ID that ties together cluster, sources, ranker, voice-match, prompt, and edit history for one draft.",
    body: [
      "Engineer review flagged observability as v1's missing piece. Every cluster pipeline, draft generation, and capability invocation gets a trace_id (format: tr_xxxxxxxxxx). Structured spans write to trace_log.",
      "When a user says 'my draft was bad today,' you pull the trace by ID and see: which cluster fired, which sources were in it, ranker signals, voice-match score, the system prompt, the model response, the post-edit version. Saves debugging time.",
      "Visible in the editor header next to the cluster meta.",
    ],
    related: ["event-bus", "capability"],
    appearsIn: ["Editor header", "Diagnostics"],
  },

  "wp-callback": {
    id: "wp-callback",
    term: "WordPress authorize callback",
    short: "/api/wp/callback — receives credentials from WordPress after the user clicks Approve on /wp-admin/authorize-application.php.",
    body: [
      "Part of the one-click authorize flow. WordPress redirects to this endpoint with site_url, user_login, password, and outlet_id (which we set in the success_url before redirecting).",
      "On callback we run probeWordPress to confirm the credentials work, then commitOutletCredentials to store them encrypted on that outlet row. If the probe fails, we record the error on the outlet and surface it on /voice.",
    ],
    related: ["application-password", "outlet", "preflight"],
    appearsIn: ["Voice & Publishing"],
  },
};

export function getEntry(id: string): GlossaryEntry | null {
  return GLOSSARY[id] ?? null;
}

export function listEntries(): GlossaryEntry[] {
  return Object.values(GLOSSARY).sort((a, b) => a.term.localeCompare(b.term));
}
