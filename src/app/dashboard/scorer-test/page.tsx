'use client'

import { useEffect, useState } from 'react'
import {
  FlaskConical,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Info,
} from 'lucide-react'

interface QuestionRow {
  id: string
  category: string
  question_data: Record<string, unknown>
}

type Mode = 'readback' | 'scenario'
type Weight = 'critical' | 'high' | 'medium' | 'low'
type Quality = 'complete' | 'partial' | 'incorrect' | 'missing'

interface ElementDetail {
  name: string
  value: string
  found: boolean
}

interface ReadbackError {
  type: string
  parameter: string
  expectedValue: string | null
  actualValue: string | null
  weight: Weight
  explanation: string
  icaoReference?: string
}

interface CorrectionSuggestion {
  correctPhrase: string
  whyIncorrect: string
  icaoStandard: string
}

interface ScorerResponse {
  score: number
  elements?: ElementDetail[]
  verdict: {
    quality: Quality
    confidence: number
    errors: ReadbackError[]
    corrections: CorrectionSuggestion[]
    expectedResponse: string
    actualResponse: string
  }
}

const QUALITY_STYLES: Record<Quality, { label: string; badge: string }> = {
  complete:  { label: 'Complete',  badge: 'bg-green-100 text-green-700 border-green-200' },
  partial:   { label: 'Partial',   badge: 'bg-yellow-100 text-yellow-700 border-yellow-200' },
  incorrect: { label: 'Incorrect', badge: 'bg-red-100 text-red-700 border-red-200' },
  missing:   { label: 'Missing',   badge: 'bg-gray-100 text-gray-700 border-gray-200' },
}

const WEIGHT_STYLES: Record<Weight, string> = {
  critical: 'bg-red-100 text-red-700 border-red-200',
  high:     'bg-orange-100 text-orange-700 border-orange-200',
  medium:   'bg-yellow-100 text-yellow-700 border-yellow-200',
  low:      'bg-blue-100 text-blue-700 border-blue-200',
}

function scoreColor(score: number): string {
  if (score >= 80) return 'text-green-600'
  if (score >= 60) return 'text-yellow-600'
  return 'text-red-600'
}

