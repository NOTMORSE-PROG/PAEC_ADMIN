/**
 * Copied from ../../../src/lib/semanticReadbackAnalyzer.ts — keep in sync.
 * Resync: cp ../src/lib/semanticReadbackAnalyzer.ts corpus-admin/src/lib/
 *         cp ../src/data/appDepCorpus.json corpus-admin/src/data/
 *
 * Semantic Readback Analyzer
 *
 * ML-inspired dynamic analysis engine for ATC-Pilot communication validation.
 * Uses semantic understanding, pattern learning, and real ATC corpus data.
 *
 * Data Sources:
 * - ATCO2 Corpus (Eurocontrol/Idiap) - 5000+ real ATC exchanges
 * - ATCOSIM Corpus (Graz University) - Simulated ATC data
 * - UWB-ATCC (University of West Bohemia) - Czech ATC corpus
 * - FAA Order 7110.65 phraseology
 * - ICAO Doc 9432 Manual of Radiotelephony
 *
 * Hugging Face Compatible: Can be extended with transformers for NLU
 */

import appDepCorpus from '../data/appDepCorpus.json'

// Dynamic check config — tunable parameters loaded from appDepCorpus.json → "checks"
const _CHECKS = (appDepCorpus as unknown as { checks: { maxTranspositionDifferences: number } }).checks

// ============================================================================
// TYPES
// ============================================================================

export interface SemanticAnalysisResult {
  isCorrect: boolean
  quality: 'complete' | 'partial' | 'missing' | 'incorrect'
  confidence: number
  errors: ReadbackError[]
  expectedResponse: string
  actualResponse: string
  corrections: CorrectionSuggestion[]
}

export interface ReadbackError {
  type: ErrorType
  parameter: string
  expectedValue: string | null
  actualValue: string | null
  weight: 'critical' | 'high' | 'medium' | 'low'
  explanation: string
  icaoReference?: string
}

export type ErrorType =
  // Core readback errors
  | 'wrong_value'           // Pilot said different value
  | 'missing_element'       // Required element not read back
  | 'incomplete_readback'   // Just "Roger" or similar
  | 'parameter_confusion'   // Heading read as altitude, etc.
  | 'transposition'         // Digits swapped
  | 'hearback_error'        // Pilot misheard instruction
  | 'extra_element'         // Pilot added something not instructed
  // Conditional/constraint errors
  | 'condition_omitted'     // Pilot didn't read back WHEN/UNTIL/AFTER condition
  | 'condition_violated'    // Pilot added "now" to conditional instruction
  | 'constraint_missing'    // Pilot omitted "at or above/below" constraint
  | 'roger_substitution'    // Pilot used Roger/Wilco for safety-critical item
  // Direction and callsign errors
  | 'wrong_direction'       // Left vs Right confusion
  | 'missing_callsign'      // Callsign not included in readback
  // Runway safety errors (critical)
  | 'critical_confusion'    // Line up/wait confused with takeoff, etc.
  | 'wrong_runway'          // Wrong runway number read back
  | 'missing_designator'    // Missing L/R/C runway designator
  // Non-native speaker patterns
  | 'non_native_pronunciation'  // Pronunciation affecting clarity
  | 'non_native_grammar'        // Grammar structure issues
  | 'non_native_word_order'     // Word order affecting meaning
  | 'non_native_stress'         // Stress pattern issues

// ============================================================================
// STRUCTURED COMMAND PARSING TYPES
// ============================================================================

export type ConditionType = 'WHEN' | 'UNTIL' | 'AFTER' | 'AT' | 'ONCE' | 'BEFORE' | 'UPON' | null

export interface StructuredCommand {
  action: string              // climb, descend, turn, reduce, hold, etc.
  parameter: string           // altitude, heading, speed, fix, etc.
  value: string | number      // FL350, 270, 250, LUBOG, etc.
  unit?: string               // feet, knots, degrees, minutes
  modifier?: string           // and maintain, expedite, immediately
  condition?: {
    type: ConditionType       // WHEN, UNTIL, AFTER, AT, ONCE, BEFORE, UPON
    phrase: string            // "when passing FL250", "until established"
    triggerValue?: string     // FL250, LUBOG, established, etc.
  }
  constraint?: {
    type: string              // at_or_above, at_or_below, not_below, not_above
    phrase: string            // "at or above 3000", "cross at or below FL180"
    value?: string            // 3000, FL180
  }
  isImmediate: boolean        // true if "now", "immediately" detected
  rawText: string
}

export interface CommandValidationResult {
  isValid: boolean
  errors: ReadbackError[]
  missingElements: string[]
  conditionStatus: 'present' | 'missing' | 'violated' | 'not_applicable'
  constraintStatus: 'present' | 'missing' | 'not_applicable'
}

export interface CorrectionSuggestion {
  correctPhrase: string
  whyIncorrect: string
  icaoStandard: string
}

export interface InstructionComponents {
  type: InstructionType
  action?: string            // climb, descend, turn, reduce, etc.
  value?: string             // The numeric/text value
  unit?: string              // feet, knots, degrees, etc.
  direction?: string         // left, right
  modifier?: string          // and maintain, expedite, etc.
  callsign?: string
  runway?: string
  waypoint?: string
  rawText: string
}

export type InstructionType =
  | 'altitude_change'
  | 'heading_change'
  | 'speed_change'
  | 'altimeter_setting'
  | 'squawk_code'
  | 'frequency_change'
  | 'approach_clearance'
  | 'takeoff_clearance'
  | 'landing_clearance'
  | 'lineup_wait'
  | 'hold_instruction'
  | 'direct_to'
  | 'taxi_instruction'
  | 'information_only'
  | 'unknown'

// ============================================================================
// REAL ATC TRAINING DATA (From ATCO2, ATCOSIM, FAA corpora)
// ============================================================================

/**
 * This dataset represents typical ATC instruction-response patterns
 * extracted from real-world corpora. Used for semantic matching.
 */
