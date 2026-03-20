/**
 * questionGenerator.ts
 * Parses an analysis CSV export from the main PAEC app and auto-generates
 * training question candidates for a selected category.
 *
 * Max 10 candidates per run. Candidates are randomly sampled from across
 * the whole analysis so repeated imports produce varied results.
 */

const MAX_CANDIDATES = 10

const AIRCRAFT_TYPES = ['Airbus A320', 'Boeing 737-800', 'Airbus A330', 'Boeing 777', 'ATR 72-600', 'Airbus A321', 'Bombardier Q400']

const SITUATION_TEXT: Record<string, string> = {
  ground: 'You are on the ground at your departure airport. ATC has issued the following taxi or clearance instruction.',
  approach: 'You are on approach to your destination, descending for landing. ATC issues the following instruction.',
  departure: 'You are departing, climbing to your assigned altitude. ATC issues the following routing instruction.',
}

// ── Shared types (subset of main app's AnalysisOutput) ──────────────────────

interface ParsedLine {
  lineNum: number
  speaker: 'ATC' | 'PILOT' | 'OTHER'
  text: string
  conversationGroup: number
}

interface PhraseologyError {
  line: number
  original: string
  issue: string
  suggestion: string
  category: string
  incorrectPhrase?: string
  correctExample?: string
  explanation?: string
}

interface AnalysisInput {
  parsedLines?: ParsedLine[]
  phraseologyErrors?: PhraseologyError[]
  languageErrors?: Array<{ type: string; count: number }>
  numberErrors?: Array<{ type: string; count: number }>
}

// ── Question candidate types ─────────────────────────────────────────────────

export interface ReadbackCandidate {
  category: 'readback'
  question_data: {
    atcInstruction: string
    incorrectReadback: string
    correctReadback: string
    errors: Array<{ type: string; field: string; wrong: string; correct: string }>
    explanation: string
  }
}

export interface ScenarioCandidate {
  category: 'scenario'
  question_data: {
    callSign: string
    flightPhase: string
    aircraftType: string
    situation: string
    atcClearance: string
    correctResponse: string
    keyElements: string[]
    hints: string[]
  }
}

export interface JumbledCandidate {
  category: 'jumbled'
  question_data: {
    instruction: string
    correctOrder: string[]
    category: string
  }
}

export interface PronunciationCandidate {
  category: 'pronunciation'
  question_data: {
    type: string
    display: string
    correctPronunciation: string
    options: string[]
    explanation: string
    audioHint: string
  }
}

export type QuestionCandidate = ReadbackCandidate | ScenarioCandidate | JumbledCandidate | PronunciationCandidate

// ── ICAO pronunciation helpers ───────────────────────────────────────────────

const NUMBER_PRONUNCIATION: Record<string, string> = {
  '0': 'Zero', '1': 'One', '2': 'Two', '3': 'Tree', '4': 'Fo-wer',
  '5': 'Fife', '6': 'Six', '7': 'Seven', '8': 'Ait', '9': 'Niner',
}

const LETTER_PRONUNCIATION: Record<string, string> = {
  A: 'Alfa', B: 'Bravo', C: 'Charlie', D: 'Delta', E: 'Echo', F: 'Foxtrot',
  G: 'Golf', H: 'Hotel', I: 'India', J: 'Juliett', K: 'Kilo', L: 'Lima',
  M: 'Mike', N: 'November', O: 'Oscar', P: 'Papa', Q: 'Quebec', R: 'Romeo',
  S: 'Sierra', T: 'Tango', U: 'Uniform', V: 'Victor', W: 'Whiskey',
  X: 'X-ray', Y: 'Yankee', Z: 'Zulu',
}

