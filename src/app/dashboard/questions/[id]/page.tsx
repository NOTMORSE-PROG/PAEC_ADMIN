'use client'

import { useState, useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { ArrowLeft, Save, Trash2, Loader2, CheckCircle, XCircle, Plus } from 'lucide-react'
import Link from 'next/link'

interface Question {
  id: string
  category: string
  is_active: boolean
  source: string
  question_data: Record<string, unknown>
  created_at: string
}

// ── Shared field components ────────────────────────────────────────────────────

function Field({ label, value, onChange, multiline }: { label: string; value: string; onChange: (v: string) => void; multiline?: boolean }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      {multiline
        ? <textarea value={value} onChange={e => onChange(e.target.value)} className="input-field text-sm resize-y" rows={3} />
        : <input type="text" value={value} onChange={e => onChange(e.target.value)} className="input-field text-sm" />}
    </div>
  )
}

function TagList({ label, items, onChange }: { label: string; items: string[]; onChange: (v: string[]) => void }) {
  const [draft, setDraft] = useState('')
  const add = () => { if (draft.trim()) { onChange([...items, draft.trim()]); setDraft('') } }
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      <div className="flex flex-wrap gap-1.5 mb-2">
        {items.map((item, i) => (
          <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 bg-gray-100 rounded text-xs text-gray-700">
            {item}
            <button type="button" onClick={() => onChange(items.filter((_, j) => j !== i))} className="text-gray-400 hover:text-red-500">×</button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <input type="text" value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), add())} className="input-field text-sm flex-1" placeholder="Add item, press Enter" />
        <button type="button" onClick={add} className="btn-secondary text-xs px-2 py-1.5"><Plus className="w-3 h-3" /></button>
      </div>
    </div>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function autoDetectErrors(incorrect: string, correct: string) {
  if (!incorrect.trim() || !correct.trim()) return []
  const tok = (s: string) => s.trim().split(/\s+/).map(w => w.replace(/[,.]$/, ''))
  const iTokens = tok(incorrect)
  const cTokens = tok(correct)
  const errors: { type: string; field: string; wrong: string; correct: string }[] = []
  const maxLen = Math.max(iTokens.length, cTokens.length)
  for (let i = 0; i < maxLen; i++) {
    const iw = iTokens[i] ?? ''
    const cw = cTokens[i] ?? ''
    if (iw.toLowerCase() !== cw.toLowerCase() && iw && cw) {
      errors.push({ type: /^\d+$/.test(iw) ? 'number' : 'word', field: 'phrase', wrong: iw, correct: cw })
    }
  }
  return errors
}

// ── Per-category forms ─────────────────────────────────────────────────────────

function ReadbackForm({ data, onChange }: { data: Record<string, unknown>; onChange: (d: Record<string, unknown>) => void }) {
  const set = (key: string, val: unknown) => {
    const updated = { ...data, [key]: val }
    // Auto-recompute errors whenever incorrect or correct readback changes
    if (key === 'incorrectReadback' || key === 'correctReadback') {
      updated.errors = autoDetectErrors(
        (key === 'incorrectReadback' ? val : data.incorrectReadback) as string ?? '',
        (key === 'correctReadback' ? val : data.correctReadback) as string ?? ''
      )
    }
    onChange(updated)
  }
  const detectedErrors = autoDetectErrors(data.incorrectReadback as string ?? '', data.correctReadback as string ?? '')
  return (
    <div className="space-y-4">
      <Field label="ATC Instruction" value={data.atcInstruction as string ?? ''} onChange={v => set('atcInstruction', v)} multiline />
      <Field label="Incorrect Readback" value={data.incorrectReadback as string ?? ''} onChange={v => set('incorrectReadback', v)} multiline />
      <Field label="Correct Readback" value={data.correctReadback as string ?? ''} onChange={v => set('correctReadback', v)} multiline />
      {detectedErrors.length > 0 && (
        <div className="text-xs text-gray-500 bg-gray-50 rounded-lg px-3 py-2">
          <span className="font-medium">Auto-detected errors:</span>{' '}
          {detectedErrors.map((e, i) => <span key={i} className="mr-2">&quot;{e.wrong}&quot; → &quot;{e.correct}&quot;</span>)}
        </div>
      )}
      <Field label="Explanation" value={data.explanation as string ?? ''} onChange={v => set('explanation', v)} multiline />
    </div>
  )
}

function ScenarioForm({ data, onChange }: { data: Record<string, unknown>; onChange: (d: Record<string, unknown>) => void }) {
  const set = (key: string, val: unknown) => onChange({ ...data, [key]: val })
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Call Sign" value={data.callSign as string ?? ''} onChange={v => set('callSign', v)} />
        <Field label="Flight Phase" value={data.flightPhase as string ?? ''} onChange={v => set('flightPhase', v)} />
      </div>
      <Field label="Aircraft Type" value={data.aircraftType as string ?? ''} onChange={v => set('aircraftType', v)} />
      <Field label="Situation (context shown to student)" value={data.situation as string ?? ''} onChange={v => set('situation', v)} multiline />
      <Field label="ATC Clearance" value={data.atcClearance as string ?? ''} onChange={v => set('atcClearance', v)} multiline />
      <Field label="Correct Response" value={data.correctResponse as string ?? ''} onChange={v => set('correctResponse', v)} multiline />
      <TagList label="Hints" items={(data.hints as string[]) ?? []} onChange={v => set('hints', v)} />
    </div>
  )
}

