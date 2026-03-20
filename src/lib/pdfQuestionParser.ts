// PDF question parser — supports all 4 training categories.
//
// Admin selects the target category before uploading. Each category
// has its own PDF text format and parser:
//
//  PRONUNCIATION  — numbered Q&A with a–d choices + "correct answer is X"
//  READBACK       — numbered blocks with labeled fields (ATC:, INCORRECT:, CORRECT:, …)
//  SCENARIO       — numbered blocks with labeled fields (CALLSIGN:, PHASE:, ATC:, CORRECT:, …)
//  JUMBLED        — numbered blocks with labeled fields (INSTRUCTION:, CORRECT:, TYPE:)

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ParsedCandidate {
  category: 'scenario' | 'readback' | 'jumbled' | 'pronunciation'
  question_data: Record<string, unknown>
  _selected: boolean
  _warnings: string[]
}

export interface ParseResult {
  questions: ParsedCandidate[]
  errors: string[]
}

// ── Templates (downloadable samples per category) ─────────────────────────────

export const PDF_TEMPLATES: Record<string, string> = {
  pronunciation: `1. What is the standard ICAO pronunciation for the number 9?
a. Nine
b. Niner
c. Ny-nee
d. Nav-ee
correct answer is b
EXPLANATION: "Niner" is used to avoid confusion with the German word "nein" (no).

2. Which letter represents the NATO phonetic code for the letter "A"?
a. Alpha
b. Alfa
c. Able
d. Arrow
correct answer is b
EXPLANATION: The ICAO/NATO phonetic alphabet uses "Alfa" (not "Alpha") to avoid mispronunciation across language backgrounds.

3. What is the correct ICAO pronunciation for the number 5?
a. Five
b. Fife
c. Fyve
d. Fiv-er
correct answer is b
EXPLANATION: "Fife" is the ICAO standard to ensure the number is clearly understood over radio, particularly when the "v" sound may be distorted.
`,

  readback: `1.
ATC: Philippine 101, climb and maintain flight level three five zero.
INCORRECT: Climb flight level three five zero, Philippine 101.
CORRECT: Climb and maintain flight level three five zero, Philippine 101.
ERRORS: missing phrase
EXPLANATION: The phrase "and maintain" is mandatory in a climb clearance readback per ICAO Doc 4444. Omitting it is a readback error.

2.
ATC: Philippine 101, turn left heading two four zero, descend to altitude eight thousand feet, QNH one zero one three.
INCORRECT: Left heading two four zero, descend eight thousand, Philippine 101.
CORRECT: Left heading two four zero, descend to altitude eight thousand feet, QNH one zero one three, Philippine 101.
ERRORS: missing altitude descriptor, missing QNH
EXPLANATION: The pilot omitted "to altitude" and failed to read back the QNH setting. Both are required elements of a descent with altimeter instruction.

3.
ATC: Philippine 101, squawk seven seven zero zero.
INCORRECT: Squawk seven hundred, Philippine 101.
CORRECT: Squawk seven seven zero zero, Philippine 101.
ERRORS: number error
EXPLANATION: Each digit of a squawk code must be read back individually. "Seven hundred" is not the correct readback for 7700.
`,

  scenario: `1.
CALLSIGN: Philippine 101
PHASE: departure
AIRCRAFT: A320
SITUATION: Philippine 101 is holding at the runway 24 threshold. The tower has given a takeoff clearance with specific wind information.
ATC: Philippine 101, runway two four, wind two four zero at one zero knots, cleared for takeoff.
CORRECT: Runway two four, cleared for takeoff, Philippine 101.
HINTS: include callsign at the end, include runway number, do not read back wind unless instructed

2.
CALLSIGN: Cebu Pacific 501
PHASE: approach
AIRCRAFT: A320
SITUATION: Cebu Pacific 501 is on final approach. Approach control has issued a speed and altitude instruction.
ATC: Cebu Pacific 501, reduce to final approach speed, descend to two thousand five hundred feet, QNH one zero one five.
CORRECT: Reduce to final approach speed, descend to two thousand five hundred feet, QNH one zero one five, Cebu Pacific 501.
HINTS: read back all elements in order, include callsign at the end, include QNH

3.
CALLSIGN: Philippine 101
PHASE: ground
AIRCRAFT: B737
SITUATION: Philippine 101 has just landed and is clearing the runway. Ground control issues a taxi instruction.
ATC: Philippine 101, taxi to gate charlie one via taxiway alpha, hold short of runway zero six.
CORRECT: Taxi to gate charlie one via taxiway alpha, hold short of runway zero six, Philippine 101.
HINTS: include full taxi route, include hold-short instruction, include callsign at the end
`,

  jumbled: `1.
INSTRUCTION: Arrange these words in the correct order to form a standard landing clearance.
CORRECT: Cleared to land runway two four Philippine 101
TYPE: landing clearance

2.
INSTRUCTION: Arrange these words in the correct order to form a standard takeoff clearance readback.
CORRECT: Runway two four cleared for takeoff Philippine 101
TYPE: takeoff clearance

3.
INSTRUCTION: Arrange these words in the correct order to form a correct readback of a squawk assignment.
CORRECT: Squawk four five two one Philippine 101
TYPE: squawk assignment
`,
}

