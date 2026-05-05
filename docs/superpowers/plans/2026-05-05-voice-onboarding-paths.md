# Voice Onboarding Paths Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single "paste a sample" voice-seeding flow with three onboarding paths (free-write / Kemp interview / paste) that all converge on the existing fingerprint pipeline, and remove the YAML preview and standalone Reseed block from the voice detail page.

**Architecture:** All three paths produce a single block of representative prose handed to the existing `persistVoiceProfile` pipeline. The interview path adds one new step (Q+A transcript → LLM-synthesized 600-800 word essay) before fingerprinting. UI lives entirely on `/voice/[outletId]`; no new routes. Two new audit columns (`seed_method`, `seed_transcript`) track how each profile was seeded.

**Tech Stack:** Next.js 16 server actions, libSQL, React 19, TypeScript, vitest, Anthropic SDK via `createAnthropicClient` (Sonnet 4.6), Tailwind 4. UI components built with the `frontend-design` skill.

**Spec:** `docs/superpowers/specs/2026-05-05-voice-onboarding-paths-design.md`

---

## File Structure

**Created:**
- `src/lib/v1/voice-interview.ts` — interview question constants + synthesis function (`synthesizeVoiceEssay`).
- `src/lib/v1/__tests__/voice-interview.test.ts` — unit tests for the question constant shape, synthesis prompt builder, and answer-array sanitization.
- `src/app/voice/[outletId]/_components/VoiceSetupPicker.tsx` — client component, tabbed picker shared between empty-state and "Re-do voice setup."
- `src/app/voice/[outletId]/_components/FreeWritePanel.tsx` — free-write tab body (textarea + word counter + collapsible prompt list).
- `src/app/voice/[outletId]/_components/InterviewPanel.tsx` — interview tab body (sequential one-question-per-screen + Back/Skip/Next).
- `src/app/voice/[outletId]/_components/PastePanel.tsx` — paste tab body (extracted from current `ThinArchiveEmptyState`/`SeedFromSamples`).

**Modified:**
- `src/lib/db.ts` — add `seed_method` and `seed_transcript` columns to the `voice_profiles` CREATE statement and the migration in `migrateLegacyTables`.
- `src/lib/v1/actions.ts` — extend `persistVoiceProfile` to accept and write `seedMethod`/`seedTranscript`; thread `seedMethod` into `seedVoiceFromSamplesAction`; add `seedVoiceFromInterviewAction`.
- `src/app/voice/[outletId]/page.tsx` — read new columns; mount `VoiceSetupPicker` in empty states and as "Re-do voice setup"; delete YAML section and `SeedFromSamples`.

---

## Task 1: Schema migration for seed_method and seed_transcript

**Files:**
- Modify: `src/lib/db.ts:246-262` (CREATE TABLE voice_profiles), `src/lib/db.ts:458-481` (migrateLegacyTables voice_profiles block)

- [ ] **Step 1: Add columns to the CREATE TABLE statement**

In `src/lib/db.ts`, update the `voice_profiles` CREATE statement to include the two new columns. Replace the block at lines 246-262 with:

```ts
      `CREATE TABLE IF NOT EXISTS voice_profiles (
        outlet_id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        style_sheet_yaml TEXT NOT NULL,
        archive_index_size INTEGER NOT NULL,
        function_word_distribution BLOB,
        sentence_length_mean REAL,
        sentence_length_variance REAL,
        hedge_frequency REAL,
        em_dash_density REAL,
        quote_density REAL,
        banned_terms TEXT,
        signature_terms TEXT,
        anchored_post_ids TEXT,
        description TEXT,
        seed_method TEXT,
        seed_transcript TEXT,
        last_rebuilt_at INTEGER NOT NULL
      )`,
```

- [ ] **Step 2: Extend migrateLegacyTables to add the columns on existing DBs**

In `src/lib/db.ts`, the existing block at lines 458-481 already handles the `description` column. Extend it so `seed_method` and `seed_transcript` are added when missing. Replace the inner block (after the `pkCols.includes("outlet_id")` else branch starts) with:

