/**
 * Copied from ../../../src/lib/atcAnswerMatcher.ts — keep in sync.
 * Resync: cp ../src/lib/atcAnswerMatcher.ts corpus-admin/src/lib/
 * Promote to a shared workspace package if the duplication grows.
 *
 * Concept-level answer matching for ATC training exercises.
 *
 * Wraps the existing semanticReadbackAnalyzer pipeline (ICAO Doc 9432 / ATCO2-corpus-validated)
 * and maps its SemanticAnalysisResult to a 0-100 integer score suitable for the training scorer.
 *
 * Design constraints:
 * - Stateless pure functions only. No module-level mutable state.
 * - Safe for concurrent serverless execution on Vercel.
 * - All inputs sliced to MAX_ANSWER_LEN before any O(n²) operation.
 */

import {
  analyzeReadback,
  normalizeToDigits,
  extractNumericValue,
  type SemanticAnalysisResult,
} from '@/lib/semanticReadbackAnalyzer'

// ── Constants ────────────────────────────────────────────────────────────────

export const MAX_ANSWER_LEN = 4000

// ── Primitives (moved from submit/route.ts — single source of truth) ─────────
// Pronunciation and Jumbled scorers still need these; import from here, not inline.

export function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  )
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i-1] === b[j-1] ? dp[i-1][j-1] : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1])
  return dp[m][n]
}

export function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()
}

/**
 * Filler words stripped before token matching.
 * Includes common English function words plus Tagalog/Filipino sentence particles
 * used by PAEC trainees during code-switching (na, po, yung, etc.).
 * None of these appear in ICAO ATC clearances, so false negatives are impossible.
 */
export const FILLER = new Set([
  'a', 'an', 'the', 'to', 'and', 'or', 'of', 'in', 'on', 'at', 'is', 'for',
  // Tagalog/Filipino particles
  'na', 'po', 'yung', 'eh', 'ano', 'kasi', 'ba', 'nga', 'naman',
])

export function tokens(s: string): string[] {
  return normalize(s).split(' ').filter(w => w.length > 1 && !FILLER.has(w))
}

// ── Pre-processor ─────────────────────────────────────────────────────────────
//
// `removeCallsign()` inside semanticReadbackAnalyzer uses /\b[A-Z]{2,4}\s*\d{2,4}\b/gi
// which accidentally strips "FL350" ("FL" = 2 letters, "350" = 3 digits).
// When both ATC and pilot altitudes are stripped to null, checkValueMatch() never
// fires a wrong_value error — wrong altitude silently scores 100.
//
// Fix: expand compact FL notation to long form BEFORE passing to analyzeReadback.
// "flight level 350" has no uppercase prefix + digits pattern → survives removeCallsign.
// Also normalise progressive verb forms so analyzer action-keyword patterns match.

function prepareForAnalysis(text: string): string {
  return text
    // Expand FL notation: FL350 / FL 350 / fl350 → "flight level 350"
    .replace(/\bfl\s*(\d{2,3})\b/gi, 'flight level $1')
    // Normalize progressive/participial verbs to base form
    .replace(/\bclimbing\b/gi,    'climb')
    .replace(/\bdescending\b/gi,  'descend')
    .replace(/\bturning\b/gi,     'turn')
    .replace(/\bsquawking\b/gi,   'squawk')
    .replace(/\bmaintaining\b/gi, 'maintain')
    .replace(/\bascending\b/gi,   'climb')
    .replace(/\bcontacting\b/gi,  'contact')
}

// ── Score mapping ─────────────────────────────────────────────────────────────

const QUALITY_BASE: Record<SemanticAnalysisResult['quality'], number> = {
  complete:  100,  // all required elements present, no errors
  partial:    75,  // some elements present, some missing
  incorrect:  40,  // wrong value or parameter confusion
  missing:    15,  // roger-only or no content (always accompanied by ≥1 error)
}

const ERROR_WEIGHTS: Record<string, number> = {
  critical: 25,  // roger substitution on safety-critical, runway confusion
  high:     15,  // wrong value, missing altitude, wrong direction
  medium:    8,  // missing non-critical element, partial incomplete
  low:       3,  // non-native phrasing, minor grammar
}

function mapVerdictToScore(verdict: SemanticAnalysisResult): number {
  let score = QUALITY_BASE[verdict.quality]
  for (const e of verdict.errors) score -= (ERROR_WEIGHTS[e.weight] ?? 5)
  return Math.max(0, Math.min(100, Math.round(score)))
}

// ── Exported types ────────────────────────────────────────────────────────────

/** Shape must remain { name, value, found } — consumed directly by scenario/page.tsx:12 */
export interface ElementDetail { name: string; value: string; found: boolean }

export interface ReadbackCtx {
  correctReadback: string
  incorrectReadback?: string
  /** When provided, analyzeReadback uses this as the reference (stronger signal than correctReadback) */
  atcInstruction?: string
  callSign?: string
  errors?: Array<{ wrong: string }>
}