// ── Format guide previews (shown in UI) ───────────────────────────────────────

export const FORMAT_GUIDES: Record<string, string> = {
  pronunciation: `1. What is the ICAO pronunciation for 9?
a. Nine
b. Niner
c. Ny-nee
d. Nav-ee
correct answer is b
EXPLANATION: Optional explanation here.

2. Next question...`,

  readback: `1.
ATC: Philippine 101, climb and maintain FL350.
INCORRECT: Climb flight level 350, Philippine 101.
CORRECT: Climb and maintain flight level 350, Philippine 101.
ERRORS: missing phrase, number format
EXPLANATION: Optional explanation here.

2.
ATC: ...`,

  scenario: `1.
CALLSIGN: Philippine 101
PHASE: departure
AIRCRAFT: A320
SITUATION: Brief context for the student.
ATC: Philippine 101, runway 24, cleared for takeoff.
CORRECT: Runway 24, cleared for takeoff, Philippine 101.
HINTS: include callsign, include runway number

2.
CALLSIGN: ...`,

  jumbled: `1.
INSTRUCTION: Arrange these words in the correct order.
CORRECT: Cleared to land runway 24 Philippine 101
TYPE: landing clearance

2.
INSTRUCTION: ...`,
}

// ── PDF text extraction (pdfjs-dist, browser-side) ────────────────────────────

export async function extractPdfText(file: File): Promise<string> {
  const pdfjsLib = await import('pdfjs-dist')
  const version = (pdfjsLib as unknown as { version: string }).version ?? '5.4.449'
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    `https://unpkg.com/pdfjs-dist@${version}/build/pdf.worker.min.mjs`

  const arrayBuffer = await file.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise

  const pageTexts: string[] = []
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const content = await page.getTextContent()
    const items = content.items as Array<{ str: string; transform: number[] }>

    // Group items by Y coordinate.
    // Use 2-unit buckets (floor to nearest 2) to absorb small baseline differences
    // between font metrics on the same visual line without merging separate lines.
    const lineMap = new Map<number, Array<{ str: string; x: number }>>()
    for (const item of items) {
      const y = Math.floor(item.transform[5] / 2) * 2
      if (!lineMap.has(y)) lineMap.set(y, [])
      lineMap.get(y)!.push({ str: item.str, x: item.transform[4] })
    }

    const lines = [...lineMap.entries()]
      .sort((a, b) => b[0] - a[0])           // PDF Y increases upward → sort descending
      .map(([, parts]) => {
        // Sort items left → right by X, join with space, collapse multiple spaces.
        // Joining with a space ensures words aren't concatenated even when PDF item
        // boundaries fall mid-word.  Extra spaces from items that already have
        // trailing/leading whitespace are collapsed afterward.
        const sorted = [...parts].sort((a, b) => a.x - b.x)
        return sorted.map(p => p.str).join(' ').trim().replace(/\s{2,}/g, ' ')
      })
      .filter(Boolean)

    pageTexts.push(lines.join('\n'))
  }

  // Normalise common PDF typography artifacts that could confuse field regexes
  const raw = pageTexts.join('\n')
  return raw
    .replace(/[\u2018\u2019]/g, "'")   // smart single quotes → '
    .replace(/[\u201C\u201D]/g, '"')   // smart double quotes → "
    .replace(/\u2013/g, '-')           // en-dash → hyphen
    .replace(/\u2014/g, '-')           // em-dash → hyphen
    .replace(/\u00A0/g, ' ')           // non-breaking space → space
    .replace(/\uFB01/g, 'fi')          // fi ligature
    .replace(/\uFB02/g, 'fl')          // fl ligature
}