function JumbledForm({ data, onChange }: { data: Record<string, unknown>; onChange: (d: Record<string, unknown>) => void }) {
  const set = (key: string, val: unknown) => onChange({ ...data, [key]: val })
  const words = (data.correctOrder as string[]) ?? []
  return (
    <div className="space-y-4">
      <Field label="Instruction" value={data.instruction as string ?? ''} onChange={v => set('instruction', v)} multiline />
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Correct Word Order</label>
        <input
          type="text"
          value={words.join(' ')}
          onChange={e => set('correctOrder', e.target.value.split(/\s+/).filter(Boolean))}
          className="input-field text-sm"
          placeholder="Type words separated by spaces"
        />
        <p className="text-xs text-gray-400 mt-1">Students will rearrange these words into the correct order.</p>
      </div>
    </div>
  )
}

function PronunciationForm({ data, onChange }: { data: Record<string, unknown>; onChange: (d: Record<string, unknown>) => void }) {
  const set = (key: string, val: unknown) => onChange({ ...data, [key]: val })
  const options = (data.options as string[]) ?? ['', '', '', '']
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Display (e.g. '9')" value={data.display as string ?? ''} onChange={v => set('display', v)} />
        <Field label="Correct Pronunciation" value={data.correctPronunciation as string ?? ''} onChange={v => set('correctPronunciation', v)} />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Options (4 choices)</label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {[0, 1, 2, 3].map(i => (
            <input key={i} type="text" value={options[i] ?? ''} onChange={e => { const o = [...options]; o[i] = e.target.value; set('options', o) }}
              className="input-field text-sm" placeholder={`Option ${i + 1}`} />
          ))}
        </div>
      </div>
      <Field label="Explanation" value={data.explanation as string ?? ''} onChange={v => set('explanation', v)} multiline />
    </div>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function EditQuestionPage() {
  const router = useRouter()
  const { id } = useParams<{ id: string }>()
  const [question, setQuestion] = useState<Question | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState('')
  const [toast, setToast] = useState('')
  const [deleteConfirm, setDeleteConfirm] = useState('')
  const [isActive, setIsActive] = useState(false)
  const [questionData, setQuestionData] = useState<Record<string, unknown>>({})

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 3000) }

  useEffect(() => {
    fetch(`/api/questions/${id}`)
      .then(r => r.json())
      .then(d => {
        if (d.question) {
          setQuestion(d.question)
          setIsActive(d.question.is_active)
          setQuestionData(d.question.question_data)
        }
      })
      .catch(() => setError('Failed to load question'))
      .finally(() => setLoading(false))
  }, [id])

  const handleSave = async () => {
    // Per-category validation
    if (question?.category === 'readback') {
      if (!questionData.incorrectReadback || !questionData.correctReadback)
        return setError('Incorrect Readback and Correct Readback are required')
      if (questionData.incorrectReadback === questionData.correctReadback)
        return setError('Incorrect and Correct Readback must differ')
    } else if (question?.category === 'scenario') {
      if (!questionData.atcClearance || !questionData.correctResponse)
        return setError('ATC Clearance and Correct Response are required')
    } else if (question?.category === 'jumbled') {
      const order = questionData.correctOrder as string[] | undefined
      if (!Array.isArray(order) || order.length < 5)
        return setError('Correct Word Order must have at least 5 words')
    } else if (question?.category === 'pronunciation') {
      const opts = questionData.options as string[] | undefined
      if (!opts || opts.length !== 4) return setError('Exactly 4 options are required')
      if (!opts.includes(questionData.correctPronunciation as string))
        return setError('Correct Pronunciation must be one of the options')
    }
    setSaving(true); setError('')
    try {
      const res = await fetch(`/api/questions/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: isActive, question_data: questionData }),
      })
      if (!res.ok) { const d = await res.json(); setError(d.error ?? 'Save failed'); return }
      showToast('Saved successfully')
    } catch { setError('Network error') }
    finally { setSaving(false) }
  }

  const handleDelete = async () => {
    if (!question || deleteConfirm !== 'delete') return
    setDeleting(true)
    await fetch(`/api/questions/${id}`, { method: 'DELETE' })
    router.push('/dashboard/questions')
  }

  if (loading) return <div className="flex items-center justify-center py-24 text-gray-400"><Loader2 className="w-6 h-6 animate-spin mr-2" />Loading...</div>
  if (!question) return <div className="text-red-600 p-6">Question not found.</div>

  return (
    <div className="max-w-2xl space-y-6">
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 px-4 py-3 bg-gray-900 text-white text-sm rounded-xl shadow-lg flex items-center gap-2">
          <CheckCircle className="w-4 h-4 text-green-400" />{toast}
        </div>
      )}

      <div className="flex items-center gap-3">
        <Link href="/dashboard/questions" className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Edit Question</h1>
          <p className="text-sm text-gray-500 capitalize">{question.category} · {question.source}</p>
        </div>
      </div>

      {error && <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">{error}</div>}

      <div className="card p-6 space-y-5">
        <div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={isActive} onChange={e => setIsActive(e.target.checked)} className="rounded" />
            <span className="text-sm font-medium text-gray-700">Published (visible to students)</span>
          </label>
        </div>

        <hr className="border-gray-100" />

        {question.category === 'readback' && <ReadbackForm data={questionData} onChange={setQuestionData} />}
        {question.category === 'scenario' && <ScenarioForm data={questionData} onChange={setQuestionData} />}
        {question.category === 'jumbled' && <JumbledForm data={questionData} onChange={setQuestionData} />}
        {question.category === 'pronunciation' && <PronunciationForm data={questionData} onChange={setQuestionData} />}
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <button onClick={handleSave} disabled={saving} className="btn-primary w-full sm:w-auto">
          {saving ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Saving...</> : <><Save className="w-4 h-4 mr-2" />Save Changes</>}
        </button>
        <button onClick={async () => {
          const next = !isActive
          setIsActive(next)
          setSaving(true); setError('')
          try {
            const res = await fetch(`/api/questions/${id}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ is_active: next, question_data: questionData }),
            })
            if (!res.ok) { const d = await res.json(); setError(d.error ?? 'Save failed') }
            else showToast(next ? 'Published' : 'Unpublished')
          } catch { setError('Network error') }
          finally { setSaving(false) }
        }} disabled={saving} className="btn-secondary w-full sm:w-auto">
          {isActive ? <><XCircle className="w-4 h-4 mr-1" />Unpublish</> : <><CheckCircle className="w-4 h-4 mr-1" />Publish</>}
        </button>
      </div>

      <div className="card p-6 border-red-200 space-y-4">
        <h3 className="font-semibold text-red-700">Delete Question</h3>
        <p className="text-sm text-gray-600">This action is irreversible. Type <strong>delete</strong> to confirm.</p>
        <div className="flex flex-col sm:flex-row gap-3">
          <input value={deleteConfirm} onChange={e => setDeleteConfirm(e.target.value)}
            className="input-field flex-1" placeholder='Type "delete" to confirm' />
          <button onClick={handleDelete} disabled={deleteConfirm !== 'delete' || deleting} className="btn-danger disabled:opacity-40 w-full sm:w-auto">
            {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4 mr-1" />}Delete
          </button>
        </div>
      </div>
    </div>
  )
}
