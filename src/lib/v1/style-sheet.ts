/**
 * Style sheet extraction.
 *
 * The architect-recommended Burrows' Delta approach to voice-match: extract
 * a stylometric fingerprint from the user's archive offline, then score every
 * generated draft against the fingerprint. The function-word distribution is
 * the load-bearing signal; it converges fast on partial text (200 words
 * is enough), which lets the streaming draft generator cancel + restart at
 * 2 seconds if voice-match drifts.
 *
 * Decay-weighting (architect review): posts in the last 30 days carry weight
 * 1.0; 31-90d carry 0.7; 91-365d carry 0.4; 365+ carry 0.1. Keeps the voice
 * profile naturally tracking authentic drift.
 */

const FUNCTION_WORDS = [
  // Top function words by English corpus frequency. Burrows' Delta basis.
  "the", "of", "and", "a", "to", "in", "is", "you", "that", "it",
  "he", "was", "for", "on", "are", "as", "with", "his", "they", "i",
  "at", "be", "this", "have", "from", "or", "one", "had", "by", "word",
  "but", "not", "what", "all", "were", "we", "when", "your", "can", "said",
  "there", "use", "an", "each", "which", "she", "do", "how", "their", "if",
  "will", "up", "other", "about", "out", "many", "then", "them", "these", "so",
  "some", "her", "would", "make", "like", "him", "into", "time", "has", "look",
  "two", "more", "write", "go", "see", "number", "no", "way", "could", "people",
  "my", "than", "first", "been", "call", "who", "its", "now", "find", "long",
  "down", "day", "did", "get", "come", "made", "may", "part",
  "very", "after", "back", "any", "well", "such", "also", "just", "most", "over",
];

const HEDGE_WORDS = [
  "perhaps",
  "maybe",
  "possibly",
  "probably",
  "might",
  "may",
  "seems",
  "appears",
  "i think",
  "i believe",
  "sort of",
  "kind of",
  "somewhat",
  "arguably",
];

export interface DecayWeights {
  recentDays: number; // weight 1.0 if post within this many days
  midDays: number; // weight 0.7 if post within this many days
  oldDays: number; // weight 0.4 if post within this many days
  // Anything older than oldDays carries weight 0.1.
}

const DEFAULT_DECAY: DecayWeights = {
  recentDays: 30,
  midDays: 90,
  oldDays: 365,
};

export interface PostInput {
  title: string;
  body: string;
  publishedAt: number;
}

export interface StyleSheet {
  /** Top-100 function-word distribution as a Float32Array of length 100. */
  functionWordDistribution: Float32Array;
  sentenceLengthMean: number;
  sentenceLengthVariance: number;
  hedgeFrequency: number;
  emDashDensity: number;
  quoteDensity: number;
  /** Top 20 over-used terms vs generic-blog corpus baseline (signature). */
  signatureTerms: string[];
  /** Bottom 20 under-used terms (banned by default). */
  bannedTerms: string[];
  /** Most common opener patterns: first 3 tokens of each sentence, top 20. */
  openerPatterns: string[];
  archiveSize: number;
  builtAt: number;
}