// ── Main entry point ──────────────────────────────────────────────────────────

export function parsePdfQuestions(text: string, category: string): ParseResult {
  switch (category) {
    case 'readback':    return parseReadbackQuestions(text)
    case 'scenario':   return parseScenarioQuestions(text)
    case 'jumbled':    return parseJumbledQuestions(text)
    case 'pronunciation':
    default:           return parsePronunciationQuestions(text)
  }
}

// ── Quality warnings ──────────────────────────────────────────────────────────

export function getQualityWarnings(
  category: string,
  qd: Record<string, unknown>
): string[] {
  switch (category) {
    case 'readback': {
      const w: string[] = []
      if (!(qd.atcInstruction as string)?.trim()) w.push('Missing ATC instruction')
      if (!(qd.incorrectReadback as string)?.trim()) w.push('Missing incorrect readback')
      if (!(qd.correctReadback as string)?.trim()) w.push('Missing correct readback')
      if (qd.incorrectReadback && qd.correctReadback && qd.incorrectReadback === qd.correctReadback) w.push('Incorrect and correct are identical')
      return w
    }
    case 'scenario': {
      const w: string[] = []
      if (!(qd.atcClearance as string)?.trim()) w.push('Missing ATC clearance')
      if (!(qd.correctResponse as string)?.trim()) w.push('Missing correct response')
      if (((qd.atcClearance as string) ?? '').length < 30) w.push('Short ATC clearance')
      return w
    }
    case 'jumbled': {
      const w: string[] = []
      if (!(qd.instruction as string)?.trim()) w.push('Missing instruction')
      const order = (qd.correctOrder as string[]) ?? []
      if (order.length < 4) w.push('Very short phrase (< 4 words)')
      return w
    }
    case 'pronunciation':
    default: {
      const display = qd.display as string ?? ''
      const options = qd.options as string[] ?? []
      const correct = qd.correctPronunciation as string ?? ''
      return getPronunciationWarnings(display, options, correct)
    }
  }
}

// ── Shared helpers ─────────────────────────────────────────────────────────────

/** For pronunciation: inline block numbers ("1. What is...") */
function splitIntoBlocks(rawLines: string[]): string[] {
  const fullText = rawLines.join('\n')
  return fullText
    .split(/(?=^\d+[.)]\s*)/m)
    .map(b => b.trim())
    .filter(b => /^\d+[.)]/m.test(b))
}

/**
 * For scenario / readback / jumbled: block numbers are standalone on their own line.
 *
 * Two guards prevent callsign flight numbers (e.g. "332.", "777.") from being
 * mistaken for block boundaries when they wrap to the start of a new line:
 *   1. The number must be ALONE on the line (nothing after the punctuation).
 *   2. The number must be sequential (prev + 1), so "332" is rejected when
 *      we are currently building block 2.
 */
