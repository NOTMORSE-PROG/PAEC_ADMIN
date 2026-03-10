/**
 * questionGenerator.ts
 * Parses an analysis JSON export from the main PAEC app and auto-generates
 * training question candidates for a selected category.
 *
 * Max 20 candidates per run.
 */

const MAX_CANDIDATES = 20

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
  difficulty: 'easy' | 'medium' | 'hard'
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
  difficulty: 'easy' | 'medium' | 'hard'
  question_data: {
    callSign: string
    flightPhase: string
    atcClearance: string
    correctResponse: string
    keyElements: string[]
    hints: string[]
  }
}

export interface JumbledCandidate {
  category: 'jumbled'
  difficulty: 'easy' | 'medium' | 'hard'
  question_data: {
    instruction: string
    correctOrder: string[]
    category: string
  }
}

export interface PronunciationCandidate {
  category: 'pronunciation'
  difficulty: 'easy' | 'medium' | 'hard'
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
  'Bravo': ['Bravo', 'Brahvo', 'Brav-oh'],
  'Charlie': ['Charley', 'Charly', 'Charli'],
  'Delta': ['Delt-ah', 'Deltha', 'Deltah'],
  'Foxtrot': ['Fox Trot', 'Foxtrot', 'Foks-trot'],
  'Golf': ['Goff', 'Golph', 'Gol-f'],
  'Juliett': ['Juliet', 'Juli-et', 'Juliet'],
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
  return [...opts].sort(() => Math.random() - 0.5)
}

// ── Generators ───────────────────────────────────────────────────────────────

export function generateReadbackCandidates(analysis: AnalysisInput): ReadbackCandidate[] {
  const lines = analysis.parsedLines ?? []
  const errors = analysis.phraseologyErrors ?? []
  const candidates: ReadbackCandidate[] = []

  for (const error of errors) {
    if (candidates.length >= MAX_CANDIDATES) break
    const pilotLine = lines.find(l => l.lineNum === error.line && l.speaker === 'PILOT')
    if (!pilotLine) continue

    // Find preceding ATC line in same conversation group
    const atcLine = lines
      .filter(l => l.lineNum < pilotLine.lineNum && l.conversationGroup === pilotLine.conversationGroup && l.speaker === 'ATC')
      .pop()

    candidates.push({
      category: 'readback',
      difficulty: error.category === 'number' ? 'easy' : 'medium',
      question_data: {
        atcInstruction: atcLine?.text ?? '',
        incorrectReadback: pilotLine.text,
        correctReadback: error.correctExample ?? '',
        errors: [{
          type: error.category,
          field: error.category,
          wrong: error.incorrectPhrase ?? '',
          correct: error.suggestion ?? '',
        }],
        explanation: error.explanation ?? error.issue,
      },
    })
  }

  return candidates
}

export function generateScenarioCandidates(analysis: AnalysisInput): ScenarioCandidate[] {
  const lines = analysis.parsedLines ?? []
  const candidates: ScenarioCandidate[] = []

  const atcLines = lines.filter(l => l.speaker === 'ATC' && l.text.length > 20)

  for (const atcLine of atcLines) {
    if (candidates.length >= MAX_CANDIDATES) break

    // Find pilot response
    const pilotResponse = lines.find(
      l => l.speaker === 'PILOT' &&
           l.lineNum > atcLine.lineNum &&
           l.conversationGroup === atcLine.conversationGroup
    )
    if (!pilotResponse) continue

    // Extract call sign (first token that looks like a call sign)
    const callSignMatch = atcLine.text.match(/([A-Z]{2,3}\d{2,4}|[A-Z]+-\d+)/i)
    const callSign = callSignMatch?.[1] ?? 'AIRCRAFT'

    // Infer key elements
    const keyElements: string[] = []
    if (/climb|descend|altitude|fl\d|flight level/i.test(atcLine.text)) keyElements.push('altitude')
    if (/heading|turn/i.test(atcLine.text)) keyElements.push('heading')
    if (/squawk/i.test(atcLine.text)) keyElements.push('squawk')
    if (/cleared|clearance/i.test(atcLine.text)) keyElements.push('clearance')
    keyElements.push('callSign')

    candidates.push({
      category: 'scenario',
      difficulty: keyElements.length >= 4 ? 'hard' : keyElements.length >= 3 ? 'medium' : 'easy',
      question_data: {
        callSign,
        flightPhase: /taxi|runway/i.test(atcLine.text) ? 'ground' : /approach|land/i.test(atcLine.text) ? 'approach' : 'departure',
        atcClearance: atcLine.text,
        correctResponse: pilotResponse.text,
        keyElements,
        hints: [`Include all cleared elements`, `Say call sign last`],
      },
    })
  }

  return candidates
}