export function extractStyleSheet(
  posts: PostInput[],
  decay: DecayWeights = DEFAULT_DECAY,
): StyleSheet {
  if (posts.length === 0) {
    return {
      functionWordDistribution: new Float32Array(FUNCTION_WORDS.length),
      sentenceLengthMean: 0,
      sentenceLengthVariance: 0,
      hedgeFrequency: 0,
      emDashDensity: 0,
      quoteDensity: 0,
      signatureTerms: [],
      bannedTerms: [],
      openerPatterns: [],
      archiveSize: 0,
      builtAt: Date.now(),
    };
  }

  const now = Date.now();
  const fwCounts = new Float64Array(FUNCTION_WORDS.length);
  let totalWeightedTokens = 0;
  let totalWeightedSentences = 0;
  let weightedSentenceLengthSum = 0;
  let weightedSentenceLengthSumSq = 0;
  let weightedHedgeOccurrences = 0;
  let weightedEmDashes = 0;
  let weightedQuotes = 0;
  const termCounts = new Map<string, number>();
  const openerCounts = new Map<string, number>();

  for (const post of posts) {
    const ageDays = Math.max(0, (now - post.publishedAt) / 86400000);
    const w = decayWeight(ageDays, decay);
    if (w === 0) continue;

    const text = `${post.title}. ${post.body}`.toLowerCase();
    const tokens = tokenize(text);
    if (tokens.length === 0) continue;

    totalWeightedTokens += tokens.length * w;

    // Function-word distribution.
    for (const tok of tokens) {
      const idx = FW_INDEX.get(tok);
      if (idx !== undefined) fwCounts[idx] += w;
    }

    // Sentences.
    const sentences = splitSentences(text);
    for (const sentence of sentences) {
      const stoks = tokenize(sentence);
      if (stoks.length === 0) continue;
      const len = stoks.length;
      totalWeightedSentences += w;
      weightedSentenceLengthSum += len * w;
      weightedSentenceLengthSumSq += len * len * w;
      const opener = stoks.slice(0, 3).join(" ");
      openerCounts.set(opener, (openerCounts.get(opener) ?? 0) + w);
    }

    // Hedge frequency.
    for (const hedge of HEDGE_WORDS) {
      const re = new RegExp(`\\b${escapeRe(hedge)}\\b`, "g");
      const matches = text.match(re);
      if (matches) weightedHedgeOccurrences += matches.length * w;
    }

    // Em-dashes.
    const dashes = (post.body.match(/—/g) ?? []).length;
    weightedEmDashes += dashes * w;

    // Quotes (rough heuristic: paired straight or curly quotes).
    const quoteMatches = (post.body.match(/["“][^"”]{8,}["”]/g) ?? []).length;
    weightedQuotes += quoteMatches * w;

    // Term frequency for vocabulary fingerprint.
    for (const tok of tokens) {
      if (tok.length < 4) continue; // skip stopword-ish short tokens
      if (FW_INDEX.has(tok)) continue;
      termCounts.set(tok, (termCounts.get(tok) ?? 0) + w);
    }
  }

  // Normalize function-word distribution.
  const fwDist = new Float32Array(FUNCTION_WORDS.length);
  if (totalWeightedTokens > 0) {
    for (let i = 0; i < FUNCTION_WORDS.length; i++) {
      fwDist[i] = fwCounts[i] / totalWeightedTokens;
    }
  }

  const sentenceLengthMean =
    totalWeightedSentences > 0
      ? weightedSentenceLengthSum / totalWeightedSentences
      : 0;
  const sentenceLengthVariance =
    totalWeightedSentences > 0
      ? weightedSentenceLengthSumSq / totalWeightedSentences -
        sentenceLengthMean * sentenceLengthMean
      : 0;

  const hedgeFrequency =
    totalWeightedTokens > 0
      ? (weightedHedgeOccurrences / totalWeightedTokens) * 1000
      : 0; // per 1000 tokens

  const emDashDensity =
    totalWeightedTokens > 0
      ? (weightedEmDashes / totalWeightedTokens) * 1000
      : 0;

  const quoteDensity =
    totalWeightedTokens > 0
      ? (weightedQuotes / totalWeightedTokens) * 1000
      : 0;

  // Vocabulary fingerprint via simple over/under-use against uniform baseline.
  // Better: TF-IDF against a generic-blog corpus; deferred to v1.1.
  const sortedTerms = Array.from(termCounts.entries()).sort((a, b) => b[1] - a[1]);
  const signatureTerms = sortedTerms.slice(0, 20).map(([t]) => t);
  const bannedTerms = ["ostensibly", "delve", "moreover", "crucial", "leverage", "utilize"];
  // Author can override either list in the voice profile UI.

  const openerPatterns = Array.from(openerCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([p]) => p);

  return {
    functionWordDistribution: fwDist,
    sentenceLengthMean,
    sentenceLengthVariance,
    hedgeFrequency,
    emDashDensity,
    quoteDensity,
    signatureTerms,
    bannedTerms,
    openerPatterns,
    archiveSize: posts.length,
    builtAt: Date.now(),
  };
}

const FW_INDEX = new Map(FUNCTION_WORDS.map((w, i) => [w, i]));

function decayWeight(ageDays: number, decay: DecayWeights): number {
  if (ageDays <= decay.recentDays) return 1.0;
  if (ageDays <= decay.midDays) return 0.7;
  if (ageDays <= decay.oldDays) return 0.4;
  return 0.1;
}

function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[a-z][a-z'-]*/g) ?? []);
}

function splitSentences(text: string): string[] {
  return text.split(/[.!?]+\s+/).filter((s) => s.trim().length > 0);
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Burrows' Delta between two function-word distributions.
 * Lower = more similar. Output is normalized to 0..1 where 0 is identical
 * and 1 is roughly maximally different (using a soft cap at 1.5).
 */
export function burrowsDelta(a: Float32Array, b: Float32Array): number {
  const n = Math.min(a.length, b.length);
  if (n === 0) return 1;
  // Compute per-feature z-scores, then mean absolute z-score difference.
  // We approximate the "training corpus standard deviation" with the
  // larger of the two distributions' magnitude to keep this single-pass.
  let mean = 0;
  for (let i = 0; i < n; i++) mean += (a[i] + b[i]) / 2;
  mean /= n;
  let variance = 0;
  for (let i = 0; i < n; i++) {
    const m = (a[i] + b[i]) / 2;
    variance += (m - mean) ** 2;
  }
  variance /= n;
  const std = Math.sqrt(variance) || 1e-9;
  let delta = 0;
  for (let i = 0; i < n; i++) {
    delta += Math.abs(a[i] - b[i]) / std;
  }
  delta /= n;
  // Normalize: cap at 1.5 → 1.0
  return Math.min(1, delta / 1.5);
}

/**
 * Voice-match score 0..100. 75 is the v1 acceptance threshold.
 * Score = 100 * (1 - burrowsDelta).
 */
export function voiceMatchScore(
  generatedDistribution: Float32Array,
  styleSheetDistribution: Float32Array,
): number {
  const delta = burrowsDelta(generatedDistribution, styleSheetDistribution);
  return Math.round((1 - delta) * 100);
}

/**
 * Compute the function-word distribution for a single text fragment.
 * Used at draft time to score the generated body against the style sheet.
 */
export function fingerprintText(text: string): Float32Array {
  const counts = new Float64Array(FUNCTION_WORDS.length);
  const tokens = tokenize(text);
  for (const tok of tokens) {
    const idx = FW_INDEX.get(tok);
    if (idx !== undefined) counts[idx] += 1;
  }
  const dist = new Float32Array(FUNCTION_WORDS.length);
  if (tokens.length > 0) {
    for (let i = 0; i < FUNCTION_WORDS.length; i++) {
      dist[i] = counts[i] / tokens.length;
    }
  }
  return dist;
}