function splitIntoBlocksStandalone(rawLines: string[]): string[] {
  const blocks: string[] = []
  let current: string[] = []
  let lastBlockNum = 0

  for (const line of rawLines) {
    const m = line.match(/^(\d{1,3})[.)]\s*$/)  // standalone: only digits + punct
    if (m) {
      const num = parseInt(m[1])
      if (num === lastBlockNum + 1) {
        if (current.length > 0) blocks.push(current.join('\n'))
        current = [line]
        lastBlockNum = num
        continue
      }
    }
    current.push(line)
  }
  if (current.length > 0) blocks.push(current.join('\n'))
  return blocks.filter(b => /^\d+[.)]/m.test(b))
}

/**
 * Extract a labeled field value: "LABEL: value" or "LABEL: value\ncontinuation line"
 *
 * Continuation stops only when a new ALL-CAPS field label is detected (e.g. "ATC:",
 * "CORRECT:", "HINTS:"). Mixed-case or lowercase lines — including wrapped callsign
 * numbers like "332." or prose sentences — are always collected as continuation.
 */
function extractField(blockLines: string[], ...labels: string[]): string {
  const pattern = new RegExp(`^(?:${labels.join('|')})\\s*:\\s*(.*)`, 'i')
  // Matches lines that look like a new field label: at least 2 uppercase chars before ":"
  // e.g. "ATC:", "CORRECT:", "CALL-SIGN:", "FLIGHT PHASE:"
  // Does NOT match lowercase prose like "Note:" or "The controller said:"
  const labelRe = /^[A-Z][A-Z\s\-]{1,}\s*:/

  for (let i = 0; i < blockLines.length; i++) {
    const m = blockLines[i].match(pattern)
    if (m) {
      let value = m[1].trim()
      let j = i + 1
      while (j < blockLines.length && !labelRe.test(blockLines[j])) {
        value += ' ' + blockLines[j].trim()
        j++
      }
      return value.trim()
    }
  }
  return ''
}

// ── Pronunciation parser (Q&A multiple-choice) ────────────────────────────────