```ts
      } else {
        const cols = pragma.rows.map((r) => String(r.name));
        if (!cols.includes("description")) {
          console.info("[migrate] voice_profiles: adding description column");
          await db.execute("ALTER TABLE voice_profiles ADD COLUMN description TEXT");
        }
        if (!cols.includes("seed_method")) {
          console.info("[migrate] voice_profiles: adding seed_method column");
          await db.execute("ALTER TABLE voice_profiles ADD COLUMN seed_method TEXT");
        }
        if (!cols.includes("seed_transcript")) {
          console.info("[migrate] voice_profiles: adding seed_transcript column");
          await db.execute("ALTER TABLE voice_profiles ADD COLUMN seed_transcript TEXT");
        }
      }
```

- [ ] **Step 3: Verify by running typecheck**

Run: `npm run typecheck`
Expected: PASS (no type changes touch this file's exports yet).

- [ ] **Step 4: Commit**

```bash
git add src/lib/db.ts
git commit -m "voice: add seed_method/seed_transcript columns to voice_profiles"
```

---

## Task 2: Voice interview module (questions + synthesis)

**Files:**
- Create: `src/lib/v1/voice-interview.ts`
- Create: `src/lib/v1/__tests__/voice-interview.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/lib/v1/__tests__/voice-interview.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  VOICE_INTERVIEW_QUESTIONS,
  buildSynthesisPrompt,
  sanitizeAnswers,
} from "../voice-interview";

describe("voice-interview", () => {
  it("exports exactly seven Kemp-style questions", () => {
    expect(VOICE_INTERVIEW_QUESTIONS).toHaveLength(7);
    for (const q of VOICE_INTERVIEW_QUESTIONS) {
      expect(typeof q).toBe("string");
      expect(q.length).toBeGreaterThan(20);
    }
  });

  it("sanitizeAnswers pads or truncates to seven and trims each entry", () => {
    expect(sanitizeAnswers(["  one  ", "two"])).toEqual([
      "one",
      "two",
      "",
      "",
      "",
      "",
      "",
    ]);
    const ten = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"];
    expect(sanitizeAnswers(ten)).toHaveLength(7);
    expect(sanitizeAnswers(ten)).toEqual(["a", "b", "c", "d", "e", "f", "g"]);
  });

  it("buildSynthesisPrompt formats question/answer pairs and skips blanks", () => {
    const answers = sanitizeAnswers(["A blog about distributed systems.", "", "Yes."]);
    const { system, user } = buildSynthesisPrompt(answers);
    expect(system).toMatch(/600-800 word/);
    expect(system).toMatch(/no em.?dashes/i);
    expect(user).toMatch(/Q1\./);
    expect(user).toMatch(/A blog about distributed systems\./);
    expect(user).not.toMatch(/Q2\./); // blank answers omitted
    expect(user).toMatch(/Q3\./);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- voice-interview`
Expected: FAIL with module-not-found (`Cannot find module '../voice-interview'`).

- [ ] **Step 3: Implement the module**

Create `src/lib/v1/voice-interview.ts`:

```ts
import { MODEL, createAnthropicClient, extractText } from "@/lib/anthropic";

export const VOICE_INTERVIEW_QUESTIONS: readonly string[] = [
  "What's the blog about, in one sentence you'd actually say out loud?",
  "Who reads it; describe one specific person you picture.",
  "What's the boring truth in your space that you wish more people said?",
  "A recent post you were proud of, in three sentences.",
  "A post that flopped or felt wrong, in three sentences.",
  "Three words you reach for; three words you'd never use.",
  'If a stranger asked "why should I read you instead of $bigger_blogger," what\'s the honest answer?',
];

const SYNTHESIS_SYSTEM = `You are extracting a writer's voice from a short interview. The user has answered up to seven questions about the blog they write. Produce a 600-800 word essay in the user's voice, drawing only on material in the answers. The essay should read like a representative blog post by this person: opinions, sentence rhythm, vocabulary, tics. Do not invent facts. Do not add meta-commentary, headers, lists, or hedges. No em-dashes; use semicolons or new sentences. Lead with the fact, not setup. If an answer is blank, skip it; do not pad. Output only the essay prose.`;

export interface SynthesisPrompt {
  system: string;
  user: string;
}

export function sanitizeAnswers(input: readonly string[]): string[] {
  const trimmed = input.map((a) => (typeof a === "string" ? a.trim() : ""));
  if (trimmed.length >= 7) return trimmed.slice(0, 7);
  return [...trimmed, ...Array(7 - trimmed.length).fill("")];
}

export function buildSynthesisPrompt(answers: string[]): SynthesisPrompt {
  const lines: string[] = [];
  for (let i = 0; i < VOICE_INTERVIEW_QUESTIONS.length; i++) {
    const a = answers[i] ?? "";
    if (!a) continue;
    lines.push(`Q${i + 1}. ${VOICE_INTERVIEW_QUESTIONS[i]}`);
    lines.push(`A. ${a}`);
    lines.push("");
  }
  lines.push("Write the 600-800 word essay now. Output only the essay.");
  return { system: SYNTHESIS_SYSTEM, user: lines.join("\n") };
}

/**
 * Convert a 7-answer transcript into a 600-800 word essay in the user's
 * voice. The essay is the input to the existing fingerprint extractor;
 * not shown to the user. Returns null if the LLM is unavailable or fails;
 * the caller decides whether to surface the error.
 */
export async function synthesizeVoiceEssay(answers: string[]): Promise<string | null> {
  const sanitized = sanitizeAnswers(answers);
  if (sanitized.every((a) => !a)) return null;

  try {
    const { client } = await createAnthropicClient();
    if (!client) return null;
    const { system, user } = buildSynthesisPrompt(sanitized);
    const message = await client.messages.create({
      model: MODEL,
      max_tokens: 2000,
      system,
      messages: [{ role: "user", content: user }],
    });
    const text = extractText(message).trim();
    return text || null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- voice-interview`
Expected: PASS, all three tests green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/v1/voice-interview.ts src/lib/v1/__tests__/voice-interview.test.ts
git commit -m "voice: add interview questions and essay synthesis module"
```

---

## Task 3: Extend persistVoiceProfile and add seedVoiceFromInterviewAction

**Files:**
- Modify: `src/lib/v1/actions.ts:1101` (call site), `src/lib/v1/actions.ts:1112-1142` (`seedVoiceFromSamplesAction`), `src/lib/v1/actions.ts:1249-1288` (`persistVoiceProfile`)

- [ ] **Step 1: Update persistVoiceProfile signature and write the new columns**

In `src/lib/v1/actions.ts`, replace the `persistVoiceProfile` function (lines 1249-1288) with:

```ts
async function persistVoiceProfile(
  outletId: string,
  posts: { title: string; body: string; publishedAt: number }[],
  seed: { method: "archive" | "paste" | "freewrite" | "interview"; transcript: string | null },
): Promise<void> {
  const styleSheet = extractStyleSheet(posts);
  const yaml = renderStyleYaml(styleSheet);
  // Preserve the user-edited blog description across rebuilds.
  const existing = await db.execute({
    sql: `SELECT description FROM voice_profiles WHERE outlet_id = ?`,
    args: [outletId],
  });
  const preservedDescription = existing.rows[0]
    ? (existing.rows[0].description as string | null)
    : null;
  await db.execute({
    sql: `INSERT OR REPLACE INTO voice_profiles
          (outlet_id, user_id, style_sheet_yaml, archive_index_size,
           function_word_distribution, sentence_length_mean, sentence_length_variance,
           hedge_frequency, em_dash_density, quote_density,
           banned_terms, signature_terms, anchored_post_ids, description,
           seed_method, seed_transcript, last_rebuilt_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      outletId,
      SINGLE_USER_ID,
      yaml,
      posts.length,
      new Uint8Array(styleSheet.functionWordDistribution.buffer),
      styleSheet.sentenceLengthMean,
      styleSheet.sentenceLengthVariance,
      styleSheet.hedgeFrequency,
      styleSheet.emDashDensity,
      styleSheet.quoteDensity,
      JSON.stringify(styleSheet.bannedTerms),
      JSON.stringify(styleSheet.signatureTerms),
      JSON.stringify([]),
      preservedDescription,
      seed.method,
      seed.transcript,
      Date.now(),
    ],
  });
}
```

- [ ] **Step 2: Update the archive-train call site**

In `src/lib/v1/actions.ts`, replace the line in `buildVoiceProfileAction` at line 1101:

```ts
  await persistVoiceProfile(outletId, posts, { method: "archive", transcript: null });
```

- [ ] **Step 3: Update seedVoiceFromSamplesAction to read a method hint**

In `src/lib/v1/actions.ts`, replace `seedVoiceFromSamplesAction` (lines 1112-1142) with:

```ts
/**
 * Seed a voice profile from prose the user pastes manually or types in
 * the in-app free-write panel. Multiple samples can be separated by a
 * line containing only `---`. The hidden `method` form field tells us
 * which onboarding path produced the prose ("paste" or "freewrite") so
 * the audit row reflects the actual source; defaults to "paste" for
 * back-compat.
 */
export async function seedVoiceFromSamplesAction(formData: FormData) {
  await ensureSchema();
  await ensureSingleUser();
  const outletId = String(formData.get("outletId") ?? "");
  const samples = String(formData.get("samples") ?? "").trim();
  const methodInput = String(formData.get("method") ?? "paste");
  const method: "paste" | "freewrite" = methodInput === "freewrite" ? "freewrite" : "paste";
  if (!outletId) throw new Error("outletId required.");
  if (!samples) throw new Error("Paste at least one sample of your writing.");

  const outlet = await getOutlet(outletId);
  if (!outlet) throw new Error("Outlet not found.");

  const wordCount = samples.split(/\s+/).filter(Boolean).length;
  if (wordCount < 200) {
    throw new Error(`Need at least 200 words to extract a voice fingerprint; got ${wordCount}.`);
  }

  const chunks = samples
    .split(/\n\s*---+\s*\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  const now = Date.now();
  const posts = (chunks.length > 0 ? chunks : [samples]).map((body) => ({
    title: "",
    body,
    publishedAt: now,
  }));

  await persistVoiceProfile(outletId, posts, { method, transcript: samples });
  revalidatePath("/voice");
  revalidatePath(`/voice/${outletId}`);
}
```

- [ ] **Step 4: Add seedVoiceFromInterviewAction**

In `src/lib/v1/actions.ts`, add the import near the existing `synthesizeVoiceEssay` location (top of file, alongside other `@/lib/v1/...` imports):

```ts
import { sanitizeAnswers, synthesizeVoiceEssay } from "./voice-interview";
```

Then add the new action immediately after `seedVoiceFromSamplesAction`:

```ts
/**
 * Seed a voice profile from a 7-question Kemp-style interview. Reads the
 * answers from the form (fields `q1`..`q7`), runs them through Claude to
 * synthesize a 600-800 word essay in the user's voice, then fingerprints
 * the essay through the same pipeline as paste/free-write. The transcript
 * is stored on the profile row as JSON for audit; the synthesized essay
 * is not persisted separately.
 */
export async function seedVoiceFromInterviewAction(formData: FormData) {
  await ensureSchema();
  await ensureSingleUser();
  const outletId = String(formData.get("outletId") ?? "");
  if (!outletId) throw new Error("outletId required.");

  const outlet = await getOutlet(outletId);
  if (!outlet) throw new Error("Outlet not found.");

  const rawAnswers: string[] = [];
  for (let i = 1; i <= 7; i++) {
    rawAnswers.push(String(formData.get(`q${i}`) ?? ""));
  }
  const answers = sanitizeAnswers(rawAnswers);
  const filled = answers.filter((a) => a.length > 0).length;
  if (filled < 3) {
    throw new Error(`Answer at least three questions to seed a voice; got ${filled}.`);
  }

  const essay = await synthesizeVoiceEssay(answers);
  if (!essay) {
    throw new Error(
      "Could not synthesize a voice essay from the interview. Try again, or seed from samples.",
    );
  }
  const wordCount = essay.split(/\s+/).filter(Boolean).length;
  if (wordCount < 200) {
    throw new Error(
      `Synthesized essay was too short (${wordCount} words); try richer answers or seed from samples.`,
    );
  }

  const now = Date.now();
  await persistVoiceProfile(
    outletId,
    [{ title: "", body: essay, publishedAt: now }],
    { method: "interview", transcript: JSON.stringify(answers) },
  );
  revalidatePath("/voice");
  revalidatePath(`/voice/${outletId}`);
}
```

- [ ] **Step 5: Run typecheck and tests**

Run: `npm run typecheck && npm test`
Expected: PASS. (Existing tests should be untouched; the new module's tests cover the synthesis prompt.)

- [ ] **Step 6: Commit**

```bash
git add src/lib/v1/actions.ts
git commit -m "voice: add interview action and thread seed_method into persistVoiceProfile"
```

---

## Task 4: Build VoiceSetupPicker and panel components

**Files:**
- Create: `src/app/voice/[outletId]/_components/VoiceSetupPicker.tsx`
- Create: `src/app/voice/[outletId]/_components/FreeWritePanel.tsx`
- Create: `src/app/voice/[outletId]/_components/InterviewPanel.tsx`
- Create: `src/app/voice/[outletId]/_components/PastePanel.tsx`

- [ ] **Step 1: Invoke the frontend-design skill before building**

Use the `frontend-design` skill (per project preference) to design the tabbed picker, free-write panel, interview question screen, and paste panel before writing the components. Apply existing FlavorPress conventions: `fp-card`, `fp-card-feature`, `fp-btn`, `fp-input`, `fp-h1-serif`, color tokens (`var(--bg-subtle)`, `var(--fg-muted)`, `var(--border)`), and the no-emoji UI rule from project memory. Typographic glyphs (→ ✓ ✕) are allowed.

- [ ] **Step 2: Implement PastePanel**

Create `src/app/voice/[outletId]/_components/PastePanel.tsx`:

```tsx
"use client";
import { PendingMessage, SubmitButton } from "@/app/_components/SubmitButton";
import { seedVoiceFromSamplesAction } from "@/lib/v1/actions";

export function PastePanel({ outletId, hasProfile }: { outletId: string; hasProfile: boolean }) {
  return (
    <form action={seedVoiceFromSamplesAction} className="space-y-3">
      <input type="hidden" name="outletId" value={outletId} />
      <input type="hidden" name="method" value="paste" />
      <p className="text-[13px] leading-relaxed" style={{ color: "var(--fg-muted)" }}>
        Paste 500+ words of your prose; an old post, a draft, an essay. Separate multiple samples
        with a line containing only{" "}
        <code className="rounded bg-[color:var(--bg-subtle)] px-1">---</code>.
      </p>
      <textarea
        name="samples"
        required
        rows={10}
        placeholder="Paste your prose here. Aim for 500+ words for a stable fingerprint."
        className="fp-input w-full"
        style={{
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          fontSize: "12px",
          lineHeight: "1.5",
        }}
      />
      <SubmitButton
        className="fp-btn fp-btn-primary"
        pendingLabel={hasProfile ? "Reseeding voice" : "Seeding voice"}
      >
        {hasProfile ? "Reseed voice from samples" : "Seed voice from samples"}
      </SubmitButton>
      <PendingMessage>Extracting a voice fingerprint from your pasted samples.</PendingMessage>
    </form>
  );
}
```

- [ ] **Step 3: Implement FreeWritePanel**

Create `src/app/voice/[outletId]/_components/FreeWritePanel.tsx`:

```tsx
"use client";
import { useState } from "react";
import { PendingMessage, SubmitButton } from "@/app/_components/SubmitButton";
import { seedVoiceFromSamplesAction } from "@/lib/v1/actions";

const PROMPTS = [
  "Describe what you'd put on the homepage.",
  "Write the post you wish someone else had written.",
  "Pitch the blog to a stranger in three sentences, then keep going.",
  "Tell me about something you read this week and what you thought of it.",
];

export function FreeWritePanel({
  outletId,
  hasProfile,
}: {
  outletId: string;
  hasProfile: boolean;
}) {
  const [text, setText] = useState("");
  const [showPrompts, setShowPrompts] = useState(false);
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  const target = 500;
  const meetsMin = wordCount >= 200;

  return (
    <form action={seedVoiceFromSamplesAction} className="space-y-3">
      <input type="hidden" name="outletId" value={outletId} />
      <input type="hidden" name="method" value="freewrite" />
      <p className="text-[13px] leading-relaxed" style={{ color: "var(--fg-muted)" }}>
        Write for ~10 minutes about anything. Aim for {target}+ words. We extract the same
        fingerprint we would build from your archive.
      </p>
      <textarea
        name="samples"
        required
        rows={14}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Start typing. The more you write, the better the fingerprint."
        className="fp-input w-full"
        style={{ fontSize: "14px", lineHeight: "1.6" }}
      />
      <div className="flex items-center justify-between text-[12px]" style={{ color: "var(--fg-muted)" }}>
        <span>
          {wordCount} {wordCount === 1 ? "word" : "words"}
          {meetsMin ? " ✓" : ` (need 200, target ${target})`}
        </span>
        <button
          type="button"
          onClick={() => setShowPrompts((v) => !v)}
          className="underline"
          style={{ color: "var(--fg-muted)" }}
        >
          {showPrompts ? "Hide prompts" : "Stuck? Show prompts"}
        </button>
      </div>
      {showPrompts ? (
        <ul
          className="rounded-md border p-3 text-[13px] leading-relaxed"
          style={{ borderColor: "var(--border)", color: "var(--fg-muted)" }}
        >
          {PROMPTS.map((p) => (
            <li key={p} className="list-disc list-inside">
              {p}
            </li>
          ))}
        </ul>
      ) : null}
      <SubmitButton
        className="fp-btn fp-btn-primary"
        pendingLabel={hasProfile ? "Reseeding voice" : "Seeding voice"}
      >
        {hasProfile ? "Reseed voice from this writing" : "Seed voice from this writing"}
      </SubmitButton>
      <PendingMessage>Extracting a voice fingerprint from what you wrote.</PendingMessage>
    </form>
  );
}
```

- [ ] **Step 4: Implement InterviewPanel**

Create `src/app/voice/[outletId]/_components/InterviewPanel.tsx`:

```tsx
"use client";
import { useState } from "react";
import { PendingMessage, SubmitButton } from "@/app/_components/SubmitButton";
import { seedVoiceFromInterviewAction } from "@/lib/v1/actions";
import { VOICE_INTERVIEW_QUESTIONS } from "@/lib/v1/voice-interview";

export function InterviewPanel({
  outletId,
  hasProfile,
}: {
  outletId: string;
  hasProfile: boolean;
}) {
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<string[]>(() =>
    Array(VOICE_INTERVIEW_QUESTIONS.length).fill(""),
  );
  const total = VOICE_INTERVIEW_QUESTIONS.length;
  const isLast = index === total - 1;
  const filled = answers.filter((a) => a.trim().length > 0).length;
  const canSubmit = filled >= 3;

  function setAnswer(value: string) {
    setAnswers((prev) => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
  }

  return (
    <form action={seedVoiceFromInterviewAction} className="space-y-4">
      <input type="hidden" name="outletId" value={outletId} />
      {answers.map((a, i) => (
        <input key={i} type="hidden" name={`q${i + 1}`} value={a} />
      ))}
      <div className="flex items-center justify-between text-[12px]" style={{ color: "var(--fg-muted)" }}>
        <span>
          Question {index + 1} of {total}
        </span>
        <span>{filled} answered</span>
      </div>
      <div
        className="rounded-md p-4"
        style={{ background: "var(--bg-subtle)", border: "1px solid var(--border)" }}
      >
        <p className="text-[15px] font-medium leading-relaxed">
          {VOICE_INTERVIEW_QUESTIONS[index]}
        </p>
        <textarea
          rows={6}
          value={answers[index]}
          onChange={(e) => setAnswer(e.target.value)}
          placeholder="Type your answer. Skip if you'd rather not."
          className="fp-input mt-3 w-full"
          style={{ fontSize: "14px", lineHeight: "1.6" }}
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setIndex((i) => Math.max(0, i - 1))}
          disabled={index === 0}
          className="fp-btn fp-btn-ghost"
        >
          ← Back
        </button>
        {!isLast ? (
          <>
            <button
              type="button"
              onClick={() => {
                setAnswer("");
                setIndex((i) => Math.min(total - 1, i + 1));
              }}
              className="fp-btn fp-btn-ghost"
            >
              Skip
            </button>
            <button
              type="button"
              onClick={() => setIndex((i) => Math.min(total - 1, i + 1))}
              className="fp-btn fp-btn-primary"
            >
              Next →
            </button>
          </>
        ) : (
          <SubmitButton
            className="fp-btn fp-btn-primary"
            pendingLabel="Synthesizing voice"
            disabled={!canSubmit}
          >
            {hasProfile ? "Reseed voice from interview" : "Seed voice from interview"}
          </SubmitButton>
        )}
      </div>
      {!canSubmit && isLast ? (
        <p className="text-[12px]" style={{ color: "var(--fg-muted)" }}>
          Answer at least three questions to continue.
        </p>
      ) : null}
      <PendingMessage>
        Synthesizing a representative essay from your answers and fingerprinting it.
      </PendingMessage>
    </form>
  );
}
```

`SubmitButton` already accepts `disabled` (verified in `src/app/_components/SubmitButton.tsx`); no change needed there.

- [ ] **Step 5: Implement VoiceSetupPicker**

Create `src/app/voice/[outletId]/_components/VoiceSetupPicker.tsx`:

```tsx
"use client";
import { useState } from "react";
import { FreeWritePanel } from "./FreeWritePanel";
import { InterviewPanel } from "./InterviewPanel";
import { PastePanel } from "./PastePanel";

type Tab = "freewrite" | "interview" | "paste";

const TABS: { key: Tab; label: string; blurb: string }[] = [
  { key: "freewrite", label: "Free-write", blurb: "Write fresh prose, ~10 minutes." },
  { key: "interview", label: "Interview", blurb: "Answer 7 voice-print questions." },
  { key: "paste", label: "Paste", blurb: "Already have prose? Paste it." },
];

export function VoiceSetupPicker({
  outletId,
  hasProfile,
  defaultTab = "freewrite",
}: {
  outletId: string;
  hasProfile: boolean;
  defaultTab?: Tab;
}) {
  const [tab, setTab] = useState<Tab>(defaultTab);
  return (
    <div className="space-y-4">
      <div
        className="flex flex-wrap gap-1 rounded-md p-1"
        style={{ background: "var(--bg-subtle)", border: "1px solid var(--border)" }}
      >
        {TABS.map((t) => {
          const active = t.key === tab;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className="flex-1 rounded px-3 py-2 text-[13px] font-medium transition"
              style={{
                background: active ? "var(--bg)" : "transparent",
                color: active ? "var(--fg)" : "var(--fg-muted)",
                boxShadow: active ? "0 1px 2px rgba(0,0,0,0.04)" : "none",
              }}
            >
              {t.label}
            </button>
          );
        })}
      </div>
      <p className="text-[12px]" style={{ color: "var(--fg-muted)" }}>
        {TABS.find((t) => t.key === tab)?.blurb}
      </p>
      {tab === "freewrite" ? <FreeWritePanel outletId={outletId} hasProfile={hasProfile} /> : null}
      {tab === "interview" ? <InterviewPanel outletId={outletId} hasProfile={hasProfile} /> : null}
      {tab === "paste" ? <PastePanel outletId={outletId} hasProfile={hasProfile} /> : null}
    </div>
  );
}
```

- [ ] **Step 6: Run typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/app/voice/[outletId]/_components
git commit -m "voice: add VoiceSetupPicker with free-write, interview, and paste panels"
```

---

## Task 5: Wire VoiceSetupPicker into the voice page; remove YAML and Reseed

**Files:**
- Modify: `src/app/voice/[outletId]/page.tsx`

- [ ] **Step 1: Replace ThinArchiveEmptyState body to mount the picker**

In `src/app/voice/[outletId]/page.tsx`, replace the `ThinArchiveEmptyState` function body (lines 265-306) so it wraps `VoiceSetupPicker` instead of inlining a textarea. Keep the existing copy about archive size; the picker replaces only the form.

```tsx
import { VoiceSetupPicker } from "./_components/VoiceSetupPicker";

// ...

function ThinArchiveEmptyState({ outletId, postCount }: { outletId: string; postCount: number }) {
  const isEmpty = postCount === 0;
  return (
    <section className="fp-card-feature p-6">
      <div className="text-base font-semibold">
        {isEmpty
          ? "Brand-new site, no archive yet."
          : `Archive too thin to auto-train (${postCount} ${postCount === 1 ? "post" : "posts"}).`}
      </div>
      <p className="mt-1 text-sm leading-relaxed" style={{ color: "var(--fg-muted)" }}>
        Voice training needs at least {MIN_VOICE_TRAIN_POSTS} published posts to extract a stable
        fingerprint; below that the model nudges drafts toward generic prose. Pick a path below; we
        extract the same fingerprint either way. Re-train from the archive later once you have{" "}
        {MIN_VOICE_TRAIN_POSTS}+ posts on the site.
      </p>
      <div className="mt-4">
        <VoiceSetupPicker outletId={outletId} hasProfile={false} />
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Replace SeedFromSamples with a Re-do voice setup card**

In `src/app/voice/[outletId]/page.tsx`, delete the `SeedFromSamples` function (lines 366-407) and replace its render call (line 259) with a `RedoVoiceSetup` block. Add this component above `ChipEditor`:

```tsx
function RedoVoiceSetup({ outletId }: { outletId: string }) {
  return (
    <section className="fp-card p-6">
      <div className="text-base font-semibold">Re-do voice setup.</div>
      <p className="mt-1 text-sm leading-relaxed" style={{ color: "var(--fg-muted)" }}>
        Replace the current fingerprint by writing fresh prose, answering a short interview, or
        pasting samples. Your signature and banned terms get recomputed.
      </p>
      <div className="mt-4">
        <VoiceSetupPicker outletId={outletId} hasProfile={true} />
      </div>
    </section>
  );
}
```

Then update the render (was at line 258-260) so it only renders when a profile exists, and uses `RedoVoiceSetup`:

```tsx
{profile ? <RedoVoiceSetup outletId={outletId} /> : null}
```

- [ ] **Step 3: Delete the Style sheet (YAML) section**

In `src/app/voice/[outletId]/page.tsx`, delete the entire `Style sheet (YAML)` section (lines 232-252, the `{styleYaml ? (...) : null}` block) and remove the now-unused `styleYaml` local (line 57).

- [ ] **Step 4: Mount the picker on the no-profile / archive-present empty state**

In `src/app/voice/[outletId]/page.tsx`, the existing "No voice profile yet" card (lines 139-153) builds from the WP archive. Below the existing form, add a disclosure containing `VoiceSetupPicker`:

```tsx
<details className="mt-6">
  <summary className="cursor-pointer text-sm font-medium" style={{ color: "var(--fg-muted)" }}>
    Or seed voice manually (free-write, interview, or paste)
  </summary>
  <div className="mt-4">
    <VoiceSetupPicker outletId={outletId} hasProfile={false} />
  </div>
</details>
```

- [ ] **Step 5: Remove the unused seedVoiceFromSamplesAction import**

Now that the page does not directly call `seedVoiceFromSamplesAction`, remove it from the import block at the top of the file (line 25). Keep all other action imports as-is.

- [ ] **Step 6: Run lint, typecheck, and tests**

Run: `npm run check`
Expected: PASS.

- [ ] **Step 7: Manual verification**

Start the dev server (`npm run dev`) and walk through each path on a fresh outlet:

1. Connect a WordPress outlet with no posts. Land on `/voice/<id>`. Confirm the picker renders three tabs and that switching tabs swaps the panel without reloading.
2. Free-write tab: type 250+ words, watch the word counter, submit. Confirm the profile appears with `seed_method = freewrite` (verify via `sqlite3 .data/flavorpress.db "SELECT seed_method FROM voice_profiles"`).
3. Reload the outlet to a thin-archive state, switch to Interview, answer 4 questions, submit. Confirm a profile is created and `seed_method = interview` and `seed_transcript` is JSON of 7 strings.
4. With a profile present, scroll to "Re-do voice setup," switch to Paste, paste 250+ words, submit. Confirm the profile is replaced and `seed_method = paste`.
5. Confirm the YAML preview and the old Reseed block are gone.

Document any deviations; fix before committing.

- [ ] **Step 8: Commit**

```bash
git add src/app/voice/[outletId]/page.tsx
git commit -m "voice: mount VoiceSetupPicker on detail page; remove YAML preview and Reseed"
```

---

## Task 6: Final verification

**Files:**
- None modified.

- [ ] **Step 1: Run the full check suite**

Run: `npm run check`
Expected: PASS (lint, typecheck, all tests green).

- [ ] **Step 2: Run the build**

Run: `npm run build`
Expected: PASS (Next.js production build succeeds, no static-analysis warnings on the modified routes).

- [ ] **Step 3: Sanity-check the diff**

Run: `git diff origin/main...HEAD --stat`
Expected: changes confined to `src/lib/db.ts`, `src/lib/v1/actions.ts`, `src/lib/v1/voice-interview.ts`, `src/lib/v1/__tests__/voice-interview.test.ts`, `src/app/voice/[outletId]/page.tsx`, `src/app/voice/[outletId]/_components/*`, plus the spec and plan docs.

- [ ] **Step 4: Open the PR**

The user runs `gh pr create` themselves; do not push or open the PR without explicit instruction.
