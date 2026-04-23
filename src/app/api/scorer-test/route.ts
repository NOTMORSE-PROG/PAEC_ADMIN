import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import {
  semanticReadbackScore,
  computeScenarioElements,
  MAX_ANSWER_LEN,
  type ElementDetail,
} from '@/lib/atcAnswerMatcher'
import {
  analyzeReadback,
  type SemanticAnalysisResult,
} from '@/lib/semanticReadbackAnalyzer'

async function requireAdmin() {
  const session = await auth()
  if (!session || (session.user as { role?: string })?.role !== 'admin') return null
  return session
}

type Mode = 'readback' | 'scenario'

interface ScorerTestBody {
  mode?: Mode
  atcInstruction?: string
  correctReadback?: string
  correctResponse?: string
  callSign?: string
  traineeAnswer?: string
  incorrectReadback?: string
}

interface ScorerTestResponse {
  score: number
  elements?: ElementDetail[]
  verdict: {
    quality: SemanticAnalysisResult['quality']
    confidence: number
    errors: SemanticAnalysisResult['errors']
    corrections: SemanticAnalysisResult['corrections']
    expectedResponse: string
    actualResponse: string
  }
}

function cap(s: unknown): string {
  return typeof s === 'string' ? s.slice(0, MAX_ANSWER_LEN) : ''
}

export async function POST(req: NextRequest) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = (await req.json().catch(() => ({}))) as ScorerTestBody
  const mode: Mode = body.mode === 'scenario' ? 'scenario' : 'readback'
  const atcInstruction = cap(body.atcInstruction)
  const traineeAnswer = cap(body.traineeAnswer)
  const correctReadback = cap(body.correctReadback)
  const correctResponse = cap(body.correctResponse)

  if (!atcInstruction.trim() || !traineeAnswer.trim()) {
    return NextResponse.json(
      { error: 'ATC instruction and trainee answer are required' },
      { status: 400 }
    )
  }
  if (mode === 'readback' && !correctReadback.trim()) {
    return NextResponse.json(
      { error: 'Correct readback is required' },
      { status: 400 }
    )
  }
  if (mode === 'scenario' && !correctResponse.trim()) {
    return NextResponse.json(
      { error: 'Correct response is required' },
      { status: 400 }
    )
  }

  try {
    const verdict = analyzeReadback(atcInstruction, traineeAnswer)

    let score: number
    let elements: ElementDetail[] | undefined

    if (mode === 'scenario') {
      const result = computeScenarioElements(
        {
          atcClearance: atcInstruction,
          callSign: cap(body.callSign),
          correctResponse,
        },
        traineeAnswer
      )
      score = result.score
      elements = result.elements
    } else {
      score = semanticReadbackScore(traineeAnswer, {
        correctReadback,
        incorrectReadback: cap(body.incorrectReadback),
        atcInstruction,
        callSign: cap(body.callSign),
      })
    }

    const response: ScorerTestResponse = {
      score,
      elements,
      verdict: {
        quality: verdict.quality,
        confidence: verdict.confidence,
        errors: verdict.errors,
        corrections: verdict.corrections,
        expectedResponse: verdict.expectedResponse,
        actualResponse: verdict.actualResponse,
      },
    }
    return NextResponse.json(response)
  } catch (err) {
    console.error('admin.scorer-test.error', { error: String(err) })
    return NextResponse.json(
      { error: 'Scorer threw an internal error — check server logs' },
      { status: 500 }
    )
  }
}