function parsePronunciationQuestions(text: string): ParseResult {
  const errors: string[] = []
  const rawLines = text.split('\n').map(l => l.trim()).filter(Boolean)

  // Separate answer-key section at the end
  const answerKey: Record<number, string> = {}
  const keyIdx = rawLines.findIndex(l =>
    /^(?:answer\s*key|answers?)\s*[:.]?\s*$/i.test(l)
  )
  if (keyIdx !== -1) {
    for (let i = keyIdx + 1; i < rawLines.length; i++) {
      const m = rawLines[i].match(/^(\d+)[.)]\s*([a-d])/i)
      if (m) answerKey[parseInt(m[1])] = m[2].toLowerCase()
    }
  }

  const blocks = splitIntoBlocks(rawLines)
  if (blocks.length === 0) {
    errors.push(
      'No questions found. Each question must start with a number followed by "." or ")" — e.g. "1. What is..."'
    )
    return { questions: [], errors }
  }

  const candidates: ParsedCandidate[] = []

  for (const block of blocks) {
    const blockLines = block.split('\n').map(l => l.trim()).filter(Boolean)
    if (blockLines.length < 2) continue

    const numMatch = blockLines[0].match(/^(\d+)[.)]\s*(.*)/)
    if (!numMatch) continue
    const qNum = parseInt(numMatch[1])
    let questionText = numMatch[2].trim()

    // Accumulate continuation lines until a choice or answer line
    let choiceStartIdx = 1
    while (
      choiceStartIdx < blockLines.length &&
      !/^[a-dA-D][.)]\s/i.test(blockLines[choiceStartIdx]) &&
      !isAnswerLine(blockLines[choiceStartIdx]) &&
      !/^explanation\s*[:=]/i.test(blockLines[choiceStartIdx])
    ) {
      questionText += ' ' + blockLines[choiceStartIdx]
      choiceStartIdx++
    }
    questionText = questionText.trim()

    const choiceMap: Record<string, string> = {}
    let correctLetter = ''
    let explanation = ''

    for (let i = choiceStartIdx; i < blockLines.length; i++) {
      const line = blockLines[i]

      const choiceMatch = line.match(/^([a-dA-D])[.)]\s*(.+)/)
      if (choiceMatch) {
        const letter = choiceMatch[1].toLowerCase()
        let choiceText = choiceMatch[2].trim()
        // Collect continuation lines for multi-line choices
        while (
          i + 1 < blockLines.length &&
          !/^[a-dA-D][.)]\s/i.test(blockLines[i + 1]) &&
          !isAnswerLine(blockLines[i + 1]) &&
          !/^explanation\s*[:=]/i.test(blockLines[i + 1])
        ) {
          i++
          choiceText += ' ' + blockLines[i].trim()
        }
        choiceMap[letter] = choiceText.trim()
        continue
      }

      if (isAnswerLine(line)) {
        const m = line.match(/[a-d]/i)
        if (m) correctLetter = m[0].toLowerCase()
        continue
      }

      if (/^explanation\s*[:=]/i.test(line)) {
        explanation = line.replace(/^explanation\s*[:=]\s*/i, '').trim()
        // Collect continuation lines for multi-line explanations
        while (
          i + 1 < blockLines.length &&
          !/^[a-dA-D][.)]\s/i.test(blockLines[i + 1]) &&
          !isAnswerLine(blockLines[i + 1])
        ) {
          i++
          explanation += ' ' + blockLines[i].trim()
        }
        continue
      }
    }

    if (!correctLetter && answerKey[qNum]) correctLetter = answerKey[qNum]

    const blockErrors: string[] = []
    if (!questionText) blockErrors.push(`Q${qNum}: Empty question text`)
    const missing = ['a', 'b', 'c', 'd'].filter(k => !choiceMap[k])
    if (missing.length) blockErrors.push(`Q${qNum}: Missing choice(s): ${missing.join(', ')}`)
    if (!correctLetter) {
      blockErrors.push(`Q${qNum}: No correct answer — add "correct answer is a" (or b/c/d) after the choices`)
    }
    errors.push(...blockErrors)

    const options: [string, string, string, string] = [
      choiceMap['a'] ?? '',
      choiceMap['b'] ?? '',
      choiceMap['c'] ?? '',
      choiceMap['d'] ?? '',
    ]
    const correctPronunciation = correctLetter ? (choiceMap[correctLetter] ?? '') : ''

    candidates.push({
      category: 'pronunciation',
      question_data: {
        type: 'question',
        display: questionText,
        options,
        correctPronunciation,
        audioHint: correctPronunciation,
        ...(explanation ? { explanation } : {}),
      },
      _selected: blockErrors.length === 0,
      _warnings: getPronunciationWarnings(questionText, options, correctPronunciation),
    })
  }

  return { questions: candidates, errors }
}

function isAnswerLine(line: string): boolean {
  return /^(?:correct\s+answer\s+is|correct\s+answer\s*[:=]|answer\s+is|answer\s*[:=]|ans\s*[:=])\s*[a-d]/i.test(line)
}

function getPronunciationWarnings(
  display: string,
  options: string[],
  correctPronunciation: string
): string[] {
  const w: string[] = []
  if (!display?.trim()) w.push('Empty question')
  const empty = options.filter(o => !o?.trim())
  if (empty.length) w.push(`${empty.length} empty choice(s)`)
  if (!correctPronunciation?.trim()) w.push('No correct answer set')
  if ((display ?? '').length < 10) w.push('Very short question')
  return w
}

// ── Readback parser (labeled fields) ─────────────────────────────────────────