export default function ScorerTestPage() {
  const [mode, setMode] = useState<Mode>('readback')
  const [atcInstruction, setAtcInstruction] = useState('')
  const [correctReadback, setCorrectReadback] = useState('')
  const [correctResponse, setCorrectResponse] = useState('')
  const [callSign, setCallSign] = useState('')
  const [traineeAnswer, setTraineeAnswer] = useState('')
  const [incorrectReadback, setIncorrectReadback] = useState('')

  const [questions, setQuestions] = useState<QuestionRow[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [loadingQuestions, setLoadingQuestions] = useState(false)

  const [result, setResult] = useState<ScorerResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoadingQuestions(true)
    fetch(`/api/questions?category=${mode}&status=published&limit=200`)
      .then(r => r.json())
      .then(data => {
        if (cancelled) return
        setQuestions(Array.isArray(data.questions) ? data.questions : [])
      })
      .catch(() => {
        if (!cancelled) setQuestions([])
      })
      .finally(() => {
        if (!cancelled) setLoadingQuestions(false)
      })
    return () => { cancelled = true }
  }, [mode])

  function pickQuestion(id: string) {
    setSelectedId(id)
    if (!id) return
    const q = questions.find(x => x.id === id)
    if (!q) return
    const d = q.question_data as Record<string, string | undefined>
    if (mode === 'readback') {
      setAtcInstruction(d.atcInstruction ?? '')
      setCorrectReadback(d.correctReadback ?? '')
      setIncorrectReadback(d.incorrectReadback ?? '')
      setCallSign('')
    } else {
      setAtcInstruction(d.atcClearance ?? '')
      setCorrectResponse(d.correctResponse ?? '')
      setCallSign(d.callSign ?? '')
    }
    setTraineeAnswer('')
    setResult(null)
    setError(null)
  }

  function previewLabel(q: QuestionRow): string {
    const d = q.question_data as Record<string, string | undefined>
    const src = mode === 'readback' ? d.atcInstruction : d.atcClearance
    const text = (src ?? '').replace(/\s+/g, ' ').trim()
    return text.length > 80 ? text.slice(0, 77) + '…' : text || '(no preview)'
  }

  async function handleSubmit() {
    setError(null)
    setLoading(true)
    try {
      const res = await fetch('/api/scorer-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode,
          atcInstruction,
          correctReadback,
          correctResponse,
          callSign,
          traineeAnswer,
          incorrectReadback,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Unknown error')
        setResult(null)
      } else {
        setResult(data as ScorerResponse)
      }
    } catch (e) {
      setError(String(e))
      setResult(null)
    } finally {
      setLoading(false)
    }
  }

  function switchMode(next: Mode) {
    setMode(next)
    setSelectedId('')
    setResult(null)
    setError(null)
  }

  const hasReference = mode === 'readback'
    ? correctReadback.trim().length > 0
    : correctResponse.trim().length > 0

  const canSubmit =
    atcInstruction.trim().length > 0 &&
    traineeAnswer.trim().length > 0 &&
    hasReference &&
    !loading

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-4">
        <div className="w-12 h-12 bg-primary-600 rounded-xl flex items-center justify-center shrink-0">
          <FlaskConical className="w-6 h-6 text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Scorer Test</h1>
          <p className="text-sm text-gray-600 mt-1">
            Type an ATC instruction and what a trainee might say back. See what score the system
            gives and why.
          </p>
        </div>
      </div>

      <div className="card p-2 inline-flex gap-1">
        <button
          onClick={() => switchMode('readback')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            mode === 'readback'
              ? 'bg-primary-600 text-white shadow-sm'
              : 'text-gray-600 hover:bg-gray-50'
          }`}
        >
          Readback
        </button>
        <button
          onClick={() => switchMode('scenario')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            mode === 'scenario'
              ? 'bg-primary-600 text-white shadow-sm'
              : 'text-gray-600 hover:bg-gray-50'
          }`}
        >
          Scenario
        </button>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Inputs */}
        <div className="card p-6 space-y-4">
          <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wide">Inputs</h2>

          <Field
            label="Pick a published question"
            hint={
              loadingQuestions
                ? 'Loading…'
                : questions.length === 0
                ? 'No published questions in this category yet — type inputs manually.'
                : 'Select to auto-fill the fields below, or leave blank to type your own.'
            }
          >
            <select
              className="input-field"
              value={selectedId}
              onChange={e => pickQuestion(e.target.value)}
              disabled={loadingQuestions}
            >
              <option value="">— Type my own —</option>
              {questions.map(q => (
                <option key={q.id} value={q.id}>
                  {previewLabel(q)}
                </option>
              ))}
            </select>
          </Field>

          <Field label="ATC Instruction *" hint="What the controller said.">
            <textarea
              className="input-field resize-none"
              rows={2}
              placeholder="e.g. CPA 101, climb and maintain FL350"
              value={atcInstruction}
              onChange={e => setAtcInstruction(e.target.value)}
            />
          </Field>

          {mode === 'readback' ? (
            <Field label="Correct Readback *" hint="The model answer a trainee should give.">
              <textarea
                className="input-field resize-none"
                rows={2}
                placeholder="e.g. Climbing FL350, CPA 101"
                value={correctReadback}
                onChange={e => setCorrectReadback(e.target.value)}
              />
            </Field>
          ) : (
            <>
              <Field label="Callsign" hint="Used to build the element breakdown.">
                <input
                  type="text"
                  className="input-field"
                  placeholder="e.g. CPA 101"
                  value={callSign}
                  onChange={e => setCallSign(e.target.value)}
                />
              </Field>
              <Field label="Correct Response *" hint="The model answer a trainee should give.">
                <textarea
                  className="input-field resize-none"
                  rows={2}
                  placeholder="e.g. Climbing FL350, squawk 7000, CPA 101"
                  value={correctResponse}
                  onChange={e => setCorrectResponse(e.target.value)}
                />
              </Field>
            </>
          )}

          <Field label="Trainee's Answer *" hint="What the pilot actually said.">
            <textarea
              className="input-field resize-none"
              rows={3}
              placeholder="e.g. CPA 101, climbing flight level three five zero"
              value={traineeAnswer}
              onChange={e => setTraineeAnswer(e.target.value)}
            />
          </Field>

          {mode === 'readback' && (
            <details className="text-sm">
              <summary className="cursor-pointer text-gray-600 hover:text-gray-900">
                Advanced: pre-fill short-circuit test
              </summary>
              <div className="mt-2">
                <Field
                  label="Incorrect (pre-filled) readback"
                  hint="If the trainee's answer matches this exactly, score is forced to 0."
                >
                  <textarea
                    className="input-field resize-none"
                    rows={2}
                    placeholder="e.g. CPA 101, descending to FL350"
                    value={incorrectReadback}
                    onChange={e => setIncorrectReadback(e.target.value)}
                  />
                </Field>
              </div>
            </details>
          )}

          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="btn-primary w-full flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            Score this answer
          </button>

          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 flex gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}
        </div>

        {/* Results */}
        <div className="card p-6 space-y-5">
          <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wide">Result</h2>

          {!result ? (
            <div className="text-sm text-gray-500 flex items-center gap-2">
              <Info className="w-4 h-4" />
              Fill the inputs on the left and click “Score this answer”.
            </div>
          ) : (
            <>
              <div className="flex items-baseline gap-4">
                <div className={`text-6xl font-bold ${scoreColor(result.score)}`}>
                  {result.score}
                </div>
                <div className="text-sm text-gray-500">/ 100</div>
                <span
                  className={`ml-auto px-3 py-1 rounded-full text-xs font-semibold border ${QUALITY_STYLES[result.verdict.quality].badge}`}
                >
                  {QUALITY_STYLES[result.verdict.quality].label}
                </span>
              </div>

              {mode === 'scenario' && result.elements && result.elements.length > 0 && (
                <div>
                  <h3 className="text-xs font-semibold text-gray-900 uppercase tracking-wide mb-2">
                    Elements found
                  </h3>
                  <ul className="space-y-1.5">
                    {result.elements.map(el => (
                      <li key={el.name} className="flex items-center gap-2 text-sm">
                        {el.found ? (
                          <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0" />
                        ) : (
                          <XCircle className="w-4 h-4 text-red-500 shrink-0" />
                        )}
                        <span className="capitalize text-gray-700">{el.name}:</span>
                        <span className="text-gray-900 font-medium">{el.value}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div>
                <h3 className="text-xs font-semibold text-gray-900 uppercase tracking-wide mb-2">
                  Why this score?
                </h3>
                {result.verdict.errors.length === 0 ? (
                  <div className="text-sm text-green-700 flex gap-2">
                    <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
                    No errors detected — the readback matches the instruction.
                  </div>
                ) : (
                  <ul className="space-y-2">
                    {result.verdict.errors.map((err, i) => (
                      <li key={i} className="rounded-lg border border-gray-200 p-3 bg-gray-50">
                        <div className="flex items-start gap-2 flex-wrap">
                          <span
                            className={`text-xs font-semibold uppercase px-2 py-0.5 rounded border ${WEIGHT_STYLES[err.weight]}`}
                          >
                            {err.weight}
                          </span>
                          <span className="text-xs text-gray-500">
                            {err.type.replace(/_/g, ' ')} · {err.parameter}
                          </span>
                        </div>
                        <p className="text-sm text-gray-700 mt-1.5">{err.explanation}</p>
                        {err.expectedValue && err.actualValue && (
                          <p className="text-xs text-gray-500 mt-1">
                            Expected <span className="font-medium">{err.expectedValue}</span>, got{' '}
                            <span className="font-medium">{err.actualValue}</span>
                          </p>
                        )}
                        {err.icaoReference && (
                          <p className="text-xs text-gray-400 mt-1">{err.icaoReference}</p>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {result.verdict.corrections.length > 0 && (
                <div>
                  <h3 className="text-xs font-semibold text-gray-900 uppercase tracking-wide mb-2">
                    Suggested correction
                  </h3>
                  <ul className="space-y-2">
                    {result.verdict.corrections.map((c, i) => (
                      <li key={i} className="rounded-lg border border-primary-200 bg-primary-50 p-3">
                        <p className="text-sm font-medium text-primary-900">{c.correctPhrase}</p>
                        <p className="text-xs text-primary-700 mt-1">{c.whyIncorrect}</p>
                        {c.icaoStandard && (
                          <p className="text-xs text-primary-500 mt-1">{c.icaoStandard}</p>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <details className="text-xs">
                <summary className="cursor-pointer text-gray-400 hover:text-gray-600">
                  Raw verdict (debug)
                </summary>
                <pre className="mt-2 p-3 bg-gray-900 text-gray-100 rounded-lg overflow-x-auto text-[11px] leading-relaxed">
{JSON.stringify(result, null, 2)}
                </pre>
              </details>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      {children}
      {hint && <p className="text-xs text-gray-500 mt-1">{hint}</p>}
    </div>
  )
}