const NUMBER_WRONG_OPTIONS: Record<string, string[]> = {
  'Zero': ['Oh', 'Zee-ro', 'Nought'],
  'One': ['Wun', 'Won', 'Un'],
  'Two': ['Too', 'Tu', 'Tou'],
  'Tree': ['Three', 'Tri', 'Thre'],
  'Fo-wer': ['Four', 'Fower', 'For'],
  'Fife': ['Five', 'Fyve', 'Fiv'],
  'Six': ['Siks', 'Sic', 'Seex'],
  'Seven': ['Sev-en', 'Sevn', 'Sevven'],
  'Ait': ['Eight', 'Ate', 'Aight'],
  'Niner': ['Nine', 'Ni-ner', 'Nein'],
}

const LETTER_WRONG_OPTIONS: Record<string, string[]> = {
  'Alfa': ['Alpha', 'Alpa', 'Alfah'],
  'Bravo': ['Brahvo', 'Brav-oh', 'Braav-oh'],
  'Charlie': ['Charley', 'Charly', 'Charli'],
  'Delta': ['Delt-ah', 'Deltha', 'Deltah'],
  'Foxtrot': ['Fox Trot', 'Foxtrott', 'Foks-trot'],
  'Golf': ['Goff', 'Golph', 'Gol-f'],
  'Juliett': ['Juliet', 'Juli-et', 'Juliette'],
  'Lima': ['Lee-mah', 'Lim-ah', 'Lyma'],
  'November': ['Novem-ber', 'Novemb', 'Novembr'],
  'Oscar': ['Oskar', 'Oscah', 'Os-car'],
  'Quebec': ['Ke-bek', 'Kwee-bek', 'Que-bec'],
  'Sierra': ['Siara', 'See-era', 'Sierrah'],
  'Tango': ['Tang-o', 'Tung-go', 'Tango-o'],
  'Uniform': ['Uni-form', 'Yuni-form', 'You-niform'],
  'Victor': ['Viktor', 'Vicktor', 'Vick-tor'],
  'Whiskey': ['Wis-key', 'Whis-kee', 'Wisky'],
  'X-ray': ['Ex-ray', 'Ecks-ray', 'X-Ray'],
  'Yankee': ['Yanky', 'Yankie', 'Yank-ee'],
  'Zulu': ['Zoo-loo', 'Zulou', 'Zu-lu'],
}

function getWrongOptions(correct: string, type: 'number' | 'letter'): string[] {
  const map = type === 'number' ? NUMBER_WRONG_OPTIONS : LETTER_WRONG_OPTIONS
  return (map[correct] ?? ['Option A', 'Option B', 'Option C']).slice(0, 3)
}

function shuffleOptions(opts: string[]): string[] {
  return shuffle(opts)
}

// ── Sampling helpers ─────────────────────────────────────────────────────────

/** Fisher-Yates shuffle — returns a new shuffled copy */
function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/**
 * Sample up to n items from arr, spread across the full array
 * (evenly-spaced strided sample, then shuffled so order varies each run).
 * This ensures candidates come from early, middle, AND late in the analysis.
 */
function sample<T>(arr: T[], n: number): T[] {
  if (arr.length <= n) return shuffle(arr)
  const step = arr.length / n
  const picked: T[] = []
  for (let i = 0; i < n; i++) {
    // Pick from each "bucket" with a random offset inside it
    const start = Math.floor(i * step)
    const end = Math.floor((i + 1) * step)
    const idx = start + Math.floor(Math.random() * (end - start))
    picked.push(arr[idx])
  }
  return shuffle(picked)
}

/** Normalise text for within-run dedup */
function norm(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim()
}

/** Check if a candidate is too similar to already-collected ones (>70% token overlap) */
function tooSimilar(text: string, seen: string[]): boolean {
  const tokens = new Set(norm(text).split(' ').filter(w => w.length > 2))
  for (const s of seen) {
    const sTokens = norm(s).split(' ').filter(w => w.length > 2)
    if (sTokens.length === 0) continue
    const overlap = sTokens.filter(w => tokens.has(w)).length / sTokens.length
    if (overlap > 0.7) return true
  }
  return false
}