// ── Readback scorer ───────────────────────────────────────────────────────────

export function semanticReadbackScore(userRaw: string, ctx: ReadbackCtx): number {
  const user = String(userRaw ?? '').slice(0, MAX_ANSWER_LEN)
  if (!user.trim()) return 0

  // Preserve existing short-circuit: pre-filled incorrect readback unchanged → 0.
  // Dashboard / profile analytics depend on this producing 0 for the no-change case.
  if (ctx.incorrectReadback?.trim()
      && normalize(user) === normalize(ctx.incorrectReadback)) return 0

  // analyzeReadback was designed to compare against the ATC instruction, not a model
  // answer string — the original ATC utterance gives stronger concept-level signal.
  // Fall back to correctReadback when atcInstruction is absent.
  const reference = ctx.atcInstruction?.trim() || ctx.correctReadback
  const verdict = analyzeReadback(prepareForAnalysis(reference), prepareForAnalysis(user))
  let score = mapVerdictToScore(verdict)

  // Preserve unfixed-error penalty from the previous scorer.
  // Run on normalizeToDigits canonical form so spoken-number variants of the error
  // phrase ("FL350" == "flight level three five zero") are treated identically.
  if ((ctx.errors ?? []).length > 0) {
    const userCanonical = normalizeToDigits(normalize(user))
    const unfixed = (ctx.errors ?? []).filter(e => {
      const w = normalizeToDigits(normalize(String(e.wrong ?? '')))
      return w.length > 1 && userCanonical.includes(w)
    }).length
    if (unfixed > 0) {
      score = Math.round(score * Math.max(0.3, 1 - unfixed * 0.35))
    }
  }

  return score
}

// ── Scenario element scorer ───────────────────────────────────────────────────

export function computeScenarioElements(
  data: Record<string, unknown>,
  answer: string
): { score: number; elements: ElementDetail[] } {
  const user = String(answer ?? '').slice(0, MAX_ANSWER_LEN)
  if (!user.trim()) return { score: 0, elements: [] }

  const atcClearance = String(data.atcClearance ?? '')
  const callSign     = String(data.callSign ?? '')

  const verdict = analyzeReadback(prepareForAnalysis(atcClearance), prepareForAnalysis(user))
  const score   = mapVerdictToScore(verdict)
  const elements = buildFiveSlotBreakdown(atcClearance, callSign, user, verdict)

  return { score, elements }
}

// ── Private: map analyzer verdict → 5-slot ElementDetail[] ───────────────────
//
// Element names MUST be: callSign | altitude | heading | squawk | route
// ELEMENT_LABELS in scenario/page.tsx:29-35 maps exactly these keys.
// Any new name added here MUST also be added to that map in scenario/page.tsx.

function buildFiveSlotBreakdown(
  clearance: string,
  callSign: string,
  userAnswer: string,
  verdict: SemanticAnalysisResult,
): ElementDetail[] {
  const userNorm = normalizeToDigits(normalize(userAnswer))
  const elements: ElementDetail[] = []

  // 1. Callsign — always required
  const csNorm = normalize(callSign)
  if (csNorm.length > 0) {
    const hasMissingCallsign = verdict.errors.some(e => e.type === 'missing_callsign')
    const csFound = !hasMissingCallsign && userNorm.includes(csNorm)
    elements.push({ name: 'callSign', value: callSign, found: csFound })
  }

  // 2. Altitude / FL — extractNumericValue handles spoken numbers, FL notation, feet
  const altValue = extractNumericValue(clearance, 'altitude')
  if (altValue) {
    const altError = verdict.errors.some(
      e => e.parameter === 'altitude' && (e.type === 'wrong_value' || e.type === 'missing_element')
    )
    elements.push({ name: 'altitude', value: altValue, found: !altError })
  }

  // 3. Heading
  const hdgValue = extractNumericValue(clearance, 'heading')
  if (hdgValue) {
    const hdgError = verdict.errors.some(e => e.parameter === 'heading')
    elements.push({ name: 'heading', value: hdgValue, found: !hdgError })
  }

  // 4. Squawk
  const sqkValue = extractNumericValue(clearance, 'squawk')
  if (sqkValue) {
    const sqkError = verdict.errors.some(e => e.parameter === 'squawk')
    elements.push({ name: 'squawk', value: sqkValue, found: !sqkError })
  }

  // 5. Route / destination — regex unchanged from prior scorer
  const routeMatch = normalize(clearance).match(
    /cleared\s+to\s+(\w+)|via\s+(\w+)|direct\s+(\w+)/
  )
  if (routeMatch) {
    const dest = (routeMatch[1] ?? routeMatch[2] ?? routeMatch[3] ?? '').toLowerCase()
    if (dest.length > 2) {
      elements.push({ name: 'route', value: dest, found: userNorm.includes(dest) })
    }
  }

  return elements
}