function parseReadbackQuestions(text: string): ParseResult {
  const errors: string[] = []
  const rawLines = text.split('\n').map(l => l.trim()).filter(Boolean)
  const blocks = splitIntoBlocksStandalone(rawLines)

  if (blocks.length === 0) {
    errors.push(
      'No questions found. Each question must start with a number followed by "." or ")" on its own line — e.g. "1."'
    )
    return { questions: [], errors }
  }

  const candidates: ParsedCandidate[] = []

  for (const block of blocks) {
    const blockLines = block.split('\n').map(l => l.trim()).filter(Boolean)
    const numMatch = blockLines[0].match(/^(\d+)[.)]/)
    if (!numMatch) continue
    const qNum = parseInt(numMatch[1])

    const atcInstruction    = extractField(blockLines, 'ATC')
    const incorrectReadback = extractField(blockLines, 'INCORRECT', 'INCORRECT READBACK', 'WRONG', 'PILOT ERROR', 'PILOT')
    const correctReadback   = extractField(blockLines, 'CORRECT', 'CORRECT READBACK', 'EXPECTED')
    const errorsRaw         = extractField(blockLines, 'ERRORS', 'ERROR')
    const explanation       = extractField(blockLines, 'EXPLANATION', 'EXPLAIN', 'NOTE')

    const errors_arr = errorsRaw
      ? errorsRaw.split(/[,;]/).map(e => e.trim()).filter(Boolean)
      : []

    const blockErrors: string[] = []
    if (!atcInstruction)    blockErrors.push(`Q${qNum}: Missing ATC field — add "ATC: <instruction>"`)
    if (!incorrectReadback) blockErrors.push(`Q${qNum}: Missing INCORRECT field — add "INCORRECT: <readback>"`)
    if (!correctReadback)   blockErrors.push(`Q${qNum}: Missing CORRECT field — add "CORRECT: <readback>"`)
    errors.push(...blockErrors)

    const qd: Record<string, unknown> = {
      atcInstruction,
      incorrectReadback,
      correctReadback,
      ...(errors_arr.length ? { errors: errors_arr } : {}),
      ...(explanation ? { explanation } : {}),
    }

    candidates.push({
      category: 'readback',
      question_data: qd,
      _selected: blockErrors.length === 0,
      _warnings: getQualityWarnings('readback', qd),
    })
  }

  return { questions: candidates, errors }
}

// ── Scenario parser (labeled fields) ─────────────────────────────────────────

/** Map any phase wording to the three values the training app recognises. */
function normalisePhase(raw: string): 'departure' | 'approach' | 'ground' {
  const s = raw.toLowerCase().trim()
  if (/^(departure|takeoff|take.off|climb|initial climb|en.?route)/.test(s)) return 'departure'
  if (/^(approach|arrival|descent|landing|final|ils|ils approach)/.test(s)) return 'approach'
  if (/^(ground|taxi|ramp|gate|pushback|push.?back|parking)/.test(s)) return 'ground'
  // Default: try partial match, else departure
  if (s.includes('approach') || s.includes('descent') || s.includes('arrival')) return 'approach'
  if (s.includes('ground') || s.includes('taxi') || s.includes('ramp')) return 'ground'
  return 'departure'
}