// ── Generators ───────────────────────────────────────────────────────────────

export function generateReadbackCandidates(analysis: AnalysisInput): ReadbackCandidate[] {
  const lines = analysis.parsedLines ?? []
  const errors = analysis.phraseologyErrors ?? []
  const candidates: ReadbackCandidate[] = []
  const seenTexts: string[] = []

  // Deduplicate errors by pilot line so same utterance isn't used twice
  const errorsByLine = new Map<number, PhraseologyError>()
  for (const e of errors) {
    if (!errorsByLine.has(e.line)) errorsByLine.set(e.line, e)
  }
  const uniqueErrors = shuffle(Array.from(errorsByLine.values()))

  for (const error of uniqueErrors) {
    if (candidates.length >= MAX_CANDIDATES) break
    const pilotLine = lines.find(l => l.lineNum === error.line && l.speaker === 'PILOT')
    if (!pilotLine) continue
    if (tooSimilar(pilotLine.text, seenTexts)) continue

    const atcLine = lines
      .filter(l => l.lineNum < pilotLine.lineNum && l.conversationGroup === pilotLine.conversationGroup && l.speaker === 'ATC')
      .pop()

    const wrongPhrase = error.incorrectPhrase ?? error.original ?? ''
    const suggestion = error.suggestion ?? ''
    let correctReadback = error.correctExample ?? ''
    if (!correctReadback && wrongPhrase && suggestion) {
      correctReadback = pilotLine.text.replace(wrongPhrase, suggestion)
    }

    // Skip if we couldn't produce a meaningful correction or texts are identical
    if (!correctReadback || correctReadback.trim() === pilotLine.text.trim()) continue
    if (correctReadback.trim() === (pilotLine.text ?? '').trim()) continue
    // Skip if the ATC instruction is empty (no context for the student)
    if (!atcLine?.text) continue

    seenTexts.push(pilotLine.text)
    candidates.push({
      category: 'readback',
      question_data: {
        atcInstruction: atcLine?.text ?? '',
        incorrectReadback: pilotLine.text,
        correctReadback,
        errors: [{ type: error.category, field: error.category, wrong: wrongPhrase, correct: suggestion }],
        explanation: error.explanation ?? error.issue,
      },
    })
  }

  return candidates
}