export const ATC_TRAINING_DATA: {
  instruction: string
  correctReadback: string
  instructionType: InstructionType
  requiredElements: string[]
  commonErrors: { error: string; type: ErrorType }[]
}[] = [
  // ALTITUDE INSTRUCTIONS
  {
    instruction: "climb and maintain flight level three five zero",
    correctReadback: "climb and maintain flight level three five zero, {callsign}",
    instructionType: 'altitude_change',
    requiredElements: ['climb', 'altitude_value', 'callsign'],
    commonErrors: [
      { error: "Roger", type: 'incomplete_readback' },
      { error: "flight level three four zero", type: 'wrong_value' },
      { error: "heading three five zero", type: 'parameter_confusion' }
    ]
  },
  {
    instruction: "descend and maintain five thousand",
    correctReadback: "descend and maintain five thousand, {callsign}",
    instructionType: 'altitude_change',
    requiredElements: ['descend', 'altitude_value', 'callsign'],
    commonErrors: [
      { error: "Roger", type: 'incomplete_readback' },
      { error: "three thousand", type: 'wrong_value' },
      { error: "wilco", type: 'incomplete_readback' }
    ]
  },
  {
    instruction: "climb and maintain one zero thousand",
    correctReadback: "climb and maintain one zero thousand, {callsign}",
    instructionType: 'altitude_change',
    requiredElements: ['climb', 'altitude_value', 'callsign'],
    commonErrors: [
      { error: "ten thousand", type: 'wrong_value' },  // Grouped number
      { error: "one one thousand", type: 'wrong_value' }
    ]
  },

  // HEADING INSTRUCTIONS
  {
    instruction: "turn right heading two seven zero",
    correctReadback: "right heading two seven zero, {callsign}",
    instructionType: 'heading_change',
    requiredElements: ['direction', 'heading_value', 'callsign'],
    commonErrors: [
      { error: "Roger", type: 'incomplete_readback' },
      { error: "heading two six zero", type: 'wrong_value' },
      { error: "left heading two seven zero", type: 'wrong_value' },
      { error: "flight level two seven zero", type: 'parameter_confusion' }
    ]
  },
  {
    instruction: "turn left heading one eight zero",
    correctReadback: "left heading one eight zero, {callsign}",
    instructionType: 'heading_change',
    requiredElements: ['direction', 'heading_value', 'callsign'],
    commonErrors: [
      { error: "one six zero", type: 'wrong_value' },
      { error: "one zero eight", type: 'transposition' }
    ]
  },
  {
    instruction: "fly heading zero nine zero",
    correctReadback: "heading zero nine zero, {callsign}",
    instructionType: 'heading_change',
    requiredElements: ['heading_value', 'callsign'],
    commonErrors: [
      { error: "heading nine zero", type: 'wrong_value' },  // Missing leading zero
      { error: "heading zero zero nine", type: 'transposition' }
    ]
  },

  // SPEED INSTRUCTIONS
  {
    instruction: "reduce speed two one zero knots",
    correctReadback: "reduce speed two one zero knots, {callsign}",
    instructionType: 'speed_change',
    requiredElements: ['action', 'speed_value', 'callsign'],
    commonErrors: [
      { error: "two three zero knots", type: 'wrong_value' },
      { error: "Roger", type: 'incomplete_readback' },
      { error: "one two zero knots", type: 'transposition' }
    ]
  },
  {
    instruction: "increase speed to two five zero knots",
    correctReadback: "speed two five zero knots, {callsign}",
    instructionType: 'speed_change',
    requiredElements: ['speed_value', 'callsign'],
    commonErrors: [
      { error: "two four zero", type: 'wrong_value' }
    ]
  },
  {
    instruction: "maintain two eight zero knots",
    correctReadback: "maintain two eight zero knots, {callsign}",
    instructionType: 'speed_change',
    requiredElements: ['speed_value', 'callsign'],
    commonErrors: []
  },

  // ALTIMETER SETTINGS
  {
    instruction: "altimeter one zero one three",
    correctReadback: "altimeter one zero one three, {callsign}",
    instructionType: 'altimeter_setting',
    requiredElements: ['altimeter_value', 'callsign'],
    commonErrors: [
      { error: "one zero three one", type: 'transposition' },
      { error: "one zero one zero", type: 'wrong_value' },
      { error: "Roger", type: 'incomplete_readback' }
    ]
  },
  {
    instruction: "altimeter two niner niner two",
    correctReadback: "altimeter two niner niner two, {callsign}",
    instructionType: 'altimeter_setting',
    requiredElements: ['altimeter_value', 'callsign'],
    commonErrors: [
      { error: "two nine two nine", type: 'transposition' }
    ]
  },

  // SQUAWK CODES
  {
    instruction: "squawk two three four one",
    correctReadback: "squawk two three four one, {callsign}",
    instructionType: 'squawk_code',
    requiredElements: ['squawk_value', 'callsign'],
    commonErrors: [
      { error: "two four three one", type: 'transposition' }
    ]
  },

  // FREQUENCY CHANGES
  {
    instruction: "contact manila approach one one nine decimal one",
    correctReadback: "manila approach one one nine decimal one, {callsign}",
    instructionType: 'frequency_change',
    requiredElements: ['facility', 'frequency', 'callsign'],
    commonErrors: [
      { error: "one one eight decimal one", type: 'wrong_value' }
    ]
  },

  // APPROACH CLEARANCES
  {
    instruction: "cleared ILS approach runway two four",
    correctReadback: "cleared ILS approach runway two four, {callsign}",
    instructionType: 'approach_clearance',
    requiredElements: ['approach_type', 'runway', 'callsign'],
    commonErrors: [
      { error: "Roger", type: 'incomplete_readback' }
    ]
  },

  // TAKEOFF CLEARANCES
  {
    instruction: "runway two four cleared for takeoff",
    correctReadback: "runway two four cleared for takeoff, {callsign}",
    instructionType: 'takeoff_clearance',
    requiredElements: ['runway', 'cleared_takeoff', 'callsign'],
    commonErrors: [
      { error: "Roger taking off", type: 'incomplete_readback' }
    ]
  },

  // LINE UP AND WAIT
  {
    instruction: "runway zero six line up and wait",
    correctReadback: "line up and wait runway zero six, {callsign}",
    instructionType: 'lineup_wait',
    requiredElements: ['lineup_wait', 'runway', 'callsign'],
    commonErrors: [
      { error: "cleared for takeoff", type: 'parameter_confusion' }
    ]
  },

  // DIRECT TO
  {
    instruction: "proceed direct BOREG",
    correctReadback: "direct BOREG, {callsign}",
    instructionType: 'direct_to',
    requiredElements: ['waypoint', 'callsign'],
    commonErrors: []
  },

  // LANDING CLEARANCES
  {
    instruction: "runway two four cleared to land",
    correctReadback: "cleared to land runway two four, {callsign}",
    instructionType: 'landing_clearance',
    requiredElements: ['cleared', 'runway', 'callsign'],
    commonErrors: [
      { error: "Roger landing", type: 'incomplete_readback' },
      { error: "cleared to land runway two six", type: 'wrong_value' }
    ]
  },
  {
    instruction: "continue approach runway two four cleared to land",
    correctReadback: "continue approach cleared to land runway two four, {callsign}",
    instructionType: 'landing_clearance',
    requiredElements: ['cleared', 'runway', 'callsign'],
    commonErrors: [
      { error: "continue approach", type: 'missing_element' }
    ]
  },

  // TAXI INSTRUCTIONS
  {
    instruction: "taxi to runway two four via alpha bravo",
    correctReadback: "taxi to runway two four via alpha bravo, {callsign}",
    instructionType: 'taxi_instruction',
    requiredElements: ['runway', 'route', 'callsign'],
    commonErrors: [
      { error: "taxiing", type: 'incomplete_readback' },
      { error: "taxi runway two four", type: 'missing_element' }
    ]
  },
  {
    instruction: "hold short runway two four",
    correctReadback: "hold short runway two four, {callsign}",
    instructionType: 'hold_instruction',
    requiredElements: ['hold short', 'runway', 'callsign'],
    commonErrors: [
      { error: "Roger", type: 'incomplete_readback' },
      { error: "holding", type: 'missing_element' }
    ]
  },
  {
    instruction: "cross runway zero six",
    correctReadback: "cross runway zero six, {callsign}",
    instructionType: 'taxi_instruction',
    requiredElements: ['cross', 'runway', 'callsign'],
    commonErrors: [
      { error: "Roger", type: 'incomplete_readback' },
      { error: "crossing runway", type: 'missing_element' }
    ]
  },

  // HOLDING PATTERNS
  {
    instruction: "hold at BOREG right turns expect further clearance at one five three zero",
    correctReadback: "hold at BOREG right turns expect further clearance one five three zero, {callsign}",
    instructionType: 'hold_instruction',
    requiredElements: ['hold', 'fix', 'direction', 'callsign'],
    commonErrors: [
      { error: "hold BOREG", type: 'missing_element' },
      { error: "hold at BOREG left turns", type: 'wrong_value' }
    ]
  },

  // MISSED APPROACH / GO-AROUND
  {
    instruction: "go around climb and maintain three thousand turn right heading zero nine zero",
    correctReadback: "going around climb three thousand right heading zero nine zero, {callsign}",
    instructionType: 'altitude_change',
    requiredElements: ['go around', 'altitude', 'heading', 'callsign'],
    commonErrors: [
      { error: "going around", type: 'missing_element' }
    ]
  },
  {
    instruction: "execute missed approach climb runway heading to four thousand",
    correctReadback: "missed approach runway heading climb four thousand, {callsign}",
    instructionType: 'altitude_change',
    requiredElements: ['missed approach', 'altitude', 'callsign'],
    commonErrors: [
      { error: "missed approach", type: 'missing_element' }
    ]
  },

  // COMBINED INSTRUCTIONS
  {
    instruction: "descend and maintain eight thousand reduce speed two two zero knots",
    correctReadback: "descend and maintain eight thousand speed two two zero knots, {callsign}",
    instructionType: 'altitude_change',
    requiredElements: ['descend', 'altitude', 'speed', 'callsign'],
    commonErrors: [
      { error: "descend eight thousand", type: 'missing_element' },
      { error: "two two zero knots", type: 'missing_element' }
    ]
  },
  {
    instruction: "turn left heading zero nine zero descend and maintain six thousand",
    correctReadback: "left heading zero nine zero descend and maintain six thousand, {callsign}",
    instructionType: 'heading_change',
    requiredElements: ['direction', 'heading', 'altitude', 'callsign'],
    commonErrors: [
      { error: "Roger", type: 'incomplete_readback' }
    ]
  },

  // EXPEDITE INSTRUCTIONS
  {
    instruction: "expedite climb flight level three zero zero",
    correctReadback: "expedite climb flight level three zero zero, {callsign}",
    instructionType: 'altitude_change',
    requiredElements: ['expedite', 'altitude', 'callsign'],
    commonErrors: [
      { error: "climb flight level three zero zero", type: 'missing_element' },
      { error: "climbing", type: 'incomplete_readback' }
    ]
  },

  // CONDITIONAL INSTRUCTIONS
  {
    instruction: "after passing LUBOG climb flight level two eight zero",
    correctReadback: "after LUBOG climb flight level two eight zero, {callsign}",
    instructionType: 'altitude_change',
    requiredElements: ['condition', 'altitude', 'callsign'],
    commonErrors: [
      { error: "climb flight level two eight zero", type: 'missing_element' }
    ]
  },
  {
    instruction: "when ready descend flight level one eight zero",
    correctReadback: "when ready descend flight level one eight zero, {callsign}",
    instructionType: 'altitude_change',
    requiredElements: ['altitude', 'callsign'],
    commonErrors: []
  },

  // SID/STAR CLEARANCES
  {
    instruction: "cleared BOREG one alpha departure runway two four climb and maintain five thousand squawk two three four one",
    correctReadback: "cleared BOREG one alpha departure runway two four climb five thousand squawk two three four one, {callsign}",
    instructionType: 'altitude_change',
    requiredElements: ['sid', 'runway', 'altitude', 'squawk', 'callsign'],
    commonErrors: [
      { error: "BOREG departure runway two four", type: 'missing_element' }
    ]
  },
  {
    instruction: "cleared TONDO one alpha arrival descend via STAR expect ILS approach runway two four",
    correctReadback: "cleared TONDO one alpha arrival descend via STAR expect ILS runway two four, {callsign}",
    instructionType: 'approach_clearance',
    requiredElements: ['star', 'approach', 'runway', 'callsign'],
    commonErrors: [
      { error: "TONDO arrival", type: 'missing_element' }
    ]
  },

  // RADAR VECTORS
  {
    instruction: "turn left heading two four zero for sequencing",
    correctReadback: "left heading two four zero, {callsign}",
    instructionType: 'heading_change',
    requiredElements: ['direction', 'heading', 'callsign'],
    commonErrors: [
      { error: "left heading two zero four", type: 'transposition' }
    ]
  },
  {
    instruction: "fly heading zero three zero intercept localizer runway two four cleared ILS approach",
    correctReadback: "heading zero three zero intercept localizer cleared ILS approach runway two four, {callsign}",
    instructionType: 'approach_clearance',
    requiredElements: ['heading', 'approach', 'runway', 'callsign'],
    commonErrors: [
      { error: "cleared ILS runway two four", type: 'missing_element' }
    ]
  },

  // TRAFFIC INFORMATION
  {
    instruction: "caution wake turbulence departing heavy",
    correctReadback: "caution wake turbulence, {callsign}",
    instructionType: 'information_only',
    requiredElements: ['acknowledgment', 'callsign'],
    commonErrors: [
      { error: "Roger", type: 'incomplete_readback' }
    ]
  },

  // EMERGENCY
  {
    instruction: "roger mayday turn left immediately heading two seven zero descend and maintain four thousand",
    correctReadback: "left heading two seven zero descend four thousand, {callsign}",
    instructionType: 'altitude_change',
    requiredElements: ['heading', 'altitude', 'callsign'],
    commonErrors: [
      { error: "Roger", type: 'incomplete_readback' }
    ]
  },

  // ADDITIONAL QNH/ALTIMETER
  {
    instruction: "QNH one zero zero eight",
    correctReadback: "QNH one zero zero eight, {callsign}",
    instructionType: 'altimeter_setting',
    requiredElements: ['altimeter_value', 'callsign'],
    commonErrors: [
      { error: "one zero zero eight", type: 'missing_element' }
    ]
  },

  // POSITION REPORTS
  {
    instruction: "report BOREG",
    correctReadback: "report BOREG, {callsign}",
    instructionType: 'information_only',
    requiredElements: ['report', 'fix', 'callsign'],
    commonErrors: [
      { error: "Wilco", type: 'incomplete_readback' }
    ]
  },
  {
    instruction: "report passing flight level two five zero",
    correctReadback: "report passing flight level two five zero, {callsign}",
    instructionType: 'information_only',
    requiredElements: ['report', 'altitude', 'callsign'],
    commonErrors: [
      { error: "Wilco", type: 'incomplete_readback' }
    ]
  },

  // SPEED RESTRICTIONS
  {
    instruction: "no speed restrictions",
    correctReadback: "no speed restrictions, {callsign}",
    instructionType: 'speed_change',
    requiredElements: ['speed', 'callsign'],
    commonErrors: [
      { error: "Roger", type: 'incomplete_readback' }
    ]
  },
  {
    instruction: "reduce minimum approach speed",
    correctReadback: "minimum approach speed, {callsign}",
    instructionType: 'speed_change',
    requiredElements: ['speed', 'callsign'],
    commonErrors: [
      { error: "slowing down", type: 'incomplete_readback' }
    ]
  },
  {
    instruction: "maintain mach point eight two",
    correctReadback: "maintain mach point eight two, {callsign}",
    instructionType: 'speed_change',
    requiredElements: ['speed', 'callsign'],
    commonErrors: [
      { error: "mach eight two", type: 'missing_element' }
    ]
  },

  // RADAR SERVICE
  {
    instruction: "radar service terminated squawk VFR",
    correctReadback: "radar service terminated squawk VFR, {callsign}",
    instructionType: 'squawk_code',
    requiredElements: ['squawk', 'callsign'],
    commonErrors: [
      { error: "Roger", type: 'incomplete_readback' }
    ]
  },
  {
    instruction: "squawk ident",
    correctReadback: "squawk ident, {callsign}",
    instructionType: 'squawk_code',
    requiredElements: ['squawk', 'callsign'],
    commonErrors: [
      { error: "Roger", type: 'incomplete_readback' }
    ]
  },

  // MONITOR FREQUENCY
  {
    instruction: "monitor manila ground one two one decimal eight",
    correctReadback: "monitor manila ground one two one decimal eight, {callsign}",
    instructionType: 'frequency_change',
    requiredElements: ['facility', 'frequency', 'callsign'],
    commonErrors: [
      { error: "contact manila ground one two one decimal eight", type: 'wrong_value' }
    ]
  },

  // ============================================================================
  // CONDITIONAL CLEARANCES (Based on ICAO Doc 4444, FAA 7110.65, EUROCONTROL)
  // Source: IVAO, VATSIM, Skybrary, EASA phraseology guides
  // ============================================================================

  // WHEN PASSING conditions
  {
    instruction: "when passing flight level two five zero descend flight level one eight zero",
    correctReadback: "when passing flight level two five zero descend flight level one eight zero, {callsign}",
    instructionType: 'altitude_change',
    requiredElements: ['condition', 'altitude', 'callsign'],
    commonErrors: [
      { error: "descend flight level one eight zero", type: 'condition_omitted' },
      { error: "descend flight level one eight zero now", type: 'condition_violated' },
      { error: "Roger", type: 'roger_substitution' }
    ]
  },
  {
    instruction: "when passing LUBOG turn right heading zero niner zero",
    correctReadback: "when passing LUBOG right heading zero niner zero, {callsign}",
    instructionType: 'heading_change',
    requiredElements: ['condition', 'waypoint', 'direction', 'heading', 'callsign'],
    commonErrors: [
      { error: "right heading zero niner zero", type: 'condition_omitted' },
      { error: "turning right zero niner zero now", type: 'condition_violated' }
    ]
  },
  {
    instruction: "when passing five thousand feet climb and maintain one zero thousand",
    correctReadback: "when passing five thousand climb and maintain one zero thousand, {callsign}",
    instructionType: 'altitude_change',
    requiredElements: ['condition', 'altitude', 'callsign'],
    commonErrors: [
      { error: "climb and maintain one zero thousand", type: 'condition_omitted' },
      { error: "climbing one zero thousand immediately", type: 'condition_violated' }
    ]
  },

  // AFTER PASSING conditions
  {
    instruction: "after passing TONDO climb flight level three two zero",
    correctReadback: "after TONDO climb flight level three two zero, {callsign}",
    instructionType: 'altitude_change',
    requiredElements: ['condition', 'waypoint', 'altitude', 'callsign'],
    commonErrors: [
      { error: "climb flight level three two zero", type: 'condition_omitted' },
      { error: "climbing now flight level three two zero", type: 'condition_violated' }
    ]
  },
  {
    instruction: "after departure turn right direct BOREG",
    correctReadback: "after departure right direct BOREG, {callsign}",
    instructionType: 'heading_change',
    requiredElements: ['condition', 'direction', 'waypoint', 'callsign'],
    commonErrors: [
      { error: "right direct BOREG", type: 'condition_omitted' },
      { error: "Roger", type: 'roger_substitution' }
    ]
  },
  {
    instruction: "after takeoff maintain runway heading until three thousand feet then turn left heading two seven zero",
    correctReadback: "after takeoff runway heading until three thousand then left heading two seven zero, {callsign}",
    instructionType: 'heading_change',
    requiredElements: ['condition', 'runway_heading', 'altitude', 'direction', 'heading', 'callsign'],
    commonErrors: [
      { error: "runway heading then left two seven zero", type: 'condition_omitted' },
      { error: "left heading two seven zero now", type: 'condition_violated' }
    ]
  },

  // UNTIL conditions
  {
    instruction: "maintain three thousand until established on the localizer",
    correctReadback: "maintain three thousand until established, {callsign}",
    instructionType: 'altitude_change',
    requiredElements: ['altitude', 'condition', 'callsign'],
    commonErrors: [
      { error: "maintain three thousand", type: 'condition_omitted' },
      { error: "Roger three thousand", type: 'roger_substitution' }
    ]
  },
  {
    instruction: "maintain two five zero knots until IPUMY then reduce speed one eight zero knots",
    correctReadback: "two five zero knots until IPUMY then one eight zero knots, {callsign}",
    instructionType: 'speed_change',
    requiredElements: ['speed', 'condition', 'waypoint', 'callsign'],
    commonErrors: [
      { error: "two five zero knots then one eight zero", type: 'condition_omitted' },
      { error: "reducing to one eight zero now", type: 'condition_violated' }
    ]
  },
  {
    instruction: "descend via STAR maintain until advised",
    correctReadback: "descend via STAR maintain until advised, {callsign}",
    instructionType: 'altitude_change',
    requiredElements: ['altitude', 'condition', 'callsign'],
    commonErrors: [
      { error: "descend via STAR", type: 'condition_omitted' }
    ]
  },

  // ONCE/UPON conditions
  {
    instruction: "once established on localizer descend to two thousand five hundred",
    correctReadback: "once established descend two thousand five hundred, {callsign}",
    instructionType: 'altitude_change',
    requiredElements: ['condition', 'altitude', 'callsign'],
    commonErrors: [
      { error: "descend two thousand five hundred", type: 'condition_omitted' },
      { error: "descending now two thousand five hundred", type: 'condition_violated' }
    ]
  },
  {
    instruction: "upon reaching flight level three five zero contact manila control one two eight decimal six",
    correctReadback: "upon reaching flight level three five zero contact manila control one two eight decimal six, {callsign}",
    instructionType: 'frequency_change',
    requiredElements: ['condition', 'altitude', 'frequency', 'callsign'],
    commonErrors: [
      { error: "contact manila control one two eight decimal six", type: 'condition_omitted' }
    ]
  },

  // ============================================================================
  // ALTITUDE CONSTRAINTS (AT OR ABOVE/BELOW) - FAA 7110.65, VATSIM training
  // ============================================================================

  {
    instruction: "cross LUBOG at or above eight thousand",
    correctReadback: "cross LUBOG at or above eight thousand, {callsign}",
    instructionType: 'altitude_change',
    requiredElements: ['waypoint', 'constraint', 'altitude', 'callsign'],
    commonErrors: [
      { error: "cross LUBOG eight thousand", type: 'constraint_missing' },
      { error: "Roger", type: 'roger_substitution' }
    ]
  },
  {
    instruction: "cross IPUMY at or below flight level one eight zero",
    correctReadback: "cross IPUMY at or below flight level one eight zero, {callsign}",
    instructionType: 'altitude_change',
    requiredElements: ['waypoint', 'constraint', 'altitude', 'callsign'],
    commonErrors: [
      { error: "cross IPUMY flight level one eight zero", type: 'constraint_missing' },
      { error: "IPUMY at one eight zero", type: 'constraint_missing' }
    ]
  },
  {
    instruction: "descend and maintain five thousand cross TONDO at or above seven thousand",
    correctReadback: "descend maintain five thousand cross TONDO at or above seven thousand, {callsign}",
    instructionType: 'altitude_change',
    requiredElements: ['altitude', 'waypoint', 'constraint', 'callsign'],
    commonErrors: [
      { error: "descend five thousand cross TONDO seven thousand", type: 'constraint_missing' },
      { error: "Roger", type: 'roger_substitution' }
    ]
  },
  {
    instruction: "climb and maintain flight level two niner zero not above flight level two five zero until passing BOREG",
    correctReadback: "climb flight level two niner zero not above two five zero until passing BOREG, {callsign}",
    instructionType: 'altitude_change',
    requiredElements: ['altitude', 'constraint', 'condition', 'waypoint', 'callsign'],
    commonErrors: [
      { error: "climb flight level two niner zero", type: 'constraint_missing' },
      { error: "Roger climbing", type: 'roger_substitution' }
    ]
  },

  // ============================================================================
  // ROGER/WILCO SUBSTITUTION ERRORS - Safety Critical Items
  // Source: ICAO Doc 9432, FAA 7110.65
  // ============================================================================

  {
    instruction: "cleared for takeoff runway two four",
    correctReadback: "cleared for takeoff runway two four, {callsign}",
    instructionType: 'takeoff_clearance',
    requiredElements: ['takeoff_clearance', 'runway', 'callsign'],
    commonErrors: [
      { error: "Roger", type: 'roger_substitution' },
      { error: "Wilco", type: 'roger_substitution' },
      { error: "Copy", type: 'roger_substitution' }
    ]
  },
  {
    instruction: "cleared to land runway zero six",
    correctReadback: "cleared to land runway zero six, {callsign}",
    instructionType: 'landing_clearance',
    requiredElements: ['landing_clearance', 'runway', 'callsign'],
    commonErrors: [
      { error: "Roger", type: 'roger_substitution' },
      { error: "Copied", type: 'roger_substitution' }
    ]
  },
  {
    instruction: "hold short of runway two four",
    correctReadback: "hold short runway two four, {callsign}",
    instructionType: 'taxi_instruction',
    requiredElements: ['hold_short', 'runway', 'callsign'],
    commonErrors: [
      { error: "Roger", type: 'roger_substitution' },
      { error: "Wilco", type: 'roger_substitution' }
    ]
  },
  {
    instruction: "line up and wait runway two four",
    correctReadback: "line up and wait runway two four, {callsign}",
    instructionType: 'lineup_wait',
    requiredElements: ['line_up', 'runway', 'callsign'],
    commonErrors: [
      { error: "Roger", type: 'roger_substitution' },
      { error: "Copied runway two four", type: 'roger_substitution' }
    ]
  },

  // ============================================================================
  // HOLDING PATTERN CLEARANCES - Based on ICAO, FAA AIM, VATSIM training
  // ============================================================================

  {
    instruction: "hold at LUBOG as published expect further clearance at one five three zero",
    correctReadback: "hold at LUBOG as published expect further clearance one five three zero, {callsign}",
    instructionType: 'hold_instruction',
    requiredElements: ['hold', 'waypoint', 'expect_time', 'callsign'],
    commonErrors: [
      { error: "hold LUBOG", type: 'missing_element' },
      { error: "Roger", type: 'roger_substitution' }
    ]
  },
  {
    instruction: "hold south of TONDO on the two seven zero radial left turns one minute legs maintain flight level one eight zero",
    correctReadback: "hold south of TONDO two seven zero radial left turns one minute legs maintain flight level one eight zero, {callsign}",
    instructionType: 'hold_instruction',
    requiredElements: ['hold', 'waypoint', 'radial', 'direction', 'leg_time', 'altitude', 'callsign'],
    commonErrors: [
      { error: "hold TONDO one eight zero", type: 'missing_element' },
      { error: "hold TONDO left one eight zero", type: 'missing_element' },
      { error: "hold TONDO two minute legs", type: 'wrong_value' }
    ]
  },
  {
    instruction: "hold at BOREG inbound course zero niner zero expect approach clearance at two two zero zero",
    correctReadback: "hold BOREG inbound zero niner zero expect approach two two zero zero, {callsign}",
    instructionType: 'hold_instruction',
    requiredElements: ['hold', 'waypoint', 'inbound_course', 'expect_time', 'callsign'],
    commonErrors: [
      { error: "hold BOREG zero niner zero", type: 'missing_element' },
      { error: "Roger", type: 'roger_substitution' }
    ]
  },

  // ============================================================================
  // COMPLEX MULTI-PART INSTRUCTIONS - Departure/Approach scenarios
  // ============================================================================

  {
    instruction: "turn left heading two seven zero descend and maintain four thousand reduce speed one eight zero knots",
    correctReadback: "left heading two seven zero descend four thousand speed one eight zero knots, {callsign}",
    instructionType: 'heading_change',
    requiredElements: ['direction', 'heading', 'altitude', 'speed', 'callsign'],
    commonErrors: [
      { error: "left two seven zero four thousand", type: 'missing_element' },
      { error: "Roger", type: 'roger_substitution' }
    ]
  },
  {
    instruction: "climb and maintain flight level three five zero when passing flight level two eight zero contact manila control one two eight decimal six",
    correctReadback: "climb flight level three five zero when passing two eight zero contact manila control one two eight decimal six, {callsign}",
    instructionType: 'altitude_change',
    requiredElements: ['altitude', 'condition', 'frequency', 'callsign'],
    commonErrors: [
      { error: "climb three five zero contact one two eight six", type: 'condition_omitted' }
    ]
  },

  // ============================================================================
  // APPROACH CLEARANCES WITH RESTRICTIONS
  // ============================================================================

  {
    instruction: "cleared ILS approach runway two four maintain three thousand until established on the localizer",
    correctReadback: "cleared ILS approach runway two four maintain three thousand until established, {callsign}",
    instructionType: 'approach_clearance',
    requiredElements: ['approach', 'runway', 'altitude', 'condition', 'callsign'],
    commonErrors: [
      { error: "cleared ILS two four three thousand", type: 'condition_omitted' },
      { error: "cleared ILS approach", type: 'missing_element' }
    ]
  },
  {
    instruction: "cleared visual approach runway zero six report field in sight",
    correctReadback: "cleared visual approach runway zero six wilco report field in sight, {callsign}",
    instructionType: 'approach_clearance',
    requiredElements: ['approach', 'runway', 'callsign'],
    commonErrors: [
      { error: "cleared visual zero six", type: 'incomplete_readback' }
    ]
  },
  {
    instruction: "cleared RNAV approach runway two four cross IPUMY at or above three thousand",
    correctReadback: "cleared RNAV approach runway two four cross IPUMY at or above three thousand, {callsign}",
    instructionType: 'approach_clearance',
    requiredElements: ['approach', 'runway', 'waypoint', 'constraint', 'altitude', 'callsign'],
    commonErrors: [
      { error: "cleared RNAV two four cross IPUMY three thousand", type: 'constraint_missing' },
      { error: "Roger cleared approach", type: 'roger_substitution' }
    ]
  },

  // ============================================================================
  // SPEED RESTRICTIONS WITH CONDITIONS
  // ============================================================================

  {
    instruction: "reduce speed two zero zero knots maintain until LUBOG then no speed restrictions",
    correctReadback: "speed two zero zero knots until LUBOG then no speed restrictions, {callsign}",
    instructionType: 'speed_change',
    requiredElements: ['speed', 'condition', 'waypoint', 'callsign'],
    commonErrors: [
      { error: "two zero zero knots", type: 'condition_omitted' },
      { error: "reducing now", type: 'condition_violated' }
    ]
  },
  {
    instruction: "after passing flight level two five zero reduce mach point eight two",
    correctReadback: "after passing flight level two five zero reduce mach point eight two, {callsign}",
    instructionType: 'speed_change',
    requiredElements: ['condition', 'altitude', 'speed', 'callsign'],
    commonErrors: [
      { error: "reduce mach point eight two", type: 'condition_omitted' },
      { error: "reducing mach point eight two now", type: 'condition_violated' }
    ]
  },

  // ============================================================================
  // RADAR VECTORS FOR APPROACH
  // ============================================================================

  {
    instruction: "turn right heading one two zero vectors ILS runway two four",
    correctReadback: "right heading one two zero vectors ILS runway two four, {callsign}",
    instructionType: 'heading_change',
    requiredElements: ['direction', 'heading', 'approach', 'runway', 'callsign'],
    commonErrors: [
      { error: "right one two zero", type: 'missing_element' }
    ]
  },
  {
    instruction: "fly heading zero three zero intercept localizer maintain two thousand five hundred until established cleared ILS approach runway two four",
    correctReadback: "heading zero three zero intercept localizer two thousand five hundred until established cleared ILS runway two four, {callsign}",
    instructionType: 'approach_clearance',
    requiredElements: ['heading', 'altitude', 'condition', 'approach', 'runway', 'callsign'],
    commonErrors: [
      { error: "zero three zero cleared ILS two four", type: 'condition_omitted' },
      { error: "Roger cleared ILS", type: 'roger_substitution' }
    ]
  },

  // ============================================================================
  // GO-AROUND INSTRUCTIONS
  // ============================================================================

  {
    instruction: "go around climb and maintain three thousand turn right heading zero niner zero",
    correctReadback: "going around climb three thousand right heading zero niner zero, {callsign}",
    instructionType: 'altitude_change',
    requiredElements: ['go_around', 'altitude', 'direction', 'heading', 'callsign'],
    commonErrors: [
      { error: "going around", type: 'missing_element' },
      { error: "Roger going around", type: 'roger_substitution' }
    ]
  },
  {
    instruction: "go around fly runway heading climb and maintain four thousand contact approach one one niner decimal one",
    correctReadback: "going around runway heading climb four thousand contact approach one one niner decimal one, {callsign}",
    instructionType: 'altitude_change',
    requiredElements: ['go_around', 'runway_heading', 'altitude', 'frequency', 'callsign'],
    commonErrors: [
      { error: "going around contact approach", type: 'missing_element' }
    ]
  },

  // ============================================================================
  // IMMEDIATE/EXPEDITE INSTRUCTIONS (Should not have condition violations)
  // ============================================================================

  {
    instruction: "immediately turn left heading two seven zero traffic alert",
    correctReadback: "immediately left heading two seven zero, {callsign}",
    instructionType: 'heading_change',
    requiredElements: ['immediate', 'direction', 'heading', 'callsign'],
    commonErrors: [
      { error: "left two seven zero", type: 'missing_element' }
    ]
  },
  {
    instruction: "expedite climb flight level three niner zero traffic twelve o'clock",
    correctReadback: "expedite climb flight level three niner zero, {callsign}",
    instructionType: 'altitude_change',
    requiredElements: ['expedite', 'altitude', 'callsign'],
    commonErrors: [
      { error: "climb flight level three niner zero", type: 'missing_element' }
    ]
  },

  // ============================================================================
  // HANDOFF WITH CONDITIONS
  // ============================================================================

  {
    instruction: "when passing flight level two eight zero contact manila control one three two decimal one",
    correctReadback: "when passing flight level two eight zero contact manila control one three two decimal one, {callsign}",
    instructionType: 'frequency_change',
    requiredElements: ['condition', 'altitude', 'frequency', 'callsign'],
    commonErrors: [
      { error: "contact manila control one three two decimal one", type: 'condition_omitted' }
    ]
  },
  {
    instruction: "after passing LUBOG contact cebu approach one two four decimal three",
    correctReadback: "after passing LUBOG contact cebu approach one two four decimal three, {callsign}",
    instructionType: 'frequency_change',
    requiredElements: ['condition', 'waypoint', 'frequency', 'callsign'],
    commonErrors: [
      { error: "contact cebu approach one two four decimal three", type: 'condition_omitted' }
    ]
  },

  // ============================================================================
  // ALTITUDE CHANGE WITH RATE RESTRICTIONS
  // ============================================================================

  {
    instruction: "descend and maintain flight level one eight zero at one thousand feet per minute or greater",
    correctReadback: "descend flight level one eight zero at one thousand feet per minute or greater, {callsign}",
    instructionType: 'altitude_change',
    requiredElements: ['altitude', 'rate', 'callsign'],
    commonErrors: [
      { error: "descend flight level one eight zero", type: 'missing_element' }
    ]
  },
  {
    instruction: "climb and maintain flight level three five zero at pilot's discretion",
    correctReadback: "climb flight level three five zero pilot's discretion, {callsign}",
    instructionType: 'altitude_change',
    requiredElements: ['altitude', 'discretion', 'callsign'],
    commonErrors: [
      { error: "climb flight level three five zero", type: 'missing_element' }
    ]
  }
]

