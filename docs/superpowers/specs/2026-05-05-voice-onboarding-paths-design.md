# Voice onboarding paths

Date: 2026-05-05
Branch: voice-print-interview

## Goal

Replace the single "paste a sample" voice-seeding flow with three onboarding paths that all produce the same fingerprint output:

1. **Free-write** — write fresh prose in-app for ~500 words.
2. **Interview** — answer 7 Kemp-style voice-print questions; the LLM turns the transcript into a representative essay; we fingerprint the essay.
3. **Paste** — current behavior; paste existing prose.

Also remove two pieces of UI noise from the voice detail page: the YAML "Style sheet" preview and the standalone "Reseed from sample writing" block.

## Why this passes the seven-question test

- Reading: N/A.
- Writing: YES; better voice capture is upstream of better drafts.
- Same day: YES; the path the user picks completes onboarding in one session.
- Voice: YES; this *is* the voice surface.
- No slop: YES; richer voice capture, less generic prose in drafts.
- Pull-not-push: N/A.
- Single-site/single-user: YES; per-outlet voice profile is unchanged.

Verdict: KEEP.

## Out of scope (v1)

- Voice input on the interview path (typed only; Web Speech API is a fast-follow when wanted).
- Auto-prompts, timers, or AI nudges during free-write.
- Re-running the LLM synthesis on a stored transcript without re-doing the interview.
- Sharing or exporting the interview transcript.
- Onboarding wizards or new routes; everything stays on the existing voice detail page.

## Architecture

All three paths converge on the existing seed pipeline. The contract: each path produces a single block of representative prose, which is handed to the existing `seedVoiceFromSamplesAction` (or its underlying core) for fingerprint extraction.

```
Free-write  ──┐
Paste       ──┼──>  prose string  ──>  existing fingerprint pipeline
Interview   ──┘     (Q+A → LLM synthesis → essay → prose string)
```

The interview path adds one new step (transcript → synthesized essay), but does not introduce a parallel fingerprint pipeline. There is one statistical fingerprint extractor; the only difference between paths is how the prose is generated.

### Components

- `VoiceSetupPicker` (client component) — tabbed picker with three tabs: Free-write / Interview / Paste. Default tab: Free-write. Used in two places:
  - The empty-state card on the voice detail page (no profile, or thin archive).
  - A new "Re-do voice setup" card shown when a profile already exists (replaces the deleted Reseed block).
- `FreeWritePanel` — single textarea, word counter (target 500+), optional collapsible prompt list. Submit calls the existing `seedVoiceFromSamplesAction`.
- `InterviewPanel` — sequential one-question-per-screen UI with Back/Skip/Next. State lives in component state until the final submit. Submit calls a new `seedVoiceFromInterviewAction`.
- `PastePanel` — the textarea currently in `SeedFromSamples`/`ThinArchiveEmptyState`. Submit calls the existing `seedVoiceFromSamplesAction`.

### Data flow: interview path

1. User answers 7 questions in `InterviewPanel`. Skipped questions are stored as empty strings.
2. On submit, `seedVoiceFromInterviewAction` receives the array of 7 answers.
3. Action calls Claude (via `createAnthropicClient`) with a prompt that:
   - Instructs the model to write a 600-800 word essay in the user's voice based on the answers.
   - Forbids invented facts; only material in the answers may appear.
   - Forbids meta-commentary, headers, lists; produces flowing prose only.
4. The essay is passed to the existing fingerprint extractor.
5. The transcript (JSON of 7 answers) is stored in `voice_profiles.seed_transcript` for audit; `seed_method` is set to `'interview'`.
6. The synthesized essay is *not* stored separately; only the fingerprint and transcript persist. (Re-running synthesis on a stored transcript is out of scope; if the user wants a different result they re-do the interview.)

### Schema changes

Add two columns to `voice_profiles`:

- `seed_method TEXT` — one of `'archive'`, `'paste'`, `'freewrite'`, `'interview'`. Existing rows: NULL (display as "—" in UI).
- `seed_transcript TEXT` — nullable. JSON for `'interview'`; raw text for `'paste'` and `'freewrite'`; NULL for `'archive'` and legacy rows.

Both columns are display/audit only. The existing fingerprint columns remain the source of truth for drafting.

NULL handling on legacy rows: the voice detail page renders without these fields, so missing data does not regress existing profiles. New code must tolerate NULL without falling back to defaults that would imply a method was recorded.

