/**
 * csvParser.ts
 * Parses a PAEC analysis CSV export into the AnalysisInput format
 * expected by questionGenerator.ts
 */

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

export interface AnalysisInput {
  parsedLines: ParsedLine[]
  phraseologyErrors: PhraseologyError[]
}

// ── CSV row parser ────────────────────────────────────────────────────────────
// Handles quoted fields with embedded commas and escaped double-quotes

function parseCSVRow(line: string): string[] {
  const result: string[] = []
  let i = 0
  while (i < line.length) {
    if (line[i] === '"') {
      // quoted field
      let field = ''
      i++ // skip opening quote
      while (i < line.length) {
        if (line[i] === '"' && line[i + 1] === '"') { field += '"'; i += 2 }
        else if (line[i] === '"') { i++; break }
        else { field += line[i++] }
      }
      result.push(field)
      if (line[i] === ',') i++ // skip comma
    } else {
      // unquoted field
      const end = line.indexOf(',', i)
      if (end === -1) { result.push(line.slice(i).trim()); break }
      result.push(line.slice(i, end).trim())
      i = end + 1
    }
  }
  return result
}

// ── Section finder ────────────────────────────────────────────────────────────

function findSection(lines: string[], header: string): number {
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === header) return i
  }
  return -1
}

// ── Main parser ───────────────────────────────────────────────────────────────

export function parseAnalysisCSV(csvText: string): AnalysisInput {
  // Normalize line endings, strip BOM
  const text = csvText.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const lines = text.split('\n')

  const parsedLines: ParsedLine[] = []
  const phraseologyErrors: PhraseologyError[] = []

  // ── Parse ERROR SUMMARY section ──────────────────────────────────────────
  const errorIdx = findSection(lines, 'ERROR SUMMARY')
  if (errorIdx !== -1) {
    // Skip the separator line after header, then find the column header row
    let i = errorIdx + 1
    while (i < lines.length && (lines[i].startsWith('=') || lines[i].trim() === '')) i++
    // i should now be at the column header row: "Line","Issue","Original Text",...
    const colHeader = lines[i]
    if (colHeader && colHeader.includes('Line')) {
      i++ // skip column header
      while (i < lines.length) {
        const row = lines[i].trim()
        if (!row || row.startsWith('=')) break
        const cols = parseCSVRow(row)
        if (cols.length >= 6) {
          const lineNum = parseInt(cols[0], 10)
          if (!isNaN(lineNum)) {
            phraseologyErrors.push({
              line: lineNum,
              issue: cols[1] ?? '',
              original: cols[2] ?? '',
              suggestion: cols[3] ?? '',
              weight: cols[4] ?? 'medium',
              category: cols[5] ?? 'language',
              explanation: cols[6] ?? '',
              incorrectPhrase: cols[2] ?? '',
            } as PhraseologyError & { weight: string })
          }
        }
        i++
      }
    }
  }

  // ── Parse ANNOTATED TRANSCRIPT section ───────────────────────────────────
  const transcriptIdx = findSection(lines, 'ANNOTATED TRANSCRIPT')
  if (transcriptIdx !== -1) {
    let i = transcriptIdx + 1
    while (i < lines.length && (lines[i].startsWith('=') || lines[i].trim() === '')) i++
    // i should be at column header: "Line","Speaker","Text","Error Count","Errors"
    const colHeader = lines[i]
    if (colHeader && colHeader.includes('Speaker')) {
      i++ // skip column header
      let groupNum = 0
      let prevSpeaker = ''
      while (i < lines.length) {
        const row = lines[i].trim()
        if (!row || row.startsWith('=')) break
        const cols = parseCSVRow(row)
        if (cols.length >= 3) {
          const lineNum = parseInt(cols[0], 10)
          const speakerRaw = (cols[1] ?? '').toUpperCase()
          const text = cols[2] ?? ''
          if (!isNaN(lineNum) && text) {
            const speaker: ParsedLine['speaker'] =
              speakerRaw === 'ATC' ? 'ATC' :
              speakerRaw === 'PILOT' ? 'PILOT' : 'OTHER'
            // New conversation group when ATC speaks after PILOT
            if (speaker === 'ATC' && prevSpeaker === 'PILOT') groupNum++
            prevSpeaker = speaker
            parsedLines.push({ lineNum, speaker, text, conversationGroup: groupNum })
          }
        }
        i++
      }
    }
  }

  return { parsedLines, phraseologyErrors }
}