function parseScenarioQuestions(text: string): ParseResult {
  const errors: string[] = []
  const rawLines = text.split('\n').map(l => l.trim()).filter(Boolean)
  const blocks = splitIntoBlocksStandalone(rawLines)

  if (blocks.length === 0) {
    errors.push(
      'No questions found. Each question must start with a number followed by "." or ")" on its own line.'
    )
    return { questions: [], errors }
  }

  const candidates: ParsedCandidate[] = []

  for (const block of blocks) {
    const blockLines = block.split('\n').map(l => l.trim()).filter(Boolean)
    const numMatch = blockLines[0].match(/^(\d+)[.)]/)
    if (!numMatch) continue
    const qNum = parseInt(numMatch[1])

    const callSign       = extractField(blockLines, 'CALLSIGN', 'CALL SIGN', 'CALL-SIGN', 'FLIGHT')
    const flightPhaseRaw = extractField(blockLines, 'PHASE', 'FLIGHT PHASE', 'OPERATION', 'STAGE')
    const aircraftType   = extractField(blockLines, 'AIRCRAFT', 'AIRCRAFT TYPE', 'A/C TYPE', 'PLANE')
    const situation      = extractField(blockLines, 'SITUATION', 'CONTEXT', 'BACKGROUND', 'SCENARIO')
    const atcClearance   = extractField(blockLines, 'ATC', 'ATC CLEARANCE', 'CLEARANCE', 'INSTRUCTION')
    const correctResponse = extractField(blockLines, 'CORRECT', 'CORRECT RESPONSE', 'RESPONSE', 'ANSWER')
    const hintsRaw       = extractField(blockLines, 'HINTS', 'HINT', 'TIPS', 'TIP', 'KEY ELEMENTS')

    const flightPhase = flightPhaseRaw ? normalisePhase(flightPhaseRaw) : 'departure'

    const hints = hintsRaw
      ? hintsRaw.split(/[,;]/).map(h => h.trim()).filter(Boolean)
      : []

    const blockErrors: string[] = []
    if (!atcClearance)    blockErrors.push(`Q${qNum}: Missing ATC field — add "ATC: <clearance>"`)
    if (!correctResponse) blockErrors.push(`Q${qNum}: Missing CORRECT field — add "CORRECT: <response>"`)
    errors.push(...blockErrors)

    const qd: Record<string, unknown> = {
      callSign:       callSign || 'Unknown',
      flightPhase,
      aircraftType:   aircraftType || '',
      situation:      situation || '',
      atcClearance,
      correctResponse,
      keyElements:    [],
      ...(hints.length ? { hints } : {}),
    }

    candidates.push({
      category: 'scenario',
      question_data: qd,
      _selected: blockErrors.length === 0,
      _warnings: getQualityWarnings('scenario', qd),
    })
  }

  return { questions: candidates, errors }
}

// ── Jumbled parser (labeled fields) ──────────────────────────────────────────

function parseJumbledQuestions(text: string): ParseResult {
  const errors: string[] = []
  const rawLines = text.split('\n').map(l => l.trim()).filter(Boolean)
  const blocks = splitIntoBlocksStandalone(rawLines)

  if (blocks.length === 0) {
    errors.push(
      'No questions found. Each question must start with a number followed by "." or ")" on its own line.'
    )
    return { questions: [], errors }
  }

  const candidates: ParsedCandidate[] = []

  for (const block of blocks) {
    const blockLines = block.split('\n').map(l => l.trim()).filter(Boolean)
    const numMatch = blockLines[0].match(/^(\d+)[.)]/)
    if (!numMatch) continue
    const qNum = parseInt(numMatch[1])

    const instruction = extractField(blockLines, 'INSTRUCTION', 'TASK', 'QUESTION', 'DIRECTIONS')
    const correctRaw  = extractField(blockLines, 'CORRECT', 'CORRECT ORDER', 'PHRASE', 'ANSWER')
    const typeLabel   = extractField(blockLines, 'TYPE', 'CATEGORY', 'KIND')

    const correctOrder = correctRaw.split(/\s+/).filter(Boolean)

    const blockErrors: string[] = []
    if (!correctRaw)  blockErrors.push(`Q${qNum}: Missing CORRECT field — add "CORRECT: <words in order>"`)
    if (!instruction) blockErrors.push(`Q${qNum}: Missing INSTRUCTION field — add "INSTRUCTION: <task description>"`)
    errors.push(...blockErrors)

    const qd: Record<string, unknown> = {
      instruction:  instruction || 'Arrange these words in the correct order.',
      correctOrder,
      ...(typeLabel ? { category: typeLabel } : {}),
    }

    candidates.push({
      category: 'jumbled',
      question_data: qd,
      _selected: blockErrors.length === 0,
      _warnings: getQualityWarnings('jumbled', qd),
    })
  }

  return { questions: candidates, errors }
}