## UI placement

On the voice detail page (`/voice/[outletId]`):

- **No profile, archive present, big enough**: existing "Build voice profile" card (auto-train from archive) is unchanged. Below it, a new collapsed-by-default "or seed manually" disclosure containing `VoiceSetupPicker`.
- **No profile, thin archive**: the current `ThinArchiveEmptyState` becomes a wrapper around `VoiceSetupPicker` with the existing copy about archive size kept above the picker.
- **Profile exists**: existing fingerprint stats, blog description, signature/banned terms remain. The deleted `SeedFromSamples` block is replaced by a "Re-do voice setup" card containing `VoiceSetupPicker`.

The `Style sheet (YAML)` section and the `SeedFromSamples` component are deleted.

## The 7 interview questions

Stored as a constant in `src/lib/v1/voice-interview.ts`. The questions are deliberately Kemp-style (positioning + voice cues) but retargeted from sales to blog:

1. What's the blog about, in one sentence you'd actually say out loud?
2. Who reads it; describe one specific person you picture.
3. What's the boring truth in your space that you wish more people said?
4. A recent post you were proud of, in three sentences.
5. A post that flopped or felt wrong, in three sentences.
6. Three words you reach for; three words you'd never use.
7. If a stranger asked "why should I read you instead of $bigger_blogger," what's the honest answer?

Skip is allowed on any question; the synthesis prompt tolerates blanks.

## Synthesis prompt (interview path)

Routed through `createAnthropicClient` per project convention. Model: whatever the rest of the app uses for voice work.

System prompt (sketch; refine during implementation):

> You are extracting a writer's voice from a short interview. The user has answered seven questions about the blog they write. Produce a 600-800 word essay in the user's voice, drawing only on material in the answers. The essay should read like a representative blog post by this person: opinions, sentence rhythm, vocabulary, tics. Do not invent facts. Do not add meta-commentary, headers, lists, or hedges. No em dashes. Lead with the fact, not setup. If an answer is blank, skip it; do not pad.

User prompt: the seven questions and answers, formatted as Q/A pairs.

Output is consumed directly by the fingerprint extractor; not shown to the user.

## Server actions

- `seedVoiceFromSamplesAction` — exists; called by Free-write and Paste paths. No change.
- `seedVoiceFromInterviewAction` — new. Input: `outletId`, `answers[7]`. Output: redirect to the voice detail page with the new profile, same as `seedVoiceFromSamplesAction`.

Both actions write the new `seed_method` and `seed_transcript` columns. `seedVoiceFromSamplesAction` infers the method from a hidden form field (`'paste'` vs `'freewrite'`) since the prose shape is the same.

## Removals

- `Style sheet (YAML)` `<section>` in `src/app/voice/[outletId]/page.tsx` (lines 232-252).
- `SeedFromSamples` component and its render site (lines 256-260, 366-407).

## Testing

- Unit: synthesis prompt builder produces stable output structure for a known set of answers (snapshot test).
- Unit: `seedVoiceFromInterviewAction` handles 0, 1, and all-7 skipped answers without throwing.
- Unit: schema migration is idempotent on a DB that already has the new columns.
- Integration (manual): walk through each of the three paths on a fresh outlet; confirm fingerprint is computed and `seed_method`/`seed_transcript` are written correctly.
- Regression (manual): existing profiles render without the new columns; existing `seedVoiceFromSamplesAction` still works for the Paste path.

## Open issues / risks

- **Conversational-register pollution.** The interview transcript is short Q/A turns; if synthesis fails or under-produces, the resulting "essay" could read closer to a chat than a blog post and pollute the fingerprint. Mitigation: the synthesis prompt explicitly enforces blog-post register; if reviewing real output reveals drift, tighten the prompt before shipping.
- **Long synthesis latency.** Generating 600-800 words may take 10-20s. UI must show progress; a `PendingMessage` is sufficient.
- **Schema migration.** `ensureSchema` already handles additive columns idempotently; verify before relying on it.

## Out of scope, recorded for future

- Voice input on the interview (Web Speech API).
- Re-derive fingerprint by re-running synthesis on a stored transcript (no UI; would need a button + a guarantee that synthesis is deterministic enough to be useful).
- Showing the synthesized essay to the user as a "here's what we read of your voice" preview before fingerprinting.