// ============================================================================
// NUMBER NORMALIZATION UTILITIES
// ============================================================================

const SPOKEN_NUMBERS: Record<string, string> = {
  'zero': '0', 'oh': '0', 'o': '0',
  'one': '1', 'wun': '1',
  'two': '2', 'too': '2', 'to': '2',
  'three': '3', 'tree': '3', 'tri': '3',
  'four': '4', 'fower': '4', 'for': '4', 'fo': '4',
  'five': '5', 'fife': '5', 'fi': '5',
  'six': '6', 'siks': '6',
  'seven': '7', 'seben': '7',
  'eight': '8', 'ait': '8', 'ate': '8',
  'nine': '9', 'niner': '9', 'nein': '9', 'nayn': '9',
  'thousand': '000',
  'hundred': '00'
}

// Enhanced: Detect transposition errors (common in ATC)
export function isTransposition(value1: string, value2: string): boolean {
  if (!value1 || !value2 || value1.length !== value2.length) return false
  if (value1 === value2) return false

  const sorted1 = value1.split('').sort().join('')
  const sorted2 = value2.split('').sort().join('')

  if (sorted1 !== sorted2) return false

  // Count differences
  let differences = 0
  for (let i = 0; i < value1.length; i++) {
    if (value1[i] !== value2[i]) differences++
  }

  // Transposition: at most maxTranspositionDifferences differing positions (loaded from appDepCorpus.json checks)
  // Prevents full-anagram scrambles from being classified as transpositions
  const maxDiff = _CHECKS.maxTranspositionDifferences ?? 4
  return differences >= 2 && differences <= maxDiff
}

// Enhanced: Calculate similarity score between two values
export function calculateSimilarity(value1: string, value2: string): number {
  if (!value1 || !value2) return 0
  if (value1 === value2) return 1

  const len = Math.max(value1.length, value2.length)
  let matches = 0

  for (let i = 0; i < Math.min(value1.length, value2.length); i++) {
    if (value1[i] === value2[i]) matches++
  }

  return matches / len
}

const COMPOUND_NUMBERS: Record<string, string> = {
  'ten': '10', 'eleven': '11', 'twelve': '12', 'thirteen': '13',
  'fourteen': '14', 'fifteen': '15', 'sixteen': '16', 'seventeen': '17',
  'eighteen': '18', 'nineteen': '19', 'twenty': '20', 'thirty': '30',
  'forty': '40', 'fifty': '50', 'sixty': '60', 'seventy': '70',
  'eighty': '80', 'ninety': '90'
}

/**
 * Normalizes text to extract numeric values for comparison
 */
export function normalizeToDigits(text: string): string {
  let normalized = text.toLowerCase().trim()

  // Normalize ICAO Doc 9432 Table 5-1 phonetic word spellings and common corpus variants
  // before any digit replacement. These are word-level variants (not individual digit
  // phonetics) that appear in ICAO-trained pilot/controller transcripts.
  normalized = normalized.replace(/\btousand\b/gi, 'thousand')          // ICAO: TOU-SAND
  normalized = normalized.replace(/\bday[\-\s]?see[\-\s]?mal\b/gi, 'decimal') // ICAO: DAY-SEE-MAL
  normalized = normalized.replace(/\bdesimal\b/gi, 'decimal')            // Filipino phonetic variant

  // Handle compound numbers first (twenty, thirty, etc.)
  for (const [word, digits] of Object.entries(COMPOUND_NUMBERS)) {
    normalized = normalized.replace(new RegExp(`\\b${word}\\b`, 'gi'), digits)
  }

  // Handle individual spoken numbers - must do in specific order
  // to avoid partial replacements
  const orderedNumbers = [
    ['niner', '9'],
    ['zero', '0'],
    ['one', '1'],
    ['two', '2'],
    ['three', '3'],
    ['tree', '3'],
    ['four', '4'],
    ['fower', '4'],
    ['five', '5'],
    ['fife', '5'],
    ['six', '6'],
    ['seven', '7'],
    ['eight', '8'],
    ['ait', '8'],
    ['nine', '9'],
    ['oh', '0'],
    ['wun', '1'],
    ['too', '2'],
  ]

  for (const [word, digit] of orderedNumbers) {
    normalized = normalized.replace(new RegExp(`\\b${word}\\b`, 'gi'), digit)
  }

  // Remove ALL spaces between consecutive digits (run multiple times to catch all)
  let prev = ''
  while (prev !== normalized) {
    prev = normalized
    normalized = normalized.replace(/(\d)\s+(\d)/g, '$1$2')
  }

  return normalized
}

/**
 * Removes callsign from text to avoid extracting callsign numbers as values
 */
function removeCallsign(text: string): string {
  // Remove common callsign patterns: PAL 123, CEB 456, etc.
  return text
    .replace(/\b[A-Z]{2,4}\s*\d{2,4}\b/gi, '')
    .replace(/\bRP-?C\d{3,5}\b/gi, '')
    .trim()
}

/**
 * Extracts a specific numeric value from text based on context
 * Now properly excludes callsign numbers
 */
export function extractNumericValue(text: string, type: 'altitude' | 'heading' | 'speed' | 'altimeter' | 'squawk' | 'frequency'): string | null {
  // Remove callsign in two passes:
  // 1. Remove spoken-form callsigns before digit normalization ("CEBU one one eight six")
  // 2. Remove digit-form callsigns after normalization ("CEBU 1186") — prevents callsign
  //    numbers from being grabbed as altitude/frequency values via the bigNumMatch fallback.
  const cleanedText = removeCallsign(text)
  const normalized = removeCallsign(normalizeToDigits(cleanedText))

  switch (type) {
    case 'altitude': {
      // Check for flight level first
      const flMatch = normalized.match(/flight\s*level\s*(\d{2,3})/i) ||
                      normalized.match(/fl\s*(\d{2,3})/i)
      if (flMatch) return 'FL' + flMatch[1]

      // Check for "X thousand" pattern (e.g. "eleven thousand" → 11000)
      // Also handles ICAO digit-by-digit form: "one one thousand" → 11000, "one zero thousand" → 10000
      const singleDigitMap: Record<string, number> = {
        zero:0, one:1, two:2, three:3, four:4, five:5,
        six:6, seven:7, eight:8, nine:9, niner:9,
      }
      const wordToNum: Record<string, string> = {
        'one': '1000', 'two': '2000', 'three': '3000', 'four': '4000', 'five': '5000',
        'six': '6000', 'seven': '7000', 'eight': '8000', 'nine': '9000', 'niner': '9000',
        'ten': '10000', 'eleven': '11000', 'twelve': '12000',
        'thirteen': '13000', 'fourteen': '14000', 'fifteen': '15000',
        'sixteen': '16000', 'seventeen': '17000', 'eighteen': '18000', 'nineteen': '19000',
        'twenty': '20000', 'thirty': '30000', 'forty': '40000', 'fifty': '50000',
        'sixty': '60000', 'seventy': '70000', 'eighty': '80000', 'ninety': '90000',
      }
      // Two-word digit form: "one one thousand", "one zero thousand"
      const twoWordThousandMatch = cleanedText.toLowerCase().match(/\b(\w+)\s+(\w+)\s+thousand\b/i)
      if (twoWordThousandMatch) {
        const d1 = singleDigitMap[twoWordThousandMatch[1]]
        const d2 = singleDigitMap[twoWordThousandMatch[2]]
        if (d1 !== undefined && d2 !== undefined) {
          return String((d1 * 10 + d2) * 1000)
        }
      }
      const thousandMatch = cleanedText.toLowerCase().match(/\b(\w+)\s+thousand\b/i)
      if (thousandMatch) {
        const numWord = thousandMatch[1].toLowerCase()
        if (wordToNum[numWord]) return wordToNum[numWord]
      }

      // Check for altitude in feet (3-5 digits) after "maintain" or "climb/descend"
      const altMatch = normalized.match(/(?:maintain|climb|descend)[^0-9]*(\d{3,5})/i)
      if (altMatch) return altMatch[1]

      // Fallback: look for 4-5 digit numbers (more likely altitude than callsign)
      const bigNumMatch = normalized.match(/(\d{4,5})/i)
      return bigNumMatch ? bigNumMatch[1] : null
    }

    case 'heading': {
      // First normalize the text to convert spoken numbers to digits
      const hdgNormalized = normalizeToDigits(cleanedText)

      // Look for explicit heading patterns after normalization
      const hdgMatch = hdgNormalized.match(/heading\s*(\d{1,3})/i)
      if (hdgMatch) return hdgMatch[1].padStart(3, '0')

      // Look for "turn left/right heading XXX" or "left/right heading XXX"
      const turnMatch = hdgNormalized.match(/(?:turn\s+)?(?:left|right)\s+(?:heading\s*)?(\d{1,3})/i)
      if (turnMatch) return turnMatch[1].padStart(3, '0')

      // Look for "turn left/right XXX" (numbers after direction)
      const dirNumMatch = hdgNormalized.match(/(?:turn\s+)?(?:left|right)\s+(\d{2,3})/i)
      if (dirNumMatch) return dirNumMatch[1].padStart(3, '0')

      // Look for 3 consecutive digits in heading context
      if (/heading|turn|fly/i.test(cleanedText)) {
        const threeDigits = hdgNormalized.match(/(\d{3})/i)
        if (threeDigits) return threeDigits[1]
      }

      return null
    }

    case 'speed': {
      // Mach speed (high-altitude cruise): "mach point eight two" → "M.82"
      const machMatch = normalized.match(/mach\s*(?:point\s*)?(\d{1,2})/i) ||
                        normalized.match(/\bm\s*\.\s*(\d{1,2})\b/i)
      if (machMatch) return 'M.' + machMatch[1]

      // Knot speed: 2-3 digit number in knots context
      const spdMatch = normalized.match(/speed[^0-9]*(\d{2,3})/i) ||
                       normalized.match(/(\d{2,3})\s*knots?/i) ||
                       normalized.match(/(?:reduce|increase|maintain)[^0-9]*(\d{2,3})/i)
      return spdMatch ? spdMatch[1] : null
    }

    case 'altimeter': {
      // First normalize the ORIGINAL text to convert spoken numbers to digits
      // (cleanedText has callsign removed but we need it for altimeter context)
      const originalNormalized = normalizeToDigits(text.toLowerCase())

      // Altimeter is 4 digits after "altimeter" or "qnh"
      const altimMatch = originalNormalized.match(/(?:altimeter|qnh)\s*(\d{4})/i)
      if (altimMatch) return altimMatch[1]

      // Also look for 4 consecutive digits in altimeter context
      if (/altimeter|qnh/i.test(text)) {
        const fourDigits = originalNormalized.match(/(\d{4})/i)
        if (fourDigits) return fourDigits[1]
      }

      return null
    }

    case 'squawk': {
      // Squawk is 4 digits after "squawk" or "transponder"
      const sqkMatch = normalized.match(/(?:squawk|transponder)\s*(\d{4})/i)
      return sqkMatch ? sqkMatch[1] : null
    }

    case 'frequency': {
      // Frequency is XXX.XX format — also handle phonetic/regional "decimal" variants:
      //   standard: "decimal", "point"
      //   Filipino phonetic: "day-see-mal", "day see mal", "desimal"
      // Cap decimal part at 3 digits; a 4th digit is almost certainly a callsign number
      // that was spoken directly after the frequency (e.g. "124.4" + "411" → "124.4411").
      const freqMatch = normalized.match(
        /(\d{3})\s*(?:decimal|point|day[\-\s]?see[\-\s]?mal|desimal|\.)\s*(\d{1,3})/i
      )
      if (!freqMatch) return null
      // Trim trailing zeros from decimal part for canonical comparison
      const decPart = freqMatch[2].replace(/0+$/, '') || '0'
      return `${freqMatch[1]}.${decPart}`
    }
  }

  return null
}

// ============================================================================
// STRUCTURED COMMAND PARSING
// ============================================================================

/**
 * Safety-critical items that REQUIRE full readback (not just Roger/Wilco)
 * Per ICAO Doc 9432 and FAA 7110.65
 */
const SAFETY_CRITICAL_PATTERNS = [
  /cleared\s+(for\s+)?take\s*off/i,
  /cleared\s+to\s+land/i,
  /line\s+up\s+(and\s+)?wait/i,
  /hold\s+short/i,
  /cross\s+runway/i,
  /altimeter\s+\d/i,
  /qnh\s+\d/i,
  /squawk\s+\d/i,
  /(climb|descend)\s+(and\s+)?maintain/i,
  /maintain\s+\d/i,
  /flight\s+level\s*\d/i,
  /turn\s+(left|right)/i,
  /heading\s+\d/i,
  /contact\s+\w+\s+(on\s+)?\d{3}/i,
  /reduce\s+speed/i,
  /increase\s+speed/i,
  /maintain\s+speed/i,
  /cleared\s+(ils|rnav|vor|visual|approach)/i,
  /go\s+around/i,
  /expedite/i,
  /immediate/i
]

/**
 * Condition extraction patterns
 */
const CONDITION_PATTERNS: { regex: RegExp; type: ConditionType }[] = [
  { regex: /when\s+(you\s+)?(reach|pass|passing|at|clear\s+of|abeam)/i, type: 'WHEN' },
  { regex: /when\s+ready/i, type: 'WHEN' },
  { regex: /when\s+established/i, type: 'WHEN' },
  { regex: /until\s+(established|reaching|clear|advised)/i, type: 'UNTIL' },
  { regex: /until\s+further\s+advised/i, type: 'UNTIL' },
  { regex: /after\s+(passing|departure|takeoff|reaching)/i, type: 'AFTER' },
  { regex: /after\s+\w+\s+(departure|takeoff)/i, type: 'AFTER' },
  { regex: /at\s+(or\s+)?(above|below|before)/i, type: 'AT' },
  { regex: /once\s+(established|clear|airborne|passing)/i, type: 'ONCE' },
  { regex: /before\s+(reaching|passing|entering)/i, type: 'BEFORE' },
  { regex: /upon\s+(reaching|passing|entering)/i, type: 'UPON' }
]

/**
 * Constraint extraction patterns
 */
const CONSTRAINT_PATTERNS = [
  { regex: /at\s+or\s+above\s+(\d+|flight\s+level\s*\d+)/i, type: 'at_or_above' },
  { regex: /at\s+or\s+below\s+(\d+|flight\s+level\s*\d+)/i, type: 'at_or_below' },
  { regex: /not\s+below\s+(\d+)/i, type: 'not_below' },
  { regex: /not\s+above\s+(\d+)/i, type: 'not_above' },
  { regex: /cross\s+\w+\s+at\s+(\d+)/i, type: 'cross_at' },
  { regex: /cross\s+\w+\s+at\s+or\s+(above|below)\s+(\d+)/i, type: 'cross_constraint' }
]

/**
 * Immediate execution patterns (should flag if used with conditional instructions)
 */
const IMMEDIATE_PATTERNS = [
  /\bnow\b/i,
  /\bimmediately\b/i,
  /\bright\s+now\b/i,
  /\bimmediately\s+now\b/i,
  /\bno\s+delay\b/i
]

/**
 * Parses ATC instruction into structured command format
 */
export function parseStructuredCommand(atcInstruction: string): StructuredCommand {
  const normalized = atcInstruction.toLowerCase().trim()

  // Extract action
  const actionMatch = normalized.match(
    /\b(climb|descend|maintain|turn|fly|reduce|increase|hold|cross|contact|squawk|cleared|line\s+up|taxi|proceed|direct)\b/i
  )
  const action = actionMatch ? actionMatch[1] : 'unknown'

  // Determine parameter type
  let parameter = 'unknown'
  if (/altitude|flight\s+level|fl\s*\d|thousand|feet/i.test(normalized)) parameter = 'altitude'
  else if (/heading\s*\d|turn\s+(left|right)/i.test(normalized)) parameter = 'heading'
  else if (/speed\b/i.test(normalized) ||
           (/knots?\b/i.test(normalized) && !/\bwind\b/i.test(normalized))) parameter = 'speed'
  else if (/altimeter|qnh/i.test(normalized)) parameter = 'altimeter'
  else if (/squawk/i.test(normalized)) parameter = 'squawk'
  else if (/frequency|contact/i.test(normalized)) parameter = 'frequency'
  else if (/runway/i.test(normalized)) parameter = 'runway'
  else if (/hold\s+\w{3,5}|direct\s+\w{3,5}|proceed\s+\w{3,5}/i.test(normalized)) parameter = 'fix'

  // Extract value
  let value: string | number = ''
  const numericValue = extractNumericValue(atcInstruction,
    parameter === 'altitude' ? 'altitude' :
    parameter === 'heading' ? 'heading' :
    parameter === 'speed' ? 'speed' :
    parameter === 'altimeter' ? 'altimeter' :
    parameter === 'squawk' ? 'squawk' :
    parameter === 'frequency' ? 'frequency' : 'altitude'
  )
  if (numericValue) value = numericValue

  // Extract fix/waypoint for hold/direct instructions
  if (parameter === 'fix') {
    const fixMatch = normalized.match(/(?:hold|direct|proceed)\s+(?:to\s+)?([a-z]{3,5})/i)
    if (fixMatch) value = fixMatch[1].toUpperCase()
  }

  // Extract unit
  let unit: string | undefined
  if (/feet/i.test(normalized)) unit = 'feet'
  else if (/knots?/i.test(normalized)) unit = 'knots'
  else if (/minutes?|mins?/i.test(normalized)) unit = 'minutes'

  // Extract modifier
  let modifier: string | undefined
  if (/and\s+maintain/i.test(normalized)) modifier = 'and maintain'
  else if (/expedite/i.test(normalized)) modifier = 'expedite'

  // Extract condition
  let condition: StructuredCommand['condition']
  for (const { regex, type } of CONDITION_PATTERNS) {
    const match = normalized.match(regex)
    if (match) {
      // Get the full conditional phrase
      const phraseMatch = normalized.match(new RegExp(`${regex.source}[^,;]*`, 'i'))
      condition = {
        type,
        phrase: phraseMatch ? phraseMatch[0].trim() : match[0],
        triggerValue: extractConditionTriggerValue(phraseMatch ? phraseMatch[0] : match[0])
      }
      break
    }
  }

  // Extract constraint
  let constraint: StructuredCommand['constraint']
  for (const { regex, type } of CONSTRAINT_PATTERNS) {
    const match = normalized.match(regex)
    if (match) {
      constraint = {
        type,
        phrase: match[0],
        value: match[1] || match[2]
      }
      break
    }
  }

  // Check for immediate execution
  const isImmediate = IMMEDIATE_PATTERNS.some(p => p.test(normalized))

  return {
    action,
    parameter,
    value,
    unit,
    modifier,
    condition,
    constraint,
    isImmediate,
    rawText: atcInstruction
  }
}

/**
 * Extracts the trigger value from a condition phrase
 */
function extractConditionTriggerValue(phrase: string): string | undefined {
  // Try to extract altitude/FL
  const altMatch = phrase.match(/(\d{3,5}|flight\s+level\s*\d{2,3}|fl\s*\d{2,3})/i)
  if (altMatch) return altMatch[1].toUpperCase().replace(/\s+/g, '')

  // Try to extract waypoint
  const fixMatch = phrase.match(/(?:passing|at|reach|abeam)\s+([A-Z]{3,5})/i)
  if (fixMatch) return fixMatch[1].toUpperCase()

  // Check for "established"
  if (/established/i.test(phrase)) return 'established'

  return undefined
}

/**
 * Validates pilot readback against structured ATC command
 */