export function generateScenarioCandidates(analysis: AnalysisInput): ScenarioCandidate[] {
  const lines = analysis.parsedLines ?? []
  const candidates: ScenarioCandidate[] = []
  const seenTexts: string[] = []

  // All ATC lines with meaningful length, then stridedly sample + shuffle
  const atcLines = lines.filter(l => l.speaker === 'ATC' && l.text.length > 20)
  const pool = sample(atcLines, Math.min(atcLines.length, MAX_CANDIDATES * 3))

  for (const atcLine of pool) {
    if (candidates.length >= MAX_CANDIDATES) break
    if (tooSimilar(atcLine.text, seenTexts)) continue

    const pilotResponse = lines.find(
      l => l.speaker === 'PILOT' &&
           l.lineNum > atcLine.lineNum &&
           l.conversationGroup === atcLine.conversationGroup
    )
    if (!pilotResponse) continue

    const callSignMatch = atcLine.text.match(/([A-Z]{2,3}\d{2,4}|[A-Z]+-\d+)/i)
    const callSign = callSignMatch?.[1] ?? 'AIRCRAFT'

    const hints: string[] = []
    const keyElements: string[] = ['callSign']

    // Altitude / flight level — include actual value in hint
    const altMatch = atcLine.text.match(/(?:fl\s*|flight level\s*)(\d+)/i)
    const feetMatch = atcLine.text.match(/(\d[\d,]*)\s*feet/i)
    if (altMatch) {
      hints.push(`Read back the flight level: FL${altMatch[1]}`)
      keyElements.push('altitude')
    } else if (feetMatch) {
      hints.push(`Read back the altitude: ${feetMatch[1]} feet`)
      keyElements.push('altitude')
    }

    // Heading — include actual value
    const hdgMatch = atcLine.text.match(/heading\s+(\d+)/i)
    if (hdgMatch) {
      hints.push(`Include the heading: ${hdgMatch[1]}`)
      keyElements.push('heading')
    }

    // Squawk — include actual code
    const sqwkMatch = atcLine.text.match(/squawk\s*(\d{4})/i)
    if (sqwkMatch) {
      hints.push(`Include squawk code: ${sqwkMatch[1]}`)
      keyElements.push('squawk')
    }

    // Route / clearance limit
    const routeMatch = atcLine.text.match(/cleared\s+to\s+(\w+)|via\s+(\w+)/i)
    if (routeMatch) {
      const dest = routeMatch[1] ?? routeMatch[2]
      hints.push(`Read back cleared-to destination: ${dest}`)
      keyElements.push('route')
    } else if (/cleared|clearance/i.test(atcLine.text)) {
      hints.push('Read back the clearance limit')
      keyElements.push('route')
    }

    hints.push('Say your call sign last')

    const numHints = hints.length - 1
    const flightPhase = /taxi|runway|hold short/i.test(atcLine.text) ? 'ground' : /approach|land|ils/i.test(atcLine.text) ? 'approach' : 'departure'
    const aircraftType = shuffle([...AIRCRAFT_TYPES])[0]
    seenTexts.push(atcLine.text)
    candidates.push({
      category: 'scenario',
      question_data: {
        callSign,
        flightPhase,
        aircraftType,
        situation: SITUATION_TEXT[flightPhase] ?? SITUATION_TEXT.departure,
        atcClearance: atcLine.text,
        correctResponse: pilotResponse.text,
        keyElements,
        hints,
      },
    })
  }

  return candidates
}

export function generateJumbledCandidates(analysis: AnalysisInput): JumbledCandidate[] {
  const lines = analysis.parsedLines ?? []
  const candidates: JumbledCandidate[] = []
  const seenTexts: string[] = []

  const errors = analysis.phraseologyErrors ?? []
  const errorLineNums = new Set(errors.map(e => e.line))

  // Correct pilot lines with ≥5 words, randomly sampled across the full transcript
  const eligible = lines.filter(
    l => l.speaker === 'PILOT' && !errorLineNums.has(l.lineNum) && l.text.trim().split(/\s+/).length >= 5
  )
  const pool = sample(eligible, Math.min(eligible.length, MAX_CANDIDATES * 3))

  for (const line of pool) {
    if (candidates.length >= MAX_CANDIDATES) break
    const words = line.text.trim().split(/\s+/)
    if (words.length < 5) continue
    if (tooSimilar(line.text, seenTexts)) continue

    const atcLine = lines
      .filter(l => l.lineNum < line.lineNum && l.conversationGroup === line.conversationGroup && l.speaker === 'ATC')
      .pop()

    const atcCtx = atcLine?.text ?? ''
    const clearanceType = /climb|descend|fl\s*\d|flight level/i.test(atcCtx) ? 'altitude assignment'
      : /heading|turn\s+\w+/i.test(atcCtx) ? 'routing instruction'
      : /squawk/i.test(atcCtx) ? 'transponder instruction'
      : /taxi|hold short/i.test(atcCtx) ? 'taxi instruction'
      : /approach|land|ils/i.test(atcCtx) ? 'approach clearance'
      : 'ATC clearance'
    seenTexts.push(line.text)
    candidates.push({
      category: 'jumbled',
      question_data: {
        instruction: atcCtx
          ? `ATC says: "${atcCtx}"\nArrange the correct pilot readback for this ${clearanceType}:`
          : `Arrange the words to form the correct pilot readback for this ${clearanceType}:`,
        correctOrder: words,
        category: /climb|descend/i.test(line.text) ? 'altitude'
          : /turn|heading/i.test(line.text) ? 'heading'
          : /taxi/i.test(line.text) ? 'taxi'
          : 'clearance',
      },
    })
  }

  return candidates
}