export function generateJumbledCandidates(analysis: AnalysisInput): JumbledCandidate[] {
  const lines = analysis.parsedLines ?? []
  const candidates: JumbledCandidate[] = []

  // Use pilot lines that are correct (no errors)
  const errors = analysis.phraseologyErrors ?? []
  const errorLineNums = new Set(errors.map(e => e.line))
  const correctPilotLines = lines.filter(l => l.speaker === 'PILOT' && !errorLineNums.has(l.lineNum) && l.text.split(' ').length >= 5)

  for (const line of correctPilotLines) {
    if (candidates.length >= MAX_CANDIDATES) break
    const words = line.text.trim().split(/\s+/)
    if (words.length < 5) continue

    const atcLine = lines
      .filter(l => l.lineNum < line.lineNum && l.conversationGroup === line.conversationGroup && l.speaker === 'ATC')
      .pop()

    candidates.push({
      category: 'jumbled',
      difficulty: words.length > 9 ? 'hard' : words.length > 6 ? 'medium' : 'easy',
      question_data: {
        instruction: atcLine ? `ATC says: "${atcLine.text}". Arrange the correct pilot readback:` : 'Arrange the correct pilot readback:',
        correctOrder: words,
        category: /climb|descend/i.test(line.text) ? 'altitude' : /turn|heading/i.test(line.text) ? 'heading' : /taxi/i.test(line.text) ? 'taxi' : 'clearance',
      },
    })
  }

  return candidates
}

export function generatePronunciationCandidates(analysis: AnalysisInput): PronunciationCandidate[] {
  const errors = analysis.phraseologyErrors ?? []
  const candidates: PronunciationCandidate[] = []
  const seen = new Set<string>()

  // Numbers from number errors
  for (const error of errors) {
    if (error.category !== 'number') continue
    const nums = (error.incorrectPhrase ?? error.original).match(/\d/g) ?? []
    for (const digit of nums) {
      if (seen.has(digit) || candidates.length >= MAX_CANDIDATES) continue
      seen.add(digit)
      const correct = NUMBER_PRONUNCIATION[digit]
      if (!correct) continue
      candidates.push({
        category: 'pronunciation',
        difficulty: 'easy',
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
  }

  // Letters from call signs / alphabetic context
  if (candidates.length < MAX_CANDIDATES) {
    const allText = (analysis.parsedLines ?? []).map(l => l.text).join(' ')
    const letters = Array.from(new Set(allText.match(/\b[A-Z]\b/g) ?? []))
    for (const letter of letters) {
      if (candidates.length >= MAX_CANDIDATES) break
      if (seen.has(letter)) continue
      seen.add(letter)
      const correct = LETTER_PRONUNCIATION[letter]
      if (!correct) continue
      candidates.push({
        category: 'pronunciation',
        difficulty: 'medium',
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
  }

  return candidates.slice(0, MAX_CANDIDATES)
}

// ── Main entry ────────────────────────────────────────────────────────────────

export function generateCandidates(category: string, analysis: AnalysisInput): QuestionCandidate[] {
  switch (category) {
    case 'readback':     return generateReadbackCandidates(analysis)
    case 'scenario':     return generateScenarioCandidates(analysis)
    case 'jumbled':      return generateJumbledCandidates(analysis)
    case 'pronunciation':return generatePronunciationCandidates(analysis)
    default: return []
  }
}