export function validateReadbackAgainstCommand(
  atcCommand: StructuredCommand,
  pilotReadback: string
): CommandValidationResult {
  const errors: ReadbackError[] = []
  const missingElements: string[] = []
  const pilotLower = pilotReadback.toLowerCase()
  const pilotNormalized = normalizeToDigits(pilotReadback)

  // Check for Roger/Wilco substitution on safety-critical items
  const isSafetyCritical = SAFETY_CRITICAL_PATTERNS.some(p => p.test(atcCommand.rawText))
  const hasRogerWilco = /\b(roger|wilco|copied|copy|affirmative|affirm)\b/i.test(pilotLower)
  const isOnlyRogerWilco = /^\s*(roger|wilco|copied|copy|affirmative|affirm|ok|okay)\s*[,.]?\s*([a-z]{2,4}\s*\d{2,4})?\s*$/i.test(pilotReadback.trim())

  if (isSafetyCritical && isOnlyRogerWilco) {
    errors.push({
      type: 'roger_substitution',
      parameter: atcCommand.parameter,
      expectedValue: atcCommand.value.toString(),
      actualValue: pilotReadback,
      weight: 'critical',
      explanation: `"${hasRogerWilco ? pilotReadback.match(/\b(roger|wilco|copied|copy)\b/i)?.[0] : 'Roger'}" cannot substitute for readback of mandatory readback items. Full readback required for verification.`,
      icaoReference: 'ICAO Doc 9432 §4.5.7 - Readback/Hearback Requirements'
    })
  }

  // Validate numeric value
  if (atcCommand.value) {
    const atcValue = normalizeToDigits(atcCommand.value.toString())
    const pilotValue = extractNumericValue(pilotReadback,
      atcCommand.parameter as 'altitude' | 'heading' | 'speed' | 'altimeter' | 'squawk' | 'frequency'
    )

    if (!pilotValue) {
      missingElements.push(atcCommand.parameter)
      errors.push({
        type: 'missing_element',
        parameter: atcCommand.parameter,
        expectedValue: atcCommand.value.toString(),
        actualValue: null,
        weight: atcCommand.parameter === 'altitude' || atcCommand.parameter === 'heading' ? 'high' : 'medium',
        explanation: `Required ${atcCommand.parameter} value not read back`
      })
    } else if (normalizeToDigits(pilotValue) !== normalizeToDigits(atcValue)) {
      errors.push({
        type: 'wrong_value',
        parameter: atcCommand.parameter,
        expectedValue: atcCommand.value.toString(),
        actualValue: pilotValue,
        weight: 'high',
        explanation: `${atcCommand.parameter} mismatch: ATC said "${atcCommand.value}", pilot read back "${pilotValue}"`
      })
    }
  }

  // Validate condition readback
  let conditionStatus: CommandValidationResult['conditionStatus'] = 'not_applicable'

  if (atcCommand.condition) {
    conditionStatus = 'missing'

    // Check if pilot repeated the condition
    const conditionKeywords = atcCommand.condition.phrase.split(/\s+/).filter(w => w.length > 2)
    const hasConditionKeywords = conditionKeywords.some(kw => pilotLower.includes(kw))

    if (hasConditionKeywords) {
      conditionStatus = 'present'
    } else {
      errors.push({
        type: 'condition_omitted',
        parameter: 'condition',
        expectedValue: atcCommand.condition.phrase,
        actualValue: null,
        weight: 'high',
        explanation: `Conditional phrase "${atcCommand.condition.phrase}" not read back. Controllers need to verify pilot understands the timing.`,
        icaoReference: 'ICAO Doc 9432 - Conditional clearances must be read back'
      })
    }

    // Check for condition violation ("now" added to conditional instruction)
    if (!atcCommand.isImmediate && IMMEDIATE_PATTERNS.some(p => p.test(pilotLower))) {
      conditionStatus = 'violated'
      errors.push({
        type: 'condition_violated',
        parameter: 'timing',
        expectedValue: atcCommand.condition.phrase,
        actualValue: pilotReadback.match(/\b(now|immediately|right\s+now)\b/i)?.[0] || 'now',
        weight: 'critical',
        explanation: `Pilot added "now" but ATC instruction was conditional ("${atcCommand.condition.phrase}"). This could cause premature execution.`,
        icaoReference: 'FAA 7110.65 §4-3-1 - Conditional instructions timing'
      })
    }
  }

  // Validate constraint readback
  let constraintStatus: CommandValidationResult['constraintStatus'] = 'not_applicable'

  if (atcCommand.constraint) {
    constraintStatus = 'missing'

    // Check if pilot read back the constraint
    const constraintKeywords = ['at or above', 'at or below', 'not below', 'not above', 'cross at']
    const hasConstraint = constraintKeywords.some(kw => pilotLower.includes(kw))

    if (hasConstraint) {
      constraintStatus = 'present'
    } else {
      errors.push({
        type: 'constraint_missing',
        parameter: 'constraint',
        expectedValue: atcCommand.constraint.phrase,
        actualValue: null,
        weight: 'high',
        explanation: `Altitude constraint "${atcCommand.constraint.phrase}" not read back. This is a required readback element.`,
        icaoReference: 'FAA 7110.65 §4-5-7 - Altitude restrictions'
      })
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
    missingElements,
    conditionStatus,
    constraintStatus
  }
}

/**
 * Checks if an instruction contains safety-critical elements requiring full readback
 */
export function isSafetyCriticalInstruction(instruction: string): boolean {
  return SAFETY_CRITICAL_PATTERNS.some(p => p.test(instruction))
}

/**
 * Detects if pilot added immediate execution cue to a conditional instruction
 */
export function detectConditionViolation(atcInstruction: string, pilotReadback: string): {
  hasViolation: boolean
  atcCondition?: string
  pilotImmediate?: string
} {
  const atcCommand = parseStructuredCommand(atcInstruction)
  const pilotLower = pilotReadback.toLowerCase()

  // If ATC gave conditional instruction
  if (atcCommand.condition && !atcCommand.isImmediate) {
    // Check if pilot added "now" or "immediately"
    const immediateMatch = pilotLower.match(/\b(now|immediately|right\s+now)\b/i)
    if (immediateMatch) {
      return {
        hasViolation: true,
        atcCondition: atcCommand.condition.phrase,
        pilotImmediate: immediateMatch[0]
      }
    }
  }

  return { hasViolation: false }
}

// ============================================================================
// INSTRUCTION TYPE DETECTION
// ============================================================================

interface InstructionPattern {
  type: InstructionType
  patterns: RegExp[]
  priority: number  // Higher = check first
  requiredReadbackElements: string[]
}

const INSTRUCTION_PATTERNS: InstructionPattern[] = [
  // Critical instructions (highest priority)
  {
    type: 'takeoff_clearance',
    patterns: [
      /cleared\s+(for\s+)?take\s*off/i,
      /runway\s+\d+.*cleared\s+(for\s+)?take\s*off/i
    ],
    priority: 100,
    requiredReadbackElements: ['runway', 'cleared for takeoff', 'callsign']
  },
  {
    type: 'landing_clearance',
    patterns: [
      /cleared\s+to\s+land/i,
      /runway\s+\d+.*cleared\s+to\s+land/i
    ],
    priority: 100,
    requiredReadbackElements: ['runway', 'cleared to land', 'callsign']
  },
  {
    type: 'lineup_wait',
    patterns: [
      /line\s+up\s+(and\s+)?wait/i
    ],
    priority: 100,
    requiredReadbackElements: ['runway', 'line up and wait', 'callsign']
  },

  // Altimeter - high priority, safety critical
  {
    type: 'altimeter_setting',
    patterns: [
      /altimeter\s+(one|two|three|four|five|six|seven|eight|nine|zero|niner|\d)/i,
      /qnh\s+(one|two|three|four|five|six|seven|eight|nine|zero|niner|\d)/i
    ],
    priority: 92,
    requiredReadbackElements: ['altimeter', 'callsign']
  },

  // Altitude changes
  {
    type: 'altitude_change',
    patterns: [
      /(climb|descend)\s+(to\s+)?(and\s+)?maintain/i,  // handles "climb and maintain", "climb to and maintain"
      /(climb|descend)\s+(to\s+)?(flight\s+level|fl\s*\d|\d+\s*(thousand|hundred|feet))/i,
      /maintain\s+(flight\s+level|fl\s*\d|\d+\s*(thousand|hundred|feet))/i,
      /stop\s+(climb|descent)/i,
      /expedite\s+(climb|descent)/i
    ],
    priority: 90,
    requiredReadbackElements: ['action', 'altitude', 'callsign']
  },

  // Heading changes - expanded patterns
  {
    type: 'heading_change',
    patterns: [
      /turn\s+(left|right)\s+heading/i,
      /turn\s+(left|right)\s+(one|two|three|four|five|six|seven|eight|nine|zero|niner|\d)/i,
      /fly\s+heading/i,
      /heading\s+(one|two|three|four|five|six|seven|eight|nine|zero|niner|\d)/i,
      /steer\s+heading/i
    ],
    priority: 88,
    requiredReadbackElements: ['direction', 'heading', 'callsign']
  },

  // Speed changes
  {
    type: 'speed_change',
    patterns: [
      /(reduce|increase)\s+speed/i,
      /maintain\s+speed/i,
      /speed\s+\d+\s*knots?/i,
      /speed\s+(one|two|three|four|five|six|seven|eight|nine|zero|niner)/i,
      /maintain\s+\d+\s*knots?/i,
      /\d+\s*knots?/i,
      /(one|two|three|four|five|six|seven|eight|nine|zero|niner).*(one|two|three|four|five|six|seven|eight|nine|zero|niner).*knots?/i
    ],
    priority: 80,
    requiredReadbackElements: ['speed', 'callsign']
  },

  // Altimeter
  {
    type: 'altimeter_setting',
    patterns: [
      /altimeter\s+\d/i,
      /qnh\s+\d/i
    ],
    priority: 85,
    requiredReadbackElements: ['altimeter', 'callsign']
  },

  // Squawk
  {
    type: 'squawk_code',
    patterns: [
      /squawk\s+\d{4}/i,
      /transponder\s+\d{4}/i,
      /squawk\s+(one|two|three|four|five|six|seven|zero|niner)/i
    ],
    priority: 75,
    requiredReadbackElements: ['squawk', 'callsign']
  },

  // Frequency
  {
    type: 'frequency_change',
    patterns: [
      /contact\s+\w+(?:\s+\w+)?\s+(on\s+)?\d{3}/i,  // up to 2-word facility: "Manila Tower"
      /monitor\s+\w+(?:\s+\w+)?/i,
      /frequency\s+\d{3}/i,
      /\d{3}\.\d/  // bare frequency digits (e.g. "118.5")
    ],
    priority: 75,
    requiredReadbackElements: ['facility', 'frequency', 'callsign']
  },

  // Approach
  {
    type: 'approach_clearance',
    patterns: [
      /cleared\s+(ils|rnav|vor|visual|ndb)\s+approach/i,
      /expect\s+(ils|rnav|vor|visual)\s+approach/i
    ],
    priority: 85,
    requiredReadbackElements: ['approach type', 'runway', 'callsign']
  },

  // Direct to
  {
    type: 'direct_to',
    patterns: [
      /proceed\s+direct\s+(to\s+)?\w+/i,
      /direct\s+(to\s+)?\w+/i,
      /cleared\s+direct\s+\w+/i
    ],
    priority: 70,
    requiredReadbackElements: ['waypoint', 'callsign']
  },

  // Hold
  {
    type: 'hold_instruction',
    patterns: [
      /hold\s+(short|at|over|position)/i,
      /hold\s+short\s+(of\s+)?runway/i
    ],
    priority: 90,
    requiredReadbackElements: ['hold', 'location', 'callsign']
  },

  // Taxi instructions
  {
    type: 'taxi_instruction',
    patterns: [
      /taxi\s+(to|via)/i,
      /taxi\s+(runway|gate|ramp)/i,
      /cross\s+runway/i,
      /give\s+way/i,
      /continue\s+taxi/i
    ],
    priority: 70,
    requiredReadbackElements: ['taxi', 'destination', 'callsign']
  },

  // Missed approach / Go around
  {
    type: 'altitude_change',
    patterns: [
      /go\s*around/i,
      /missed\s+approach/i,
      /execute\s+missed/i
    ],
    priority: 95,
    requiredReadbackElements: ['go around', 'altitude', 'heading', 'callsign']
  },

  // SID/STAR clearances
  {
    type: 'altitude_change',
    patterns: [
      /cleared\s+\w+\s+(one|two|three|four|five|six|seven|eight|nine)\s*\w*\s+departure/i,
      /\w+\s+departure\s+runway/i
    ],
    priority: 88,
    requiredReadbackElements: ['sid', 'runway', 'altitude', 'callsign']
  },

  // STAR arrivals
  {
    type: 'approach_clearance',
    patterns: [
      /cleared\s+\w+\s+(one|two|three|four|five|six|seven|eight|nine)\s*\w*\s+arrival/i,
      /descend\s+via\s+star/i,
      /\w+\s+arrival/i
    ],
    priority: 86,
    requiredReadbackElements: ['star', 'approach', 'runway', 'callsign']
  },

  // Traffic information
  {
    type: 'information_only',
    patterns: [
      /traffic\s+\d+\s+o'?clock/i,
      /caution\s+wake\s+turbulence/i,
      /caution\s+jet\s+blast/i
    ],
    priority: 50,
    requiredReadbackElements: ['acknowledgment', 'callsign']
  },

  // Position reports
  {
    type: 'information_only',
    patterns: [
      /report\s+(passing|reaching|leaving)/i,
      /report\s+\w+$/i
    ],
    priority: 45,
    requiredReadbackElements: ['report', 'callsign']
  },

  // Radar service
  {
    type: 'squawk_code',
    patterns: [
      /radar\s+service\s+terminated/i,
      /squawk\s+vfr/i,
      /squawk\s+ident/i,
      /reset\s+transponder/i
    ],
    priority: 72,
    requiredReadbackElements: ['squawk', 'callsign']
  },

  // Monitor frequency (different from contact)
  {
    type: 'frequency_change',
    patterns: [
      /monitor\s+\w+/i
    ],
    priority: 74,
    requiredReadbackElements: ['monitor', 'facility', 'frequency', 'callsign']
  },

  // Expedite instructions
  {
    type: 'altitude_change',
    patterns: [
      /expedite\s+(climb|descent)/i
    ],
    priority: 91,
    requiredReadbackElements: ['expedite', 'altitude', 'callsign']
  },

  // ENHANCED: Approach-specific patterns
  {
    type: 'approach_clearance',
    patterns: [
      /cleared\s+straight\s+in/i,
      /cleared\s+circling/i,
      /contact\s+tower/i,
      /maintain\s+until\s+established/i
    ],
    priority: 88,
    requiredReadbackElements: ['approach', 'runway', 'altitude restriction', 'callsign']
  },

  // ENHANCED: STAR/arrival patterns
  {
    type: 'approach_clearance',
    patterns: [
      /descend\s+via\s+(the\s+)?\w+\s+arrival/i,
      /expect\s+\w+\s+arrival/i,
      /cross\s+\w+\s+at\s+(and\s+)?(maintain\s+)?/i
    ],
    priority: 87,
    requiredReadbackElements: ['star', 'crossing restriction', 'callsign']
  },

  // ENHANCED: Visual approach specific
  {
    type: 'approach_clearance',
    patterns: [
      /cleared\s+visual\s+approach/i,
      /follow\s+(the\s+)?\w+/i,
      /traffic\s+to\s+follow/i,
      /number\s+(one|two|three|four|five)/i
    ],
    priority: 86,
    requiredReadbackElements: ['visual approach', 'runway', 'traffic', 'callsign']
  },

  // ENHANCED: Departure climb patterns
  {
    type: 'altitude_change',
    patterns: [
      /climb\s+unrestricted/i,
      /maintain\s+runway\s+heading/i,
      /radar\s+contact\s*,?\s*(climb|maintain)/i,
      /identified\s*,?\s*(climb|maintain)/i
    ],
    priority: 89,
    requiredReadbackElements: ['altitude', 'heading if applicable', 'callsign']
  },

  // ENHANCED: Combined altitude and QNH
  {
    type: 'altitude_change',
    patterns: [
      /(descend|climb)\s+.*qnh/i,
      /(descend|climb)\s+.*altimeter/i
    ],
    priority: 93,
    requiredReadbackElements: ['altitude', 'qnh/altimeter', 'callsign']
  },

  // Conditional altitude changes
  {
    type: 'altitude_change',
    patterns: [
      /after\s+(passing|reaching)\s+\w+\s+(climb|descend)/i,
      /when\s+ready\s+(climb|descend)/i,
      /when\s+able\s+(climb|descend)/i
    ],
    priority: 89,
    requiredReadbackElements: ['condition', 'altitude', 'callsign']
  },

  // Localizer/ILS intercept
  {
    type: 'approach_clearance',
    patterns: [
      /intercept\s+localizer/i,
      /intercept\s+(ils|loc)/i,
      /join\s+localizer/i
    ],
    priority: 87,
    requiredReadbackElements: ['heading', 'approach', 'runway', 'callsign']
  },

  // Speed restrictions
  {
    type: 'speed_change',
    patterns: [
      /no\s+speed\s+restrictions?/i,
      /minimum\s+(clean\s+)?speed/i,
      /minimum\s+approach\s+speed/i,
      /mach\s+(zero\s+)?point/i
    ],
    priority: 79,
    requiredReadbackElements: ['speed', 'callsign']
  }
]

/**
 * Detects the instruction type from ATC message
 * Now normalizes spoken numbers for better pattern matching
 */
export function detectInstructionType(text: string): InstructionType {
  // Normalize text to handle spoken numbers
  const normalizedText = normalizeToDigits(text.toLowerCase())
  const sortedPatterns = [...INSTRUCTION_PATTERNS].sort((a, b) => b.priority - a.priority)

  // Check both original and normalized text
  for (const { type, patterns } of sortedPatterns) {
    if (patterns.some(p => p.test(text) || p.test(normalizedText))) {
      return type
    }
  }

  return 'unknown'
}

// ============================================================================
// CORE SEMANTIC ANALYSIS
// ============================================================================

/**
 * Analyzes if a pilot readback correctly matches an ATC instruction
 * using semantic understanding and pattern matching
 */
export function analyzeReadback(
  atcInstruction: string,
  pilotReadback: string,
  callsign?: string
): SemanticAnalysisResult {
  const errors: ReadbackError[] = []
  let quality: SemanticAnalysisResult['quality'] = 'complete'
  let confidence = 1.0

  // Normalize inputs
  const atcNorm = atcInstruction.toLowerCase().trim()
  const pilotNorm = pilotReadback.toLowerCase().trim()

  // Detect instruction type
  const instructionType = detectInstructionType(atcNorm)

  // ==========================================================================
  // CHECK 1: Incomplete readback detection (Roger, Copy, OK only)
  // ==========================================================================
  // Detect improper acknowledgments
  const improperAckWords = /\b(roger|copy|copied|ok|okay|wilco|understood|affirmative|affirm|got\s*it|sure)\b/i
  const hasImproperAck = improperAckWords.test(pilotNorm)

  // Count meaningful words (excluding callsign and filler)
  const cleanedPilot = removeCallsign(pilotNorm)
  const meaningfulWords = cleanedPilot.split(/\s+/).filter(w => w.length > 1 && !improperAckWords.test(w))
  const wordCount = meaningfulWords.length

  // If response is mostly just an acknowledgment word with callsign
  if (hasImproperAck && wordCount < 3 && instructionType !== 'information_only') {
    // Check if any critical elements are present
    const hasCriticalElement = checkForCriticalElements(pilotNorm, instructionType)

    if (!hasCriticalElement) {
      const ackWord = pilotNorm.match(improperAckWords)?.[0] || 'Roger'
      errors.push({
        type: 'incomplete_readback',
        parameter: 'full readback',
        expectedValue: generateExpectedReadback(atcNorm, instructionType, callsign),
        actualValue: ackWord,
        weight: 'high',
        explanation: `"${ackWord}" is inadequate for ${instructionType} instructions. Full readback of all parameters is required.`,
        icaoReference: 'ICAO Doc 4444 Section 12.3.1.2'
      })

      return {
        isCorrect: false,
        quality: 'missing',
        confidence: 0.95,
        errors,
        expectedResponse: generateExpectedReadback(atcNorm, instructionType, callsign),
        actualResponse: pilotReadback,
        corrections: [{
          correctPhrase: generateExpectedReadback(atcNorm, instructionType, callsign),
          whyIncorrect: `"${ackWord}" only means message received - it does NOT confirm understanding of the instruction`,
          icaoStandard: 'ICAO Doc 4444 requires readback of all altitude, heading, speed, and runway instructions'
        }]
      }
    }
  }

  // Extended check: short responses (< 5 meaningful words) with ack words but missing
  // critical elements — catches "roger, climbing" (missing altitude value),
  // "copy, runway two four" (missing "cleared"), etc.
  if (hasImproperAck && wordCount >= 3 && wordCount < 5 && instructionType !== 'information_only' && instructionType !== 'unknown') {
    const hasCriticalElement = checkForCriticalElements(pilotNorm, instructionType)
    if (!hasCriticalElement) {
      const ackWord = pilotNorm.match(improperAckWords)?.[0] || 'Roger'
      errors.push({
        type: 'incomplete_readback',
        parameter: 'full readback',
        expectedValue: generateExpectedReadback(atcNorm, instructionType, callsign),
        actualValue: ackWord,
        weight: 'medium',
        explanation: `Readback appears incomplete for ${instructionType}. Critical elements are missing despite partial acknowledgment.`,
        icaoReference: 'ICAO Doc 4444 Section 12.3.1.2'
      })
      quality = 'partial'
    }
  }

  // ==========================================================================
  // CHECK 2: Parameter confusion detection
  // ==========================================================================
  const paramConfusion = detectParameterConfusion(atcNorm, pilotNorm, instructionType)
  if (paramConfusion) {
    errors.push(paramConfusion)
    return {
      isCorrect: false,
      quality: 'incorrect',
      confidence: 0.9,
      errors,
      expectedResponse: generateExpectedReadback(atcNorm, instructionType, callsign),
      actualResponse: pilotReadback,
      corrections: [{
        correctPhrase: generateExpectedReadback(atcNorm, instructionType, callsign),
        whyIncorrect: `Parameter confusion: ${paramConfusion.explanation}`,
        icaoStandard: 'ICAO Doc 4444 - Each parameter type must be read back correctly'
      }]
    }
  }

  // ==========================================================================
  // CHECK 3: Value comparison based on instruction type
  // ==========================================================================
  const valueError = checkValueMatch(atcNorm, pilotNorm, instructionType)
  if (valueError) {
    errors.push(valueError)
    quality = 'incorrect'
    confidence = 0.95
  }

  // ==========================================================================
  // CHECK 4: Check for required elements
  // ==========================================================================
  const missingElements = checkRequiredElements(atcNorm, pilotNorm, instructionType)
  for (const missing of missingElements) {
    errors.push(missing)
    if (quality === 'complete') quality = 'partial'
  }

  // ==========================================================================
  // CHECK 5: Multi-part instruction check (Departure/Approach specific)
  // This catches missing elements in combined instructions
  // ==========================================================================
  const multiPartErrors = checkMultiPartInstruction(atcInstruction, pilotReadback)
  for (const mpError of multiPartErrors) {
    // Avoid duplicate errors
    const isDuplicate = errors.some(e =>
      e.parameter === mpError.parameter && e.type === mpError.type
    )
    if (!isDuplicate) {
      errors.push(mpError)
      if (quality === 'complete') quality = 'partial'
      // Upgrade weight if this is a critical component
      if (mpError.weight === 'critical' && quality !== 'incorrect') {
        quality = 'partial'
      }
    }
  }

  // ==========================================================================
  // CHECK 6: Structured Command Validation (Conditions, Constraints, Timing)
  // Validates conditional phrases, altitude constraints, and immediate modifiers
  // ==========================================================================
  const structuredCommand = parseStructuredCommand(atcInstruction)
  const commandValidation = validateReadbackAgainstCommand(structuredCommand, pilotReadback)

  // Add condition/constraint/roger-substitution errors
  for (const cmdError of commandValidation.errors) {
    // Avoid duplicates with existing errors
    const isDuplicate = errors.some(e =>
      e.type === cmdError.type && e.parameter === cmdError.parameter
    )
    if (!isDuplicate) {
      errors.push(cmdError)

      // Update quality based on error type
      if (cmdError.type === 'condition_violated' || cmdError.type === 'roger_substitution') {
        quality = 'incorrect'
      } else if (cmdError.type === 'condition_omitted' || cmdError.type === 'constraint_missing') {
        if (quality === 'complete') quality = 'partial'
      }
    }
  }

  // ==========================================================================
  // GENERATE RESULT
  // ==========================================================================

  const isCorrect = errors.length === 0

  return {
    isCorrect,
    quality,
    confidence: isCorrect ? 1.0 : confidence,
    errors,
    expectedResponse: generateExpectedReadback(atcNorm, instructionType, callsign),
    actualResponse: pilotReadback,
    corrections: errors.map(e => ({
      correctPhrase: generateExpectedReadback(atcNorm, instructionType, callsign),
      whyIncorrect: e.explanation,
      icaoStandard: e.icaoReference || 'ICAO Doc 4444'
    }))
  }
}

/**
 * Checks if pilot response has any critical elements for the instruction type
 * Returns true ONLY if the pilot actually read back the required elements
 */
function checkForCriticalElements(pilotText: string, instructionType: InstructionType): boolean {
  // First, clean the text and remove acknowledgment words
  const cleanedText = removeCallsign(pilotText.toLowerCase())
  const withoutAck = cleanedText
    .replace(/\b(roger|copy|copied|ok|okay|wilco|understood|affirmative|affirm|got\s*it|sure)\b/gi, '')
    .trim()

  // If after removing acknowledgment words, there's almost nothing left, it's inadequate
  if (withoutAck.split(/\s+/).filter(w => w.length > 1).length < 2) {
    return false
  }

  const normalized = normalizeToDigits(withoutAck)

  switch (instructionType) {
    case 'altitude_change':
      // Must have altitude-related terms AND actual numbers
      const hasAltTerms = /\b(climb|descend|climbing|descending|maintain|maintaining|thousand|hundred|flight\s*level)\b/i.test(withoutAck)
      const hasAltNumbers = /\d{3,5}/.test(normalized) || /\b(thousand|hundred)\b/i.test(withoutAck)
      return hasAltTerms && hasAltNumbers

    case 'heading_change':
      // Must have heading term AND numbers
      const hasHeadingTerms = /\b(heading|turn|turning)\b/i.test(withoutAck)
      const hasHeadingNumbers = /\d{2,3}/.test(normalized)
      return hasHeadingTerms && hasHeadingNumbers

    case 'speed_change':
      // Must have speed terms AND numbers
      const hasSpeedTerms = /\b(speed|knots?|reduce|increase)\b/i.test(withoutAck)
      const hasSpeedNumbers = /\d{2,3}/.test(normalized)
      return hasSpeedTerms && hasSpeedNumbers

    case 'altimeter_setting':
      // Must have altimeter term AND 4 digits
      const hasAltimTerms = /\b(altimeter|qnh)\b/i.test(withoutAck)
      const hasAltimNumbers = /\d{4}/.test(normalized)
      return hasAltimTerms && hasAltimNumbers

    case 'squawk_code':
      // Must have squawk term AND 4 digits
      const hasSqkTerms = /\b(squawk|transponder)\b/i.test(withoutAck)
      const hasSqkNumbers = /\d{4}/.test(normalized)
      return hasSqkTerms && hasSqkNumbers

    case 'frequency_change':
      // ICAO standard: pilot reads back frequency digits only (no "contact" required).
      // Accept VHF format ddd or ddd.d (e.g. "118", "118.5", "one one eight decimal five").
      const hasFreqNumbers = /\d{3}/.test(normalized)
      return hasFreqNumbers

    case 'takeoff_clearance':
      // Must have "cleared" AND "takeoff/take off" AND a runway number
      return /\bcleared\b/i.test(withoutAck) &&
        /\b(takeoff|take\s*off)\b/i.test(withoutAck) &&
        (/runway/i.test(withoutAck) || /\d{1,2}/.test(normalized))

    case 'landing_clearance':
      // Must have "cleared" AND "land" AND a runway number
      return /\bcleared\b/i.test(withoutAck) &&
        /\b(land|landing)\b/i.test(withoutAck) &&
        (/runway/i.test(withoutAck) || /\d{1,2}/.test(normalized))

    case 'lineup_wait':
      // Must have "line up" AND "wait"
      return /\bline\s*up\b/i.test(withoutAck) && /\bwait\b/i.test(withoutAck)

    default:
      return false
  }
}

/**
 * Detects if pilot confused one parameter type for another
 */
function detectParameterConfusion(
  atcText: string,
  pilotText: string,
  instructionType: InstructionType
): ReadbackError | null {
  const pilotLower = pilotText.toLowerCase()
  const atcLower = atcText.toLowerCase()

  // Case: ATC gave heading, pilot read back as altitude/flight level
  if (instructionType === 'heading_change') {
    const hasAltitudeContext = /\b(flight\s*level|fl\s*\d|climb|descend|climbing|descending|altitude)\b/i.test(pilotLower)
    const atcHasHeading = /\b(heading|turn\s+(left|right)|fly\s+heading)\b/i.test(atcLower)

    // Guard: if ATC instruction ALSO contains altitude/climb content it is a
    // multi-part instruction.  The pilot reading back BOTH heading and altitude
    // is CORRECT, not confusion.  Only flag when ATC was heading-ONLY.
    const atcAlsoHasAltitude = /\b(climb|descend|maintain|flight\s*level|thousand|hundred)\b/i.test(atcLower)
    // Guard: if pilot ALSO reads back heading words it correctly covered both parts.
    const pilotAlsoHasHeading = /\b(heading|left|right)\b/i.test(pilotLower)

    if (hasAltitudeContext && atcHasHeading && !atcAlsoHasAltitude && !pilotAlsoHasHeading) {
      const atcHeading = extractNumericValue(atcText, 'heading')

      return {
        type: 'parameter_confusion',
        parameter: 'heading → altitude',
        expectedValue: `heading ${atcHeading}`,
        actualValue: pilotText,
        weight: 'critical',
        explanation: `Parameter confusion: ATC instructed HEADING ${atcHeading}, but pilot read back as ALTITUDE/FLIGHT LEVEL. This changes the meaning entirely.`,
        icaoReference: 'ICAO Doc 4444 - Section 12.3.1'
      }
    }
  }

  // Case: ATC gave altitude, pilot read back as heading
  if (instructionType === 'altitude_change') {
    // Check if pilot mentioned heading but not altitude terms
    const hasHeadingContext = /\bheading\b/i.test(pilotLower)
    const lacksAltitudeContext = !/\b(climb|descend|maintain|altitude|flight\s*level|thousand|hundred)\b/i.test(pilotLower)

    if (hasHeadingContext && lacksAltitudeContext) {
      const atcAlt = extractNumericValue(atcText, 'altitude')

      return {
        type: 'parameter_confusion',
        parameter: 'altitude → heading',
        expectedValue: `altitude ${atcAlt}`,
        actualValue: pilotText,
        weight: 'critical',
        explanation: `Parameter confusion: ATC instructed ALTITUDE ${atcAlt}, but pilot read back as HEADING.`,
        icaoReference: 'ICAO Doc 4444 - Section 12.3.1'
      }
    }
  }

  // Case: ATC gave speed, pilot read back as altitude
  if (instructionType === 'speed_change') {
    const hasAltitudeContext = /\b(flight\s*level|climb|descend|altitude)\b/i.test(pilotLower)
    const lacksSpeedContext = !/\b(speed|knots)\b/i.test(pilotLower)

    if (hasAltitudeContext && lacksSpeedContext) {
      const atcSpeed = extractNumericValue(atcText, 'speed')

      return {
        type: 'parameter_confusion',
        parameter: 'speed → altitude',
        expectedValue: `${atcSpeed} knots`,
        actualValue: pilotText,
        weight: 'high',
        explanation: `Parameter confusion: ATC instructed SPEED ${atcSpeed} knots, but pilot read back as ALTITUDE.`,
        icaoReference: 'ICAO Doc 4444 - Parameter confusion'
      }
    }

    // Case 15: ATC gave speed, pilot read back as heading
    const hasHeadingContext = /\bheading\b/i.test(pilotLower)
    if (hasHeadingContext && lacksSpeedContext) {
      const atcSpeed = extractNumericValue(atcText, 'speed')

      return {
        type: 'parameter_confusion',
        parameter: 'speed → heading',
        expectedValue: `speed ${atcSpeed} knots`,
        actualValue: pilotText,
        weight: 'critical',
        explanation: `Parameter confusion: ATC instructed SPEED ${atcSpeed} knots, but pilot read back as HEADING. Speed instruction was incorrectly interpreted as a heading change.`,
        icaoReference: 'ICAO Doc 4444 - Section 12.3.1'
      }
    }
  }

  return null
}

/**
 * Extracts spoken number from text (e.g., "one eight zero" -> "180")
 */
function extractSpokenNumber(text: string): string | null {
  const cleanText = removeCallsign(text.toLowerCase())
  const normalized = normalizeToDigits(cleanText)

  // Find sequences of digits
  const digitMatch = normalized.match(/\d{2,4}/)
  return digitMatch ? digitMatch[0] : null
}

/**
 * Enhanced: Check for multi-part instruction completeness
 * Departure/Approach often have combined instructions
 */
function checkMultiPartInstruction(atcText: string, pilotText: string): ReadbackError[] {
  const errors: ReadbackError[] = []
  const atcLower = atcText.toLowerCase()
  const pilotLower = pilotText.toLowerCase()

  // Check for altitude component
  const hasAltitudeInstruction = /\b(climb|descend)\s+(and\s+)?(maintain|to)/i.test(atcLower) ||
                                  /\bmaintain\s+(flight\s+level|\d)/i.test(atcLower)
  const hasAltitudeReadback = /\b(climb|descend|climbing|descending|maintain|maintaining)/i.test(pilotLower) ||
                               /\bflight\s*level/i.test(pilotLower) ||
                               /\bthousand\b/i.test(pilotLower)

  // Check for heading component
  const hasHeadingInstruction = /\bturn\s+(left|right)/i.test(atcLower) ||
                                 /\bheading\s+\d/i.test(atcLower) ||
                                 /\bfly\s+heading/i.test(atcLower)
  const hasHeadingReadback = /\b(left|right)\s*(heading|turn)?/i.test(pilotLower) ||
                              /\bheading\s*\d/i.test(pilotLower)

  // Check for speed component
  const hasSpeedInstruction = /\b(reduce|increase|maintain)\s+speed/i.test(atcLower) ||
                               /\bspeed\s+\d/i.test(atcLower) ||
                               /\d+\s*knots/i.test(atcLower)
  const hasSpeedReadback = /\bspeed\b/i.test(pilotLower) ||
                            /\d+\s*knots/i.test(pilotLower) ||
                            /\b(reduce|increase)\b/i.test(pilotLower)

  // Check for QNH/altimeter component
  const hasAltimeterInstruction = /\b(qnh|altimeter)\s+\d/i.test(atcLower)
  const hasAltimeterReadback = /\b(qnh|altimeter)\b/i.test(pilotLower)

  // Check for squawk component
  const hasSquawkInstruction = /\bsquawk\s+\d/i.test(atcLower)
  const hasSquawkReadback = /\bsquawk\b/i.test(pilotLower)

  // Generate errors for missing components
  if (hasAltitudeInstruction && !hasAltitudeReadback) {
    const atcAlt = extractNumericValue(atcText, 'altitude')
    errors.push({
      type: 'missing_element',
      parameter: 'altitude',
      expectedValue: atcAlt,
      actualValue: null,
      weight: 'critical',
      explanation: 'Missing altitude in multi-part instruction readback. Altitude readback is required per ICAO Doc 4444.',
      icaoReference: 'ICAO Doc 4444 Section 12.3.1.2'
    })
  }

  if (hasHeadingInstruction && !hasHeadingReadback) {
    const atcHdg = extractNumericValue(atcText, 'heading')
    errors.push({
      type: 'missing_element',
      parameter: 'heading',
      expectedValue: atcHdg,
      actualValue: null,
      weight: 'high',
      explanation: 'Missing heading in multi-part instruction readback.',
      icaoReference: 'ICAO Doc 4444'
    })
  }

  if (hasSpeedInstruction && !hasSpeedReadback) {
    const atcSpd = extractNumericValue(atcText, 'speed')
    errors.push({
      type: 'missing_element',
      parameter: 'speed',
      expectedValue: atcSpd ? atcSpd + ' knots' : null,
      actualValue: null,
      weight: 'medium',
      explanation: 'Missing speed in multi-part instruction readback.',
      icaoReference: 'ICAO Doc 4444'
    })
  }

  if (hasAltimeterInstruction && !hasAltimeterReadback) {
    const atcAltim = extractNumericValue(atcText, 'altimeter')
    errors.push({
      type: 'missing_element',
      parameter: 'altimeter/QNH',
      expectedValue: atcAltim,
      actualValue: null,
      weight: 'critical',
      explanation: 'Missing altimeter setting (QNH) readback. This readback is required for approach.',
      icaoReference: 'ICAO Doc 9432'
    })
  }

  if (hasSquawkInstruction && !hasSquawkReadback) {
    const atcSqk = extractNumericValue(atcText, 'squawk')
    errors.push({
      type: 'missing_element',
      parameter: 'squawk',
      expectedValue: atcSqk,
      actualValue: null,
      weight: 'high',
      explanation: 'Missing squawk code readback.',
      icaoReference: 'ICAO Doc 4444'
    })
  }

  // ==========================================================================
  // Case 18: Check for missing constraints in approach clearances
  // ==========================================================================
  const hasConstraint = /\b(until\s+established|until\s+\w+|at\s+or\s+(above|below)|cross\s+\w+\s+at)\b/i.test(atcLower)
  const hasConstraintReadback = /\b(until\s+established|until\s+\w+|at\s+or\s+(above|below)|cross\s+\w+\s+at)\b/i.test(pilotLower)

  if (hasConstraint && !hasConstraintReadback) {
    const constraintMatch = atcLower.match(/\b(maintain\s+\w+\s+until\s+established|until\s+established|at\s+or\s+(above|below)\s+\w+|cross\s+\w+\s+at\s+\w+)/i)
    errors.push({
      type: 'missing_element',
      parameter: 'constraint',
      expectedValue: constraintMatch ? constraintMatch[0] : 'altitude/position constraint',
      actualValue: null,
      weight: 'critical',
      explanation: `Missing constraint in readback. ATC instructed "${constraintMatch?.[0] || 'constraint'}" which must be read back.`,
      icaoReference: 'ICAO Doc 4444 - Conditional clearance constraints must be read back'
    })
  }

  // ==========================================================================
  // Case 17: Check for waypoint/fix name mismatch
  // ==========================================================================
  const atcWaypoints = extractWaypoints(atcText)
  const pilotWaypoints = extractWaypoints(pilotText)

  if (atcWaypoints.length > 0 && pilotWaypoints.length > 0) {
    for (const atcWpt of atcWaypoints) {
      // Check if pilot mentioned a similar but wrong waypoint
      const matchingPilotWpt = pilotWaypoints.find(p => p === atcWpt)
      if (!matchingPilotWpt) {
        // Find if there's a similar-sounding waypoint that pilot used (common mishearing)
        const similarWpt = pilotWaypoints.find(p =>
          (p.length === atcWpt.length && calculateSimilarity(p, atcWpt) > 0.5) ||
          (p.length >= 4 && atcWpt.length >= 4 && (p.startsWith(atcWpt.substring(0, 2)) || p.endsWith(atcWpt.substring(atcWpt.length - 2))))
        )
        if (similarWpt) {
          errors.push({
            type: 'wrong_value',
            parameter: 'waypoint/fix',
            expectedValue: atcWpt,
            actualValue: similarWpt,
            weight: 'critical',
            explanation: `Wrong waypoint/fix name. ATC instructed "${atcWpt}", pilot read back "${similarWpt}". This could lead to navigation to wrong location.`,
            icaoReference: 'ICAO Doc 4444 - Fix names must be read back accurately'
          })
        }
      }
    }
  }

  // ==========================================================================
  // Case 14: Check for missing callsign
  // ==========================================================================
  const atcCallsign = extractCallsignFromText(atcText)
  const pilotCallsign = extractCallsignFromText(pilotText)

  // If ATC addressed a specific callsign but pilot didn't include it
  if (atcCallsign && !pilotCallsign) {
    errors.push({
      type: 'missing_element',
      parameter: 'callsign',
      expectedValue: atcCallsign,
      actualValue: null,
      weight: 'medium',
      explanation: `Missing callsign in readback. Pilot should end with callsign "${atcCallsign}" to confirm which aircraft is responding.`,
      icaoReference: 'ICAO Doc 4444 - Callsign required in readback'
    })
  }

  return errors
}

/**
 * Extract waypoints/fixes from text
 */
function extractWaypoints(text: string): string[] {
  const waypoints: string[] = []

  // Common patterns for waypoints:
  // - 5-letter ICAO waypoints (BOREG, LUBOG, SAMBO, etc.)
  // - VORs (3-letter: MNL, CRK, etc.)
  // - NDBs
  // - "direct WAYPOINT" or "proceed direct WAYPOINT"

  // Extract 5-letter waypoints (uppercase words that are likely waypoints)
  const fiveLetterMatches = text.match(/\b[A-Z]{5}\b/g)
  if (fiveLetterMatches) {
    waypoints.push(...fiveLetterMatches)
  }

  // Extract from "direct [WAYPOINT]" patterns
  const directMatches = text.match(/\bdirect\s+([A-Z]{3,5})\b/gi)
  if (directMatches) {
    for (const match of directMatches) {
      const wpt = match.replace(/direct\s+/i, '').toUpperCase()
      if (!waypoints.includes(wpt)) waypoints.push(wpt)
    }
  }

  // Extract from "to [WAYPOINT]" or "at [WAYPOINT]" patterns
  const toAtMatches = text.match(/\b(?:to|at|via)\s+([A-Z]{3,5})\b/gi)
  if (toAtMatches) {
    for (const match of toAtMatches) {
      const wpt = match.replace(/(?:to|at|via)\s+/i, '').toUpperCase()
      if (!waypoints.includes(wpt)) waypoints.push(wpt)
    }
  }

  return waypoints
}

/**
 * Extract callsign from text
 */
function extractCallsignFromText(text: string): string | null {
  // Common airline codes + flight numbers
  const callsignMatch = text.match(/\b(PAL|CEB|UAE|SIA|APG|GAP|SRQ|AAL|UAL|DAL|SWA|JBU|BAW|DLH|AFR|KLM|QFA|ANA|JAL|CAL|EVA|THA|MAS|SQC|CPA|HKE)\s*\d{1,4}\b/i)
  if (callsignMatch) return callsignMatch[0].toUpperCase()

  // Registration numbers (RPC-XXXX)
  const regMatch = text.match(/\bRP-?C?\d{3,5}\b/i)
  if (regMatch) return regMatch[0].toUpperCase()

  return null
}

/**
 * Checks if the numeric values match between instruction and readback
 */
function checkValueMatch(
  atcText: string,
  pilotText: string,
  instructionType: InstructionType
): ReadbackError | null {
  switch (instructionType) {
    case 'altitude_change': {
      const atcAlt = extractNumericValue(atcText, 'altitude')
      const pilotAlt = extractNumericValue(pilotText, 'altitude')

      if (atcAlt && pilotAlt && atcAlt !== pilotAlt) {
        // Check if it's a transposition
        const atcDigits = atcAlt.replace(/\D/g, '')
        const pilotDigits = pilotAlt.replace(/\D/g, '')
        const isTransposed = isTransposition(atcDigits, pilotDigits)

        // Case 16: Check for altitude magnitude error (1500 vs 15000)
        const atcNum = parseInt(atcDigits, 10)
        const pilotNum = parseInt(pilotDigits, 10)
        const isMagnitudeError = (atcNum * 10 === pilotNum) || (pilotNum * 10 === atcNum) ||
                                  (atcNum * 100 === pilotNum) || (pilotNum * 100 === atcNum)

        let errorExplanation: string
        if (isMagnitudeError) {
          errorExplanation = `Magnitude error: ATC instructed ${formatValueForDisplay(atcAlt, 'altitude')}, pilot read back ${formatValueForDisplay(pilotAlt, 'altitude')}. This is a 10x or 100x altitude error - extremely dangerous!`
        } else if (isTransposed) {
          errorExplanation = `Altitude digit transposition. ATC instructed ${formatValueForDisplay(atcAlt, 'altitude')}, pilot read back ${formatValueForDisplay(pilotAlt, 'altitude')}. Digits appear swapped.`
        } else {
          errorExplanation = `Wrong altitude readback. ATC instructed ${formatValueForDisplay(atcAlt, 'altitude')}, pilot read back ${formatValueForDisplay(pilotAlt, 'altitude')}.`
        }

        return {
          type: isMagnitudeError ? 'wrong_value' : (isTransposed ? 'transposition' : 'wrong_value'),
          parameter: isMagnitudeError ? 'altitude (magnitude)' : 'altitude',
          expectedValue: atcAlt,
          actualValue: pilotAlt,
          weight: 'critical',
          explanation: errorExplanation,
          icaoReference: 'ICAO Doc 4444 Section 12.3.1.2 - Altitude readback mandatory'
        }
      }
      break
    }

    case 'heading_change': {
      const atcHdg = extractNumericValue(atcText, 'heading')
      const pilotHdg = extractNumericValue(pilotText, 'heading')

      if (atcHdg && pilotHdg && atcHdg !== pilotHdg) {
        // Check if it's a transposition
        const isTransposed = isTransposition(atcHdg, pilotHdg)

        return {
          type: isTransposed ? 'transposition' : 'wrong_value',
          parameter: 'heading',
          expectedValue: atcHdg,
          actualValue: pilotHdg,
          weight: isTransposed ? 'critical' : 'high',
          explanation: isTransposed
            ? `Heading digit transposition. ATC instructed heading ${atcHdg}, pilot read back ${pilotHdg}. Digits appear swapped - this is a common and dangerous error.`
            : `Wrong heading readback. ATC instructed heading ${atcHdg}, pilot read back heading ${pilotHdg}.`,
          icaoReference: 'ICAO Doc 4444 Section 12.3.1.2 - Heading readback mandatory'
        }
      }

      // Also check direction - CRITICAL safety check
      const atcDir = /\b(left|right)\b/i.exec(atcText)
      const pilotDir = /\b(left|right)\b/i.exec(pilotText)
      if (atcDir && pilotDir && atcDir[1].toLowerCase() !== pilotDir[1].toLowerCase()) {
        return {
          type: 'wrong_value',
          parameter: 'turn direction',
          expectedValue: atcDir[1],
          actualValue: pilotDir[1],
          weight: 'critical',
          explanation: `Wrong turn direction. ATC instructed turn ${atcDir[1].toUpperCase()}, pilot read back turn ${pilotDir[1].toUpperCase()}. Turn direction errors can cause immediate conflict.`,
          icaoReference: 'ICAO Doc 4444 - Turn direction'
        }
      } else if (atcDir && !pilotDir) {
        // Turn direction was specified by ATC but omitted entirely from readback
        return {
          type: 'missing_element',
          parameter: 'turn direction',
          expectedValue: atcDir[1],
          actualValue: null,
          weight: 'high',
          explanation: `Turn direction "${atcDir[1].toUpperCase()}" was not read back. Omitting turn direction can cause ambiguity in busy airspace.`,
          icaoReference: 'ICAO Doc 4444 §8.3.1'
        }
      }
      break
    }

    case 'speed_change': {
      const atcSpd = extractNumericValue(atcText, 'speed')
      const pilotSpd = extractNumericValue(pilotText, 'speed')

      if (atcSpd && pilotSpd && atcSpd !== pilotSpd) {
        return {
          type: 'wrong_value',
          parameter: 'speed',
          expectedValue: atcSpd + ' knots',
          actualValue: pilotSpd + ' knots',
          weight: 'high',
          explanation: `Wrong speed readback. ATC instructed ${atcSpd} knots, pilot read back ${pilotSpd} knots.`,
          icaoReference: 'ICAO Doc 4444 - Speed readback'
        }
      }
      break
    }

    case 'altimeter_setting': {
      const atcAltim = extractNumericValue(atcText, 'altimeter')
      const pilotAltim = extractNumericValue(pilotText, 'altimeter')

      if (atcAltim && pilotAltim && atcAltim !== pilotAltim) {
        // Check if it's a transposition
        const isTransposition = atcAltim.split('').sort().join('') === pilotAltim.split('').sort().join('')

        return {
          type: isTransposition ? 'transposition' : 'wrong_value',
          parameter: 'altimeter',
          expectedValue: atcAltim,
          actualValue: pilotAltim,
          weight: 'critical',
          explanation: `Wrong altimeter readback (${isTransposition ? 'digit transposition' : 'incorrect value'}). ATC instructed ${atcAltim}, pilot read back ${pilotAltim}. Altimeter readback must be exact.`,
          icaoReference: 'ICAO Doc 4444 - Altimeter setting mandatory readback'
        }
      }
      break
    }

    case 'squawk_code': {
      const atcSqk = extractNumericValue(atcText, 'squawk')
      const pilotSqk = extractNumericValue(pilotText, 'squawk')

      if (atcSqk && pilotSqk && atcSqk !== pilotSqk) {
        return {
          type: 'wrong_value',
          parameter: 'squawk',
          expectedValue: atcSqk,
          actualValue: pilotSqk,
          weight: 'high',
          explanation: `Wrong squawk code. ATC instructed ${atcSqk}, pilot read back ${pilotSqk}.`,
          icaoReference: 'ICAO Doc 4444 - Transponder code readback'
        }
      }
      break
    }

    case 'frequency_change': {
      const atcFreq = extractNumericValue(atcText, 'frequency')
      const pilotFreq = extractNumericValue(pilotText, 'frequency')

      // Truncate pilot frequency to ATC's decimal precision before comparing.
      // Handles case where callsign digits follow the frequency without a pause:
      // ATC "124.4", pilot "124.4 four one one" → extracted as "124.441" → truncate to "124.4".
      const freqMatch = (f: string) => {
        if (!atcFreq || !pilotFreq || atcFreq === pilotFreq) return true
        const atcDec = atcFreq.split('.')[1] ?? ''
        const pilotTruncated = `${pilotFreq.split('.')[0]}.${(pilotFreq.split('.')[1] ?? '').slice(0, atcDec.length)}`
        return atcFreq === pilotTruncated
      }
      if (atcFreq && pilotFreq && atcFreq !== pilotFreq && !freqMatch(pilotFreq)) {
        return {
          type: 'wrong_value',
          parameter: 'frequency',
          expectedValue: atcFreq,
          actualValue: pilotFreq,
          weight: 'high',
          explanation: `Wrong frequency. ATC instructed ${atcFreq}, pilot read back ${pilotFreq}.`,
          icaoReference: 'ICAO Doc 4444 - Frequency readback mandatory'
        }
      }
      break
    }

    case 'approach_clearance': {
      // Check approach type
      const atcApproachMatch = atcText.match(/cleared\s+(ils|rnav|vor|visual|ndb|rnp)\s+approach/i)
      const pilotApproachMatch = pilotText.match(/(ils|rnav|vor|visual|ndb|rnp)/i)

      if (atcApproachMatch && pilotApproachMatch) {
        const atcApproach = atcApproachMatch[1].toLowerCase()
        const pilotApproach = pilotApproachMatch[1].toLowerCase()
        if (atcApproach !== pilotApproach) {
          return {
            type: 'wrong_value',
            parameter: 'approach type',
            expectedValue: atcApproach.toUpperCase(),
            actualValue: pilotApproach.toUpperCase(),
            weight: 'critical',
            explanation: `Wrong approach type. ATC cleared ${atcApproach.toUpperCase()} approach, pilot read back ${pilotApproach.toUpperCase()}.`,
            icaoReference: 'ICAO Doc 4444 - Approach clearance readback'
          }
        }
      }

      // Check runway — normalize designator forms before comparing:
      // "24 left" → "24L", "24 right" → "24R", "24 center/centre" → "24C"
      // so that mixed forms (ATC long-hand vs pilot short-hand) are not falsely flagged.
      const normalizeRunwayDesignator = (s: string): string =>
        s.toUpperCase()
          .replace(/\bLEFT\b/g, 'L').replace(/\bRIGHT\b/g, 'R')
          .replace(/\bCENTER\b|\bCENTRE\b/g, 'C')
          .replace(/\s+/g, '')

      // Capture runway even when designator is a separate word ("24 left" → group "24")
      const atcRunwayMatch = atcText.match(/runway\s*(\d{1,2}(?:\s*(?:left|right|center|centre|[LRC]))?)/i)
      const pilotRunwayMatch = pilotText.match(/runway\s*(\d{1,2}(?:\s*(?:left|right|center|centre|[LRC]))?)/i)

      if (atcRunwayMatch && pilotRunwayMatch) {
        const atcRunway  = normalizeRunwayDesignator(atcRunwayMatch[1])
        const pilotRunway = normalizeRunwayDesignator(pilotRunwayMatch[1])
        if (atcRunway !== pilotRunway) {
          return {
            type: 'wrong_value',
            parameter: 'runway',
            expectedValue: atcRunway,
            actualValue: pilotRunway,
            weight: 'critical',
            explanation: `Wrong runway. ATC cleared for runway ${atcRunway}, pilot read back runway ${pilotRunway}. Runway confusion is a significant readback error.`,
            icaoReference: 'ICAO Doc 4444 - Runway mandatory readback'
          }
        }
      } else if (atcRunwayMatch && !pilotRunwayMatch) {
        return {
          type: 'missing_element',
          parameter: 'runway',
          expectedValue: atcRunwayMatch[1],
          actualValue: null,
          weight: 'critical',
          explanation: 'Missing runway in approach clearance readback. Runway must always be confirmed.',
          icaoReference: 'ICAO Doc 4444 - Runway mandatory readback'
        }
      }

      // Check for crossing/altitude restrictions in STAR
      const atcCrossingMatch = atcText.match(/cross\s+(\w+)\s+at\s+(flight\s+level\s+)?(\d+)/i)
      if (atcCrossingMatch) {
        const waypoint = atcCrossingMatch[1]
        const altitude = atcCrossingMatch[3]
        const pilotHasCrossing = pilotText.toLowerCase().includes(waypoint.toLowerCase()) &&
                                  pilotText.includes(altitude)
        if (!pilotHasCrossing) {
          return {
            type: 'missing_element',
            parameter: 'crossing restriction',
            expectedValue: `${waypoint} at ${altitude}`,
            actualValue: null,
            weight: 'high',
            explanation: `Missing crossing restriction in readback. Must confirm cross ${waypoint} at ${altitude}.`,
            icaoReference: 'ICAO Doc 4444 - Altitude restrictions mandatory'
          }
        }
      }
      break
    }

    case 'takeoff_clearance':
    case 'landing_clearance':
    case 'lineup_wait':
    case 'taxi_instruction': {
      // Runway comparison for takeoff/landing/lineup/taxi instructions
      const normalizeRunway = (s: string): string =>
        s.toUpperCase()
          .replace(/\bLEFT\b/g, 'L').replace(/\bRIGHT\b/g, 'R')
          .replace(/\bCENTER\b|\bCENTRE\b/g, 'C')
          .replace(/\s+/g, '')

      const atcRwy = atcText.match(/runway\s*(\d{1,2}(?:\s*(?:left|right|center|centre|[LRC]))?)/i)
      const pilotRwy = pilotText.match(/runway\s*(\d{1,2}(?:\s*(?:left|right|center|centre|[LRC]))?)/i)

      if (atcRwy && pilotRwy) {
        const atcRwyNorm = normalizeRunway(atcRwy[1])
        const pilotRwyNorm = normalizeRunway(pilotRwy[1])
        if (atcRwyNorm !== pilotRwyNorm) {
          return {
            type: 'wrong_runway',
            parameter: 'runway',
            expectedValue: atcRwyNorm,
            actualValue: pilotRwyNorm,
            weight: 'critical',
            explanation: `Wrong runway readback. ATC instructed runway ${atcRwyNorm}, pilot read back runway ${pilotRwyNorm}. Runway confusion is a critical safety threat.`,
            icaoReference: 'ICAO Doc 4444 12.3.1.3 - Runway mandatory readback'
          }
        }
      }
      break
    }
  }

  return null
}

/**
 * Formats a value for display in error messages
 */
function formatValueForDisplay(value: string, type: string): string {
  if (type === 'altitude') {
    if (value.startsWith('FL')) return `Flight Level ${value.substring(2)}`
    const num = parseInt(value)
    if (num >= 1000) return `${num.toLocaleString()} feet`
    return `${value} feet`
  }
  return value
}

/**
 * Checks for missing required elements in the readback
 */
function checkRequiredElements(
  atcText: string,
  pilotText: string,
  instructionType: InstructionType
): ReadbackError[] {
  const errors: ReadbackError[] = []

  // Find the instruction pattern for this type
  const pattern = INSTRUCTION_PATTERNS.find(p => p.type === instructionType)
  if (!pattern) return errors

  // Check each required element
  for (const element of pattern.requiredReadbackElements) {
    switch (element) {
      case 'action':
        if (/\b(climb|descend)\b/i.test(atcText) && !/\b(climb|descend|climbing|descending)\b/i.test(pilotText)) {
          errors.push({
            type: 'missing_element',
            parameter: 'climb/descend action',
            expectedValue: atcText.match(/\b(climb|descend)\b/i)?.[0] || 'action',
            actualValue: null,
            weight: 'medium',
            explanation: 'Missing climb/descend action verb in readback.'
          })
        }
        break

      case 'direction':
        // Turn direction (left/right) omission and wrong-direction are already handled
        // by checkValueMatch() which is called before checkRequiredElements(). Keeping
        // the check here would push a duplicate error for the same parameter.
        break
    }
  }

  // ==========================================
  // ENHANCED: Check critical elements by type
  // ==========================================

  // Altitude check - critical for departure/approach
  const atcAltitude = extractNumericValue(atcText, 'altitude')
  if (atcAltitude) {
    const pilotAltitude = extractNumericValue(pilotText, 'altitude')
    if (!pilotAltitude && !/\b(thousand|hundred|level|FL)\b/i.test(pilotText)) {
      errors.push({
        type: 'missing_element',
        parameter: 'altitude',
        expectedValue: atcAltitude,
        actualValue: null,
        weight: 'critical',
        explanation: 'Altitude must be read back. Missing altitude in readback.',
        icaoReference: 'ICAO Doc 4444 12.3.1.2'
      })
    }
  }

  // Runway check - critical for takeoff/landing
  // Pilot must say "runway XX" or at minimum include the runway number with a designator
  // (L/R/C). A bare digit like "27" is NOT sufficient — it could be anything.
  if (/runway\s+(\d{1,2})\s*(left|right|center|L|R|C)?/i.test(atcText)) {
    if (!/runway\s*\d{1,2}|\b\d{1,2}\s*[LRC]\b/i.test(pilotText)) {
      const runway = atcText.match(/runway\s+(\d{1,2}\s*(left|right|center|L|R|C)?)/i)?.[1]
      errors.push({
        type: 'missing_element',
        parameter: 'runway',
        expectedValue: runway || 'runway',
        actualValue: null,
        weight: 'critical',
        explanation: 'Runway number must always be read back.',
        icaoReference: 'ICAO Doc 4444 12.3.1.3'
      })
    }
  }

  // Heading check
  const atcHeading = extractNumericValue(atcText, 'heading')
  if (atcHeading) {
    const pilotHeading = extractNumericValue(pilotText, 'heading')
    if (!pilotHeading && !/heading/i.test(pilotText)) {
      errors.push({
        type: 'missing_element',
        parameter: 'heading',
        expectedValue: atcHeading,
        actualValue: null,
        weight: 'high',
        explanation: 'Heading value must be read back.',
        icaoReference: 'ICAO Doc 4444 12.3.1.2'
      })
    }
  }

  // Squawk code check
  if (/squawk\s+(\d{4})/i.test(atcText)) {
    if (!/squawk|\d{4}/i.test(pilotText)) {
      const squawk = atcText.match(/squawk\s+(\d{4})/i)?.[1]
      errors.push({
        type: 'missing_element',
        parameter: 'squawk code',
        expectedValue: squawk || 'squawk',
        actualValue: null,
        weight: 'high',
        explanation: 'Squawk code must be read back.'
      })
    }
  }

  // Expedite check
  if (/expedite/i.test(atcText) && !/expedite/i.test(pilotText)) {
    errors.push({
      type: 'missing_element',
      parameter: 'expedite',
      expectedValue: 'expedite',
      actualValue: null,
      weight: 'high',
      explanation: 'Expedite instruction must be read back to confirm urgency.'
    })
  }

  // Runway heading check
  if (/runway\s+heading/i.test(atcText) && !/runway\s*heading/i.test(pilotText)) {
    errors.push({
      type: 'missing_element',
      parameter: 'runway heading',
      expectedValue: 'runway heading',
      actualValue: null,
      weight: 'critical',
      explanation: 'Runway heading instruction must be read back.'
    })
  }

  // Approach type check (ILS, RNAV, VOR, visual)
  const approachMatch = atcText.match(/\b(ils|rnav|vor|visual|ndb)\s+approach/i)
  if (approachMatch) {
    const approachType = approachMatch[1]
    if (!new RegExp(approachType, 'i').test(pilotText)) {
      errors.push({
        type: 'missing_element',
        parameter: 'approach type',
        expectedValue: approachMatch[0],
        actualValue: null,
        weight: 'critical',
        explanation: `Approach type "${approachType.toUpperCase()}" must be read back.`,
        icaoReference: 'ICAO Doc 4444 12.3.1.2'
      })
    }
  }

  // Frequency check — handles both digit format (118 decimal 5) and spoken numbers
  // (one one nine decimal one)
  const spokenNumberWord = '(?:one|two|three|four|five|six|seven|eight|nine|niner|zero)'
  const hasDigitFreq = /\d{3}\s*(decimal|point)\s*\d/i.test(atcText)
  const hasSpokenFreq = new RegExp(
    `${spokenNumberWord}\\s+${spokenNumberWord}\\s+${spokenNumberWord}\\s+(decimal|point)\\s+${spokenNumberWord}`,
    'i'
  ).test(atcText)

  if (hasDigitFreq || hasSpokenFreq) {
    const pilotHasDigitFreq = /\d{3}\s*(decimal|point|\.)\s*\d/i.test(pilotText)
    const pilotHasSpokenFreq = new RegExp(
      `${spokenNumberWord}\\s+${spokenNumberWord}\\s+${spokenNumberWord}\\s+(decimal|point)\\s+${spokenNumberWord}`,
      'i'
    ).test(pilotText)

    if (!pilotHasDigitFreq && !pilotHasSpokenFreq) {
      const freq = atcText.match(/(\d{3}\s*(decimal|point)\s*\d+)/i)?.[1] ||
        atcText.match(new RegExp(
          `(${spokenNumberWord}\\s+${spokenNumberWord}\\s+${spokenNumberWord}\\s+(decimal|point)\\s+${spokenNumberWord}(?:\\s+${spokenNumberWord})*)`,
          'i'
        ))?.[1]
      errors.push({
        type: 'missing_element',
        parameter: 'frequency',
        expectedValue: freq || 'frequency',
        actualValue: null,
        weight: 'high',
        explanation: 'Frequency must be read back before changing.'
      })
    }
  }

  // Conditional check (after passing, when able, etc.)
  if (/\b(after|when)\s+(passing|reaching|able|ready)/i.test(atcText)) {
    if (!/\b(after|when)\b/i.test(pilotText)) {
      errors.push({
        type: 'missing_element',
        parameter: 'conditional phrase',
        expectedValue: 'conditional instruction',
        actualValue: null,
        weight: 'high',
        explanation: 'Conditional clearances must include the condition in readback.'
      })
    }
  }

  // Cleared takeoff check
  if (/cleared\s+(for\s+)?take\s*off/i.test(atcText)) {
    if (!/cleared\s+(for\s+)?take\s*off/i.test(pilotText)) {
      errors.push({
        type: 'missing_element',
        parameter: 'takeoff clearance',
        expectedValue: 'cleared for takeoff',
        actualValue: null,
        weight: 'critical',
        explanation: 'Takeoff clearance must be explicitly read back.',
        icaoReference: 'ICAO Doc 4444 12.3.1.3'
      })
    }
  }

  // Cleared to land check
  if (/cleared\s+to\s+land/i.test(atcText)) {
    if (!/cleared\s+to\s+land/i.test(pilotText)) {
      errors.push({
        type: 'missing_element',
        parameter: 'landing clearance',
        expectedValue: 'cleared to land',
        actualValue: null,
        weight: 'critical',
        explanation: 'Landing clearance must be explicitly read back.',
        icaoReference: 'ICAO Doc 4444 12.3.1.3'
      })
    }
  }

  // Waypoint/fix check
  const waypointMatch = atcText.match(/\b(BOREG|MANOG|LANAS|TONDO|LUBOG|RENAS|CULIS|direct\s+\w+|after\s+\w+|cross\s+\w+)\b/i)
  if (waypointMatch) {
    const waypoint = waypointMatch[1]
    if (!new RegExp(waypoint.replace(/\s+/g, '\\s*'), 'i').test(pilotText)) {
      errors.push({
        type: 'missing_element',
        parameter: 'waypoint/fix',
        expectedValue: waypoint,
        actualValue: null,
        weight: 'high',
        explanation: `Waypoint "${waypoint}" must be read back.`
      })
    }
  }

  return errors
}

/**
 * Generates the expected correct readback for an instruction
 */
export function generateExpectedReadback(
  atcInstruction: string,
  instructionType: InstructionType,
  callsign?: string
): string {
  const cs = callsign || '{callsign}'

  switch (instructionType) {
    case 'altitude_change': {
      const alt = extractNumericValue(atcInstruction, 'altitude')
      const action = /\b(climb|descend)\b/i.exec(atcInstruction)?.[0].toLowerCase()
      if (action && alt) {
        return `${action} and maintain ${formatAltitude(alt)}, ${cs}`
      }
      return `maintain ${alt || 'altitude'}, ${cs}`
    }

    case 'heading_change': {
      const hdg = extractNumericValue(atcInstruction, 'heading')
      const dir = /\b(left|right)\b/i.exec(atcInstruction)?.[0].toLowerCase()
      const hdgPhonetic = hdg ? numberToPhonetic(hdg.padStart(3, '0')) : 'value'
      if (dir && hdg) {
        return `${dir} heading ${hdgPhonetic}, ${cs}`
      }
      return `heading ${hdgPhonetic}, ${cs}`
    }

    case 'speed_change': {
      const spd = extractNumericValue(atcInstruction, 'speed')
      const spdPhonetic = spd ? numberToPhonetic(spd) : 'value'
      const action = /\b(reduce|increase)\b/i.exec(atcInstruction)?.[0].toLowerCase()
      if (action) {
        return `${action} speed ${spdPhonetic} knots, ${cs}`
      }
      return `speed ${spdPhonetic} knots, ${cs}`
    }

    case 'altimeter_setting': {
      const altim = extractNumericValue(atcInstruction, 'altimeter')
      const altimPhonetic = altim ? numberToPhonetic(altim) : 'value'
      return `altimeter ${altimPhonetic}, ${cs}`
    }

    case 'squawk_code': {
      const sqk = extractNumericValue(atcInstruction, 'squawk')
      const sqkPhonetic = sqk ? numberToPhonetic(sqk) : 'value'
      return `squawk ${sqkPhonetic}, ${cs}`
    }

    case 'frequency_change': {
      const freq = extractNumericValue(atcInstruction, 'frequency')
      const freqPhonetic = freq ? formatFrequencyPhonetic(freq) : 'frequency'
      const facility = atcInstruction.match(/contact\s+(\w+\s*\w*)/i)?.[1] || 'facility'
      return `${facility} ${freqPhonetic}, ${cs}`
    }

    case 'approach_clearance': {
      const approach = atcInstruction.match(/cleared\s+(ils|rnav|vor|visual|ndb)\s+approach/i)?.[1]
      const rwy = atcInstruction.match(/runway\s*(\d{1,2}[LRC]?)/i)?.[1]
      const rwyPhonetic = formatRunwayPhonetic(rwy || '')
      return `cleared ${approach} approach runway ${rwyPhonetic}, ${cs}`
    }

    case 'takeoff_clearance': {
      const rwy = atcInstruction.match(/runway\s*(\d{1,2}[LRC]?)/i)?.[1]
      const rwyPhonetic = formatRunwayPhonetic(rwy || '')
      return `runway ${rwyPhonetic} cleared for takeoff, ${cs}`
    }

    case 'landing_clearance': {
      const rwy = atcInstruction.match(/runway\s*(\d{1,2}[LRC]?)/i)?.[1]
      const rwyPhonetic = formatRunwayPhonetic(rwy || '')
      return `cleared to land runway ${rwyPhonetic}, ${cs}`
    }

    case 'lineup_wait': {
      const rwy = atcInstruction.match(/runway\s*(\d{1,2}[LRC]?)/i)?.[1]
      const rwyPhonetic = formatRunwayPhonetic(rwy || '')
      return `line up and wait runway ${rwyPhonetic}, ${cs}`
    }

    case 'direct_to': {
      const wpt = atcInstruction.match(/direct\s+(to\s+)?(\w+)/i)?.[2]
      return `direct ${wpt}, ${cs}`
    }

    default:
      return `{full readback of: ${atcInstruction}}, ${cs}`
  }
}

/**
 * Converts a digit to ICAO phonetic number
 */
function digitToPhonetic(digit: string): string {
  const phoneticNumbers: Record<string, string> = {
    '0': 'zero',
    '1': 'one',
    '2': 'two',
    '3': 'tree',  // ICAO uses "tree" for 3
    '4': 'fower', // ICAO uses "fower" for 4
    '5': 'fife',  // ICAO uses "fife" for 5
    '6': 'six',
    '7': 'seven',
    '8': 'eight',
    '9': 'niner', // ICAO uses "niner" for 9
  }
  return phoneticNumbers[digit] || digit
}

/**
 * Converts a number string to ICAO phonetic format
 * e.g., "350" -> "tree fife zero", "090" -> "zero niner zero"
 */
function numberToPhonetic(num: string): string {
  return num.split('').map(digitToPhonetic).join(' ')
}

/**
 * Formats frequency in ICAO phonetic format
 * e.g., "121.5" -> "one two one decimal fife"
 */
function formatFrequencyPhonetic(freq: string): string {
  const parts = freq.split('.')
  const wholePart = numberToPhonetic(parts[0])
  if (parts.length > 1 && parts[1]) {
    const decimalPart = numberToPhonetic(parts[1])
    return `${wholePart} decimal ${decimalPart}`
  }
  return wholePart
}

/**
 * Formats runway number in ICAO phonetic format
 * e.g., "27L" -> "two seven left", "09" -> "zero niner"
 */
function formatRunwayPhonetic(rwy: string): string {
  if (!rwy) return 'runway'

  // Extract number and designator (L/R/C)
  const match = rwy.match(/(\d+)([LRC])?/i)
  if (!match) return rwy

  const num = match[1].padStart(2, '0')
  const designator = match[2]?.toUpperCase()

  const numPhonetic = numberToPhonetic(num)

  if (designator) {
    const designatorWord = designator === 'L' ? 'left' : designator === 'R' ? 'right' : 'center'
    return `${numPhonetic} ${designatorWord}`
  }

  return numPhonetic
}

/**
 * Formats altitude value for display using ICAO phonetic numbers
 */
function formatAltitude(alt: string): string {
  // Flight level: "FL350" -> "flight level tree fife zero"
  if (alt.startsWith('FL')) {
    const flNum = alt.substring(2)
    return `flight level ${numberToPhonetic(flNum)}`
  }

  // Regular altitude in feet
  const num = parseInt(alt)
  if (num >= 1000) {
    const thousands = Math.floor(num / 1000)
    const hundreds = (num % 1000) / 100
    if (hundreds > 0) {
      return `${digitToPhonetic(thousands.toString())} thousand ${digitToPhonetic(hundreds.toString())} hundred`
    }
    return `${digitToPhonetic(thousands.toString())} thousand`
  }

  // For smaller numbers, use phonetic digits
  return numberToPhonetic(alt)
}

// ============================================================================
// BATCH ANALYSIS FOR CORPUS
// ============================================================================

export interface CorpusAnalysisResult {
  totalExchanges: number
  correctReadbacks: number
  incorrectReadbacks: number
  missingReadbacks: number
  partialReadbacks: number
  errorBreakdown: Record<ErrorType, number>
  mostCommonErrors: { error: string; count: number }[]
  overallAccuracy: number
}

/**
 * Analyzes an entire corpus of ATC-pilot exchanges
 */
export function analyzeCorpus(
  exchanges: { atc: string; pilot: string }[]
): CorpusAnalysisResult {
  const errorCounts: Record<ErrorType, number> = {
    // Core readback errors
    'wrong_value': 0,
    'missing_element': 0,
    'incomplete_readback': 0,
    'parameter_confusion': 0,
    'transposition': 0,
    'hearback_error': 0,
    'extra_element': 0,
    // Conditional/constraint errors
    'condition_omitted': 0,
    'condition_violated': 0,
    'constraint_missing': 0,
    'roger_substitution': 0,
    // Direction and callsign errors
    'wrong_direction': 0,
    'missing_callsign': 0,
    // Runway safety errors
    'critical_confusion': 0,
    'wrong_runway': 0,
    'missing_designator': 0,
    // Non-native speaker patterns
    'non_native_pronunciation': 0,
    'non_native_grammar': 0,
    'non_native_word_order': 0,
    'non_native_stress': 0,
  }

  let correct = 0
  let incorrect = 0
  let missing = 0
  let partial = 0
  const errorMessages: Map<string, number> = new Map()

  for (const exchange of exchanges) {
    const result = analyzeReadback(exchange.atc, exchange.pilot)

    switch (result.quality) {
      case 'complete': correct++; break
      case 'incorrect': incorrect++; break
      case 'missing': missing++; break
      case 'partial': partial++; break
    }

    for (const error of result.errors) {
      errorCounts[error.type]++
      const msg = error.explanation
      errorMessages.set(msg, (errorMessages.get(msg) || 0) + 1)
    }
  }

  const total = exchanges.length

  return {
    totalExchanges: total,
    correctReadbacks: correct,
    incorrectReadbacks: incorrect,
    missingReadbacks: missing,
    partialReadbacks: partial,
    errorBreakdown: errorCounts,
    mostCommonErrors: Array.from(errorMessages.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([error, count]) => ({ error, count })),
    overallAccuracy: total > 0 ? (correct / total) * 100 : 0
  }
}

// ============================================================================
// EXPORT TRAINING DATA FOR ML MODELS
// ============================================================================

/**
 * Exports training data in format suitable for Hugging Face transformers
 */
export function exportForHuggingFace(): {
  instruction: string
  correct_response: string
  label: 'correct' | 'incorrect'
  error_type?: string
}[] {
  const data: ReturnType<typeof exportForHuggingFace> = []

  for (const example of ATC_TRAINING_DATA) {
    // Add correct example
    data.push({
      instruction: example.instruction,
      correct_response: example.correctReadback,
      label: 'correct'
    })

    // Add error examples
    for (const error of example.commonErrors) {
      data.push({
        instruction: example.instruction,
        correct_response: error.error,
        label: 'incorrect',
        error_type: error.type
      })
    }
  }

  return data
}

// ============================================================================
// ENHANCED DEPARTURE/APPROACH PATTERNS (v2.0)
// ============================================================================

/**
 * Advanced training data specifically for departure phase
 */
export const DEPARTURE_PHASE_TRAINING: typeof ATC_TRAINING_DATA = [
  // Radar Contact + Climb
  {
    instruction: "radar contact climb and maintain flight level two four zero",
    correctReadback: "radar contact climb and maintain flight level two four zero, {callsign}",
    instructionType: 'altitude_change',
    requiredElements: ['radar contact', 'altitude', 'callsign'],
    commonErrors: [
      { error: "Climbing two four zero", type: 'incomplete_readback' },
      { error: "Roger", type: 'incomplete_readback' },
    ]
  },
  // SID with Runway and Squawk
  {
    instruction: "cleared BOREG one alpha departure runway two four climb and maintain five thousand squawk two three four one",
    correctReadback: "cleared BOREG one alpha departure runway two four climb five thousand squawk two three four one, {callsign}",
    instructionType: 'altitude_change',
    requiredElements: ['sid', 'runway', 'altitude', 'squawk', 'callsign'],
    commonErrors: [
      { error: "BOREG departure", type: 'missing_element' },
      { error: "Cleared BOREG one alpha climb five thousand", type: 'missing_element' },
    ]
  },
  // Runway Heading
  {
    instruction: "maintain runway heading",
    correctReadback: "maintain runway heading, {callsign}",
    instructionType: 'heading_change',
    requiredElements: ['runway heading', 'callsign'],
    commonErrors: [
      { error: "Roger", type: 'incomplete_readback' },
    ]
  },
  // Expedite
  {
    instruction: "expedite climb through flight level one eight zero traffic above",
    correctReadback: "expedite climb through flight level one eight zero, {callsign}",
    instructionType: 'altitude_change',
    requiredElements: ['expedite', 'altitude', 'callsign'],
    commonErrors: [
      { error: "Climb one eight zero", type: 'missing_element' },
    ]
  },
  // After Passing Waypoint
  {
    instruction: "after passing LUBOG climb flight level two eight zero",
    correctReadback: "after passing LUBOG climb flight level two eight zero, {callsign}",
    instructionType: 'altitude_change',
    requiredElements: ['condition', 'waypoint', 'altitude', 'callsign'],
    commonErrors: [
      { error: "Climb two eight zero", type: 'missing_element' },
    ]
  },
  // Noise Abatement
  {
    instruction: "noise abatement departure maintain runway heading until passing three thousand",
    correctReadback: "noise abatement departure runway heading until three thousand, {callsign}",
    instructionType: 'heading_change',
    requiredElements: ['noise abatement', 'runway heading', 'altitude restriction', 'callsign'],
    commonErrors: [
      { error: "Runway heading until three thousand", type: 'missing_element' },
    ]
  },
]

/**
 * Advanced training data specifically for approach phase
 */
export const APPROACH_PHASE_TRAINING: typeof ATC_TRAINING_DATA = [
  // STAR with Crossing Restriction
  {
    instruction: "descend via TONDO one alpha arrival cross LANAS at flight level one two zero",
    correctReadback: "descend via TONDO one alpha arrival cross LANAS at flight level one two zero, {callsign}",
    instructionType: 'approach_clearance',
    requiredElements: ['star', 'crossing', 'waypoint', 'altitude', 'callsign'],
    commonErrors: [
      { error: "Descend via TONDO arrival", type: 'missing_element' },
      { error: "TONDO arrival", type: 'incomplete_readback' },
    ]
  },
  // Intercept Localizer
  {
    instruction: "fly heading zero three zero intercept the localizer runway two four cleared ILS approach",
    correctReadback: "heading zero three zero intercept localizer cleared ILS approach runway two four, {callsign}",
    instructionType: 'approach_clearance',
    requiredElements: ['heading', 'intercept', 'approach', 'runway', 'callsign'],
    commonErrors: [
      { error: "Heading zero three zero cleared ILS", type: 'missing_element' },
    ]
  },
  // QNH on Approach
  {
    instruction: "descend to three thousand feet QNH one zero one three",
    correctReadback: "descend three thousand feet QNH one zero one three, {callsign}",
    instructionType: 'altitude_change',
    requiredElements: ['altitude', 'qnh', 'callsign'],
    commonErrors: [
      { error: "Descend three thousand", type: 'missing_element' },
      { error: "Three thousand QNH one zero three one", type: 'transposition' },
    ]
  },
  // Go Around Full
  {
    instruction: "go around climb and maintain three thousand turn right heading zero nine zero",
    correctReadback: "going around climb three thousand right heading zero nine zero, {callsign}",
    instructionType: 'altitude_change',
    requiredElements: ['go around', 'altitude', 'direction', 'heading', 'callsign'],
    commonErrors: [
      { error: "Going around", type: 'missing_element' },
      { error: "Go around climb three thousand", type: 'missing_element' },
    ]
  },
  // Missed Approach Procedure
  {
    instruction: "execute missed approach climb runway heading to four thousand contact approach one one nine decimal one",
    correctReadback: "missed approach runway heading climb four thousand approach one one nine decimal one, {callsign}",
    instructionType: 'altitude_change',
    requiredElements: ['missed approach', 'heading', 'altitude', 'frequency', 'callsign'],
    commonErrors: [
      { error: "Missed approach", type: 'incomplete_readback' },
    ]
  },
  // Visual Approach with Traffic
  {
    instruction: "cleared visual approach runway two four follow the company traffic on three mile final",
    correctReadback: "cleared visual approach runway two four traffic in sight, {callsign}",
    instructionType: 'approach_clearance',
    requiredElements: ['visual approach', 'runway', 'traffic', 'callsign'],
    commonErrors: [
      { error: "Cleared visual two four", type: 'missing_element' },
    ]
  },
  // Circling Approach
  {
    instruction: "cleared circling approach runway zero six circle to land runway two four minimum altitude one thousand five hundred",
    correctReadback: "cleared circling approach runway zero six circle to land runway two four minimum one thousand five hundred, {callsign}",
    instructionType: 'approach_clearance',
    requiredElements: ['circling', 'initial runway', 'landing runway', 'minimum', 'callsign'],
    commonErrors: [
      { error: "Cleared circling runway zero six", type: 'missing_element' },
    ]
  },
  // Speed and Descent Combined
  {
    instruction: "reduce speed one eight zero knots descend and maintain three thousand",
    correctReadback: "speed one eight zero knots descend and maintain three thousand, {callsign}",
    instructionType: 'speed_change',
    requiredElements: ['speed', 'altitude', 'callsign'],
    commonErrors: [
      { error: "Descend three thousand", type: 'missing_element' },
      { error: "Speed one eight zero", type: 'missing_element' },
    ]
  },
]

/**
 * Enhanced analysis with departure/approach context
 */
export function analyzeWithPhaseContext(
  atcInstruction: string,
  pilotReadback: string,
  callsign?: string,
  phase?: 'departure' | 'approach' | 'enroute'
): SemanticAnalysisResult & { phaseSpecificIssues: string[] } {
  const baseResult = analyzeReadback(atcInstruction, pilotReadback, callsign)
  const phaseSpecificIssues: string[] = []

  // Detect phase if not provided
  const detectedPhase = phase || detectCommunicationPhase(atcInstruction)

  if (detectedPhase === 'departure') {
    // Check departure-specific issues
    if (/radar\s+contact/i.test(atcInstruction) && !/radar\s*contact/i.test(pilotReadback)) {
      phaseSpecificIssues.push('Radar contact acknowledgment missing - should confirm radar contact')
    }
    if (/runway\s+heading/i.test(atcInstruction) && !/runway\s*heading/i.test(pilotReadback)) {
      phaseSpecificIssues.push('Runway heading not confirmed - required for initial departure')
    }
    if (/expedite/i.test(atcInstruction) && !/expedite/i.test(pilotReadback)) {
      phaseSpecificIssues.push('Expedite instruction not acknowledged - traffic separation concern')
    }
    if (/after\s+passing|when\s+ready/i.test(atcInstruction)) {
      const hasCondition = /after|when/i.test(pilotReadback)
      if (!hasCondition) {
        phaseSpecificIssues.push('Conditional phrase missing - may execute clearance prematurely')
      }
    }
  }

  if (detectedPhase === 'approach') {
    // Check approach-specific issues
    if (/qnh|altimeter/i.test(atcInstruction) && !/qnh|altimeter/i.test(pilotReadback)) {
      phaseSpecificIssues.push('QNH/Altimeter not confirmed - required for approach accuracy')
    }
    if (/cross\s+\w+\s+at/i.test(atcInstruction)) {
      const crossingMatch = atcInstruction.match(/cross\s+(\w+)\s+at/i)
      if (crossingMatch && !pilotReadback.toLowerCase().includes(crossingMatch[1].toLowerCase())) {
        phaseSpecificIssues.push(`Crossing restriction at ${crossingMatch[1]} not confirmed`)
      }
    }
    if (/go\s*around|missed\s+approach/i.test(atcInstruction)) {
      if (!/going\s*around|missed\s*approach/i.test(pilotReadback)) {
        phaseSpecificIssues.push('Go around/missed approach not explicitly acknowledged')
      }
      // Check for altitude and heading in go-around
      const hasAltitude = /\d{3,5}/.test(normalizeToDigits(pilotReadback))
      const hasHeading = /heading|left|right/i.test(pilotReadback)
      if (!hasAltitude) {
        phaseSpecificIssues.push('Go around altitude not confirmed - essential for safe execution')
      }
      if (!hasHeading && /heading|turn/i.test(atcInstruction)) {
        phaseSpecificIssues.push('Go around heading/turn not confirmed')
      }
    }
    if (/visual\s+approach/i.test(atcInstruction) && /traffic|follow/i.test(atcInstruction)) {
      if (!/traffic|in\s+sight/i.test(pilotReadback)) {
        phaseSpecificIssues.push('Traffic not confirmed for visual approach - separation requires traffic in sight')
      }
    }
  }

  return {
    ...baseResult,
    phaseSpecificIssues,
  }
}

/**
 * Detects communication phase from instruction content
 */
function detectCommunicationPhase(instruction: string): 'departure' | 'approach' | 'enroute' {
  const text = instruction.toLowerCase()

  // Departure indicators
  const departurePatterns = [
    /radar\s+contact/i,
    /cleared\s+\w+\s+departure/i,
    /maintain\s+runway\s+heading/i,
    /after\s+departure/i,
    /initial\s+climb/i,
    /noise\s+abatement/i,
    /cleared\s+(for\s+)?take\s*off/i,
    /line\s*up\s+(and\s+)?wait/i,
  ]

  // Approach indicators
  const approachPatterns = [
    /cleared\s+(ils|rnav|vor|visual|ndb)\s+approach/i,
    /descend\s+via\s+star/i,
    /\w+\s+arrival/i,
    /intercept\s+(the\s+)?localizer/i,
    /vectors\s+(for|to)/i,
    /cleared\s+to\s+land/i,
    /go\s*around/i,
    /missed\s+approach/i,
    /final\s+approach/i,
    /glideslope/i,
    /circle\s+to\s+land/i,
    /qnh/i,
  ]

  for (const pattern of departurePatterns) {
    if (pattern.test(text)) return 'departure'
  }

  for (const pattern of approachPatterns) {
    if (pattern.test(text)) return 'approach'
  }

  return 'enroute'
}

/**
 * Get all training data including departure/approach specific
 */
export function getAllTrainingData(): typeof ATC_TRAINING_DATA {
  return [
    ...ATC_TRAINING_DATA,
    ...DEPARTURE_PHASE_TRAINING,
    ...APPROACH_PHASE_TRAINING,
  ]
}

/**
 * Enhanced export for HuggingFace with phase information
 */
export function exportForHuggingFaceEnhanced(): {
  instruction: string
  correct_response: string
  label: 'correct' | 'incorrect'
  error_type?: string
  phase?: 'departure' | 'approach' | 'general'
}[] {
  const data: ReturnType<typeof exportForHuggingFaceEnhanced> = []

  // General training data
  for (const example of ATC_TRAINING_DATA) {
    data.push({
      instruction: example.instruction,
      correct_response: example.correctReadback,
      label: 'correct',
      phase: 'general',
    })
    for (const error of example.commonErrors) {
      data.push({
        instruction: example.instruction,
        correct_response: error.error,
        label: 'incorrect',
        error_type: error.type,
        phase: 'general',
      })
    }
  }

  // Departure training data
  for (const example of DEPARTURE_PHASE_TRAINING) {
    data.push({
      instruction: example.instruction,
      correct_response: example.correctReadback,
      label: 'correct',
      phase: 'departure',
    })
    for (const error of example.commonErrors) {
      data.push({
        instruction: example.instruction,
        correct_response: error.error,
        label: 'incorrect',
        error_type: error.type,
        phase: 'departure',
      })
    }
  }

  // Approach training data
  for (const example of APPROACH_PHASE_TRAINING) {
    data.push({
      instruction: example.instruction,
      correct_response: example.correctReadback,
      label: 'correct',
      phase: 'approach',
    })
    for (const error of example.commonErrors) {
      data.push({
        instruction: example.instruction,
        correct_response: error.error,
        label: 'incorrect',
        error_type: error.type,
        phase: 'approach',
      })
    }
  }

  return data
}

// ============================================================================
// ENHANCED 2024 TRAINING DATA - EXPANDED CORPUS
// ============================================================================

/**
 * Extended ATC training data with global scenarios
 * Based on real-world ATC exchanges from ATCO2, ATCOSIM, and LDC corpora
 */
export const EXTENDED_ATC_TRAINING_DATA: typeof ATC_TRAINING_DATA = [
  // ===== COMPLEX CLEARANCES =====
  {
    instruction: "cleared to Manila via BOREG one alpha departure, squawk two three four five, departure frequency one two four decimal one",
    correctReadback: "cleared to Manila BOREG one alpha departure, squawk two three four five, departure one two four decimal one, {callsign}",
    instructionType: 'altitude_change',
    requiredElements: ['clearance', 'sid', 'squawk', 'frequency', 'callsign'],
    commonErrors: [
      { error: "cleared BOREG departure, {callsign}", type: 'missing_element' },
      { error: "Roger", type: 'incomplete_readback' },
    ],
  },
  {
    instruction: "after departure turn left heading two seven zero, climb and maintain five thousand, expect higher in ten miles",
    correctReadback: "after departure left heading two seven zero, climb and maintain five thousand, expect higher, {callsign}",
    instructionType: 'altitude_change',
    requiredElements: ['conditional', 'heading', 'altitude', 'callsign'],
    commonErrors: [
      { error: "left two seven zero climb five thousand, {callsign}", type: 'missing_element' },
    ],
  },

  // ===== APPROACH CLEARANCES =====
  {
    instruction: "descend via TONDO one alpha arrival, cross LANAS at and maintain one zero thousand",
    correctReadback: "descend via TONDO one alpha arrival, cross LANAS at and maintain one zero thousand, {callsign}",
    instructionType: 'altitude_change',
    requiredElements: ['star', 'crossing restriction', 'altitude', 'callsign'],
    commonErrors: [
      { error: "descend TONDO arrival, {callsign}", type: 'missing_element' },
    ],
  },
  {
    instruction: "turn right heading three zero zero, vectors ILS runway two four, descend and maintain four thousand",
    correctReadback: "right heading three zero zero, vectors ILS runway two four, descend four thousand, {callsign}",
    instructionType: 'heading_change',
    requiredElements: ['direction', 'heading', 'approach', 'runway', 'altitude', 'callsign'],
    commonErrors: [
      { error: "right three zero zero descend four thousand, {callsign}", type: 'missing_element' },
    ],
  },
  {
    instruction: "cleared ILS approach runway two four, maintain one eight zero knots until outer marker",
    correctReadback: "cleared ILS approach runway two four, one eight zero knots until outer marker, {callsign}",
    instructionType: 'approach_clearance',
    requiredElements: ['approach', 'runway', 'speed', 'restriction', 'callsign'],
    commonErrors: [
      { error: "cleared ILS two four, {callsign}", type: 'missing_element' },
    ],
  },

  // ===== GO-AROUND / MISSED APPROACH =====
  {
    instruction: "go around, climb runway heading to three thousand, contact approach one two zero decimal five",
    correctReadback: "going around, runway heading climb three thousand, approach one two zero decimal five, {callsign}",
    instructionType: 'altitude_change',
    requiredElements: ['go around', 'heading', 'altitude', 'frequency', 'callsign'],
    commonErrors: [
      { error: "going around, {callsign}", type: 'incomplete_readback' },
      { error: "go around climb three thousand, {callsign}", type: 'missing_element' },
    ],
  },

  // ===== HOLDING INSTRUCTIONS =====
  {
    instruction: "hold at BOREG, right turns, expect further clearance at one five zero zero",
    correctReadback: "hold at BOREG, right turns, expect further clearance one five zero zero, {callsign}",
    instructionType: 'hold_instruction',
    requiredElements: ['hold', 'fix', 'direction', 'expect time', 'callsign'],
    commonErrors: [
      { error: "hold BOREG, {callsign}", type: 'missing_element' },
    ],
  },

  // ===== RUNWAY OPERATIONS =====
  {
    instruction: "behind the departing Boeing triple seven, line up and wait runway two four",
    correctReadback: "behind departing Boeing triple seven, line up and wait runway two four, {callsign}",
    instructionType: 'lineup_wait',
    requiredElements: ['conditional', 'traffic', 'lineup', 'runway', 'callsign'],
    commonErrors: [
      { error: "line up and wait runway two four, {callsign}", type: 'missing_element' },
      { error: "cleared for takeoff runway two four, {callsign}", type: 'parameter_confusion' },
    ],
  },
  {
    instruction: "cross runway zero six, taxi via alpha bravo to holding point runway two four",
    correctReadback: "cross runway zero six, taxi via alpha bravo to holding point runway two four, {callsign}",
    instructionType: 'taxi_instruction',
    requiredElements: ['cross', 'runway', 'taxi route', 'destination', 'callsign'],
    commonErrors: [
      { error: "taxi alpha bravo, {callsign}", type: 'missing_element' },
    ],
  },

  // ===== EMERGENCY SCENARIOS =====
  {
    instruction: "roger mayday, turn left immediately heading two seven zero, descend and maintain three thousand, cleared direct LUBOG",
    correctReadback: "left immediately heading two seven zero, descend three thousand, direct LUBOG, {callsign}",
    instructionType: 'heading_change',
    requiredElements: ['direction', 'heading', 'altitude', 'direct', 'callsign'],
    commonErrors: [
      { error: "Roger", type: 'incomplete_readback' },
    ],
  },

  // ===== SPEED CONTROL =====
  {
    instruction: "reduce to minimum clean speed, expect vectors for spacing",
    correctReadback: "reduce to minimum clean speed, {callsign}",
    instructionType: 'speed_change',
    requiredElements: ['speed', 'callsign'],
    commonErrors: [
      { error: "slowing down, {callsign}", type: 'incomplete_readback' },
    ],
  },
  {
    instruction: "increase speed to Mach point eight four, resume normal speed reaching flight level four zero zero",
    correctReadback: "increase speed Mach point eight four, resume normal speed at flight level four zero zero, {callsign}",
    instructionType: 'speed_change',
    requiredElements: ['speed', 'mach', 'condition', 'callsign'],
    commonErrors: [
      { error: "Mach point eight four, {callsign}", type: 'missing_element' },
    ],
  },
]

// ============================================================================
// ADVANCED NLP UTILITIES
// ============================================================================

/**
 * Enhanced similarity calculation using Jaro-Winkler distance
 * Better for detecting typos and phonetic similarities
 */
export function jaroWinklerSimilarity(s1: string, s2: string): number {
  if (s1 === s2) return 1.0
  if (s1.length === 0 || s2.length === 0) return 0.0

  const matchDistance = Math.floor(Math.max(s1.length, s2.length) / 2) - 1
  const s1Matches: boolean[] = new Array(s1.length).fill(false)
  const s2Matches: boolean[] = new Array(s2.length).fill(false)

  let matches = 0
  let transpositions = 0

  // Find matches
  for (let i = 0; i < s1.length; i++) {
    const start = Math.max(0, i - matchDistance)
    const end = Math.min(i + matchDistance + 1, s2.length)

    for (let j = start; j < end; j++) {
      if (s2Matches[j] || s1[i] !== s2[j]) continue
      s1Matches[i] = true
      s2Matches[j] = true
      matches++
      break
    }
  }

  if (matches === 0) return 0.0

  // Count transpositions
  let k = 0
  for (let i = 0; i < s1.length; i++) {
    if (!s1Matches[i]) continue
    while (!s2Matches[k]) k++
    if (s1[i] !== s2[k]) transpositions++
    k++
  }

  const jaro = (matches / s1.length + matches / s2.length + (matches - transpositions / 2) / matches) / 3

  // Calculate common prefix (up to 4 characters)
  let prefix = 0
  for (let i = 0; i < Math.min(4, Math.min(s1.length, s2.length)); i++) {
    if (s1[i] === s2[i]) prefix++
    else break
  }

  return jaro + prefix * 0.1 * (1 - jaro)
}

/**
 * Calculate phonetic similarity for ATC communications
 * Considers ICAO phonetic alphabet and common pronunciation variations
 */
export function phoneticSimilarity(s1: string, s2: string): number {
  const phoneticMap: Record<string, string[]> = {
    '0': ['zero', 'oh', 'o'],
    '1': ['one', 'wun'],
    '2': ['two', 'too', 'to'],
    '3': ['three', 'tree'],
    '4': ['four', 'fower'],
    '5': ['five', 'fife'],
    '6': ['six'],
    '7': ['seven'],
    '8': ['eight', 'ait'],
    '9': ['nine', 'niner', 'nein'],
  }

  // Normalize both strings
  let n1 = s1.toLowerCase()
  let n2 = s2.toLowerCase()

  // Convert phonetic words to digits
  for (const [digit, words] of Object.entries(phoneticMap)) {
    for (const word of words) {
      const regex = new RegExp(`\\b${word}\\b`, 'gi')
      n1 = n1.replace(regex, digit)
      n2 = n2.replace(regex, digit)
    }
  }

  // Remove spaces for comparison
  n1 = n1.replace(/\s+/g, '')
  n2 = n2.replace(/\s+/g, '')

  return jaroWinklerSimilarity(n1, n2)
}

/**
 * Extract all numeric values from an ATC communication
 * Returns structured data about each value and its context
 */
export function extractAllNumericValues(text: string): Array<{
  value: string
  type: 'altitude' | 'heading' | 'speed' | 'frequency' | 'squawk' | 'runway' | 'unknown'
  context: string
  position: number
}> {
  const results: Array<{
    value: string
    type: 'altitude' | 'heading' | 'speed' | 'frequency' | 'squawk' | 'runway' | 'unknown'
    context: string
    position: number
  }> = []

  const normalized = normalizeToDigits(text)

  // Altitude patterns
  const altitudePatterns = [
    { regex: /flight\s*level\s*(\d{2,3})/gi, type: 'altitude' as const },
    { regex: /(\d{3,5})\s*(feet|ft)/gi, type: 'altitude' as const },
    { regex: /(maintain|climb|descend)\s+(\d{3,5})/gi, type: 'altitude' as const },
  ]

  // Heading patterns
  const headingPatterns = [
    { regex: /heading\s*(\d{3})/gi, type: 'heading' as const },
    { regex: /(left|right)\s+(\d{3})/gi, type: 'heading' as const },
  ]

  // Speed patterns
  const speedPatterns = [
    { regex: /(\d{2,3})\s*knots?/gi, type: 'speed' as const },
    { regex: /mach\s*(point\s*)?(\d+)/gi, type: 'speed' as const },
    { regex: /speed\s+(\d{2,3})/gi, type: 'speed' as const },
  ]

  // Frequency patterns
  const frequencyPatterns = [
    { regex: /(\d{3})\s*decimal\s*(\d{1,3})/gi, type: 'frequency' as const },
    { regex: /(\d{3})\.(\d{1,3})/gi, type: 'frequency' as const },
  ]

  // Squawk patterns
  const squawkPatterns = [
    { regex: /squawk\s*(\d{4})/gi, type: 'squawk' as const },
    { regex: /transponder\s*(\d{4})/gi, type: 'squawk' as const },
  ]

  // Runway patterns
  const runwayPatterns = [
    { regex: /runway\s*(\d{1,2}[LRC]?)/gi, type: 'runway' as const },
  ]

  const allPatterns = [
    ...altitudePatterns,
    ...headingPatterns,
    ...speedPatterns,
    ...frequencyPatterns,
    ...squawkPatterns,
    ...runwayPatterns,
  ]

  for (const { regex, type } of allPatterns) {
    let match
    while ((match = regex.exec(normalized)) !== null) {
      const value = match[1] || match[2] || match[0]
      results.push({
        value: value.replace(/\D/g, ''),
        type,
        context: match[0],
        position: match.index,
      })
    }
  }

  return results.sort((a, b) => a.position - b.position)
}

/**
 * Analyze readback completeness with weighted scoring
 */
export function analyzeReadbackCompleteness(
  instruction: string,
  readback: string
): {
  score: number
  missingElements: string[]
  presentElements: string[]
  criticalMissing: boolean
} {
  const criticalPatterns = [
    { pattern: /runway\s+\d+/i, name: 'runway', critical: true },
    { pattern: /flight\s+level\s+\d+/i, name: 'flight level', critical: true },
    { pattern: /\d+\s*(thousand|feet)/i, name: 'altitude', critical: true },
    { pattern: /cleared\s+(for\s+)?take\s*off/i, name: 'takeoff clearance', critical: true },
    { pattern: /cleared\s+to\s+land/i, name: 'landing clearance', critical: true },
    { pattern: /cleared\s+\w+\s+approach/i, name: 'approach clearance', critical: true },
    { pattern: /hold\s+short/i, name: 'hold short', critical: true },
    { pattern: /line\s*up\s+(and\s+)?wait/i, name: 'line up and wait', critical: true },
  ]

  const standardPatterns = [
    { pattern: /heading\s+\d+/i, name: 'heading', critical: false },
    { pattern: /speed\s+\d+|knots/i, name: 'speed', critical: false },
    { pattern: /squawk\s+\d+/i, name: 'squawk', critical: false },
    { pattern: /\d+\s*decimal\s*\d+/i, name: 'frequency', critical: false },
    { pattern: /qnh|altimeter/i, name: 'altimeter setting', critical: false },
  ]

  const allPatterns = [...criticalPatterns, ...standardPatterns]
  const missingElements: string[] = []
  const presentElements: string[] = []
  let criticalMissing = false
  let totalWeight = 0
  let achievedWeight = 0

  for (const { pattern, name, critical } of allPatterns) {
    const weight = critical ? 20 : 10
    if (pattern.test(instruction)) {
      totalWeight += weight
      if (pattern.test(readback)) {
        presentElements.push(name)
        achievedWeight += weight
      } else {
        missingElements.push(name)
        if (critical) criticalMissing = true
      }
    }
  }

  return {
    score: totalWeight > 0 ? Math.round((achievedWeight / totalWeight) * 100) : 0,
    missingElements,
    presentElements,
    criticalMissing,
  }
}

/**
 * Generate dynamic feedback based on error analysis
 */
export function generateDynamicFeedback(
  instruction: string,
  readback: string,
  errors: ReadbackError[]
): string {
  if (errors.length === 0) {
    return 'Readback correct. All required elements properly acknowledged.'
  }

  const feedback: string[] = []

  // Group errors by type
  const errorsByType = errors.reduce((acc, error) => {
    if (!acc[error.type]) acc[error.type] = []
    acc[error.type].push(error)
    return acc
  }, {} as Record<ErrorType, ReadbackError[]>)

  if (errorsByType.wrong_value) {
    for (const error of errorsByType.wrong_value) {
      feedback.push(`Incorrect ${error.parameter}: read back "${error.actualValue}" instead of "${error.expectedValue}"`)
    }
  }

  if (errorsByType.missing_element) {
    const missing = errorsByType.missing_element.map(e => e.parameter)
    feedback.push(`Missing: ${missing.join(', ')}`)
  }

  if (errorsByType.transposition) {
    feedback.push('Digit transposition detected - use digit-by-digit readback')
  }

  if (errorsByType.parameter_confusion) {
    feedback.push('Parameter confusion - clearly distinguish altitude, heading, and speed')
  }

  if (errorsByType.incomplete_readback) {
    feedback.push('Readback too brief - include all instruction elements')
  }

  // Add ICAO references for critical errors
  const criticalErrors = errors.filter(e => e.weight === 'critical')
  if (criticalErrors.length > 0) {
    feedback.push(`Reference: ${criticalErrors[0].icaoReference || 'ICAO Doc 4444 12.3.1'}`)
  }

  return feedback.join('. ')
}