export function generatePronunciationCandidates(analysis: AnalysisInput): PronunciationCandidate[] {
  const errors = analysis.phraseologyErrors ?? []
  const seen = new Set<string>()

  // ── Collect digit pool ───────────────────────────────────────────────────
  const allDigits: string[] = []
  for (const error of errors) {
    const nums = (error.incorrectPhrase ?? error.original ?? '').match(/\d/g) ?? []
    allDigits.push(...nums)
  }
  // Also pull digits from all lines (e.g. altitudes, headings, squawk codes)
  const allText = (analysis.parsedLines ?? []).map(l => l.text).join(' ')
  const lineDigits = allText.match(/\d/g) ?? []
  allDigits.push(...lineDigits)

  // ── Collect letter pool ──────────────────────────────────────────────────
  const allLetters: string[] = []
  // Single isolated letters (e.g. taxiway "A", "B")
  const singleLetters = allText.match(/\b[A-Z]\b/g) ?? []
  allLetters.push(...singleLetters)
  // Extract individual letters from uppercase tokens like callsigns/waypoints (PAL, CEB, TNL…)
  const upperTokens = allText.match(/\b[A-Z]{2,5}\b/g) ?? []
  for (const token of upperTokens) {
    for (const ch of token) allLetters.push(ch)
  }

  // ── Balance: up to 5 numbers + up to 5 letters ───────────────────────────
  const NUMBER_SLOTS = Math.ceil(MAX_CANDIDATES / 2)   // 5
  const LETTER_SLOTS = MAX_CANDIDATES - NUMBER_SLOTS    // 5

  const numberCandidates: PronunciationCandidate[] = []
  for (const digit of shuffle(allDigits)) {
    if (seen.has(digit) || numberCandidates.length >= NUMBER_SLOTS) continue
    const correct = NUMBER_PRONUNCIATION[digit]
    if (!correct) continue
    seen.add(digit)
    numberCandidates.push({
      category: 'pronunciation',
      question_data: {
        type: 'number',
        display: digit,
        correctPronunciation: correct,
        options: shuffleOptions([correct, ...getWrongOptions(correct, 'number')]),
        explanation: `ICAO standard: "${digit}" is pronounced "${correct}"`,
        audioHint: correct,
      },
    })
  }

  const letterCandidates: PronunciationCandidate[] = []
  for (const letter of shuffle([...new Set(allLetters)])) {
    if (seen.has(letter) || letterCandidates.length >= LETTER_SLOTS) continue
    const correct = LETTER_PRONUNCIATION[letter]
    if (!correct) continue
    seen.add(letter)
    letterCandidates.push({
      category: 'pronunciation',
      question_data: {
        type: 'letter',
        display: letter,
        correctPronunciation: correct,
        options: shuffleOptions([correct, ...getWrongOptions(correct, 'letter')]),
        explanation: `NATO phonetic alphabet: "${letter}" is "${correct}"`,
        audioHint: correct,
      },
    })
  }

  // If one pool came up short, fill from the other
  const combined = shuffle([...numberCandidates, ...letterCandidates])
  return combined.slice(0, MAX_CANDIDATES)
}

// ── Main entry ────────────────────────────────────────────────────────────────

export function generateCandidates(category: string, analysis: AnalysisInput): QuestionCandidate[] {
  switch (category) {
    case 'readback':      return generateReadbackCandidates(analysis)
    case 'scenario':      return generateScenarioCandidates(analysis)
    case 'jumbled':       return generateJumbledCandidates(analysis)
    case 'pronunciation': return generatePronunciationCandidates(analysis)
    default: return []
  }
}
