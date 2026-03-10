'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Upload, Loader2, CheckCircle, ChevronRight, Edit2, Trash2, AlertCircle } from 'lucide-react'
import Link from 'next/link'

type Step = 'upload' | 'review' | 'done'

interface Candidate {
  category: string
  difficulty: string
  question_data: Record<string, unknown>
  _selected: boolean
  _editingJson: string
  _jsonError: string
}

function candidatePreview(c: Candidate): string {
  const d = c.question_data
  if (c.category === 'readback') return (d.incorrectReadback as string) ?? ''
  if (c.category === 'scenario') return (d.atcClearance as string) ?? ''
  if (c.category === 'jumbled') return ((d.correctOrder as string[]) ?? []).join(' ')
  if (c.category === 'pronunciation') return `${d.display} → ${d.correctPronunciation}`
  return ''
}

const CATEGORIES = ['scenario', 'readback', 'jumbled', 'pronunciation']

export default function FromAnalysisPage() {
  const router = useRouter()
  const [step, setStep] = useState<Step>('upload')
  const [category, setCategory] = useState('readback')
  const [jsonText, setJsonText] = useState('')
  const [generating, setGenerating] = useState(false)
  const [genError, setGenError] = useState('')
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [approving, setApproving] = useState(false)
  const [approveError, setApproveError] = useState('')
  const [approvedCount, setApprovedCount] = useState(0)
  const [editingIdx, setEditingIdx] = useState<number | null>(null)

  const handleGenerate = async () => {
    setGenError('')
    let analysis: unknown
    try { analysis = JSON.parse(jsonText) } catch { setGenError('Invalid JSON. Paste the raw analysis export from the PAEC app.'); return }
    setGenerating(true)
    try {
      const res = await fetch('/api/questions/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category, analysis }),
      })
      const data = await res.json()
      if (!res.ok) { setGenError(data.error ?? 'Generation failed'); return }
      if (!data.candidates?.length) { setGenError('No suitable questions could be generated from this analysis for the selected category. Try a different category or analysis.'); return }
      setCandidates(data.candidates.map((c: { category: string; difficulty: string; question_data: Record<string, unknown> }) => ({
        ...c,
        _selected: true,
        _editingJson: JSON.stringify(c.question_data, null, 2),
        _jsonError: '',
      })))
      setStep('review')
    } catch { setGenError('Network error') }
    finally { setGenerating(false) }
  }

  const toggleSelect = (i: number) => {
    setCandidates(prev => prev.map((c, idx) => idx === i ? { ...c, _selected: !c._selected } : c))
  }

  const removeCandidate = (i: number) => {
    setCandidates(prev => prev.filter((_, idx) => idx !== i))
  }

  const saveEdit = (i: number) => {
    try {
      const parsed = JSON.parse(candidates[i]._editingJson)
      setCandidates(prev => prev.map((c, idx) => idx === i ? { ...c, question_data: parsed, _jsonError: '' } : c))
      setEditingIdx(null)
    } catch {
      setCandidates(prev => prev.map((c, idx) => idx === i ? { ...c, _jsonError: 'Invalid JSON' } : c))
    }
  }

  const handleApprove = async () => {
    const selected = candidates.filter(c => c._selected)
    if (selected.length === 0) { setApproveError('Select at least one candidate'); return }
    setApproving(true); setApproveError('')
    try {
      const res = await fetch('/api/questions/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          questions: selected.map(c => ({
            category: c.category,
            question_data: c.question_data,
            difficulty: c.difficulty,
            source_meta: { generatedFrom: category },
          })),
        }),
      })
      const data = await res.json()
      if (!res.ok) { setApproveError(data.error ?? 'Failed to approve'); return }
      setApprovedCount(data.created)
      setStep('done')
    } catch { setApproveError('Network error') }
    finally { setApproving(false) }
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/dashboard/questions" className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Generate from Analysis</h1>
          <p className="text-sm text-gray-500">Upload PAEC analysis JSON → auto-generate up to 20 candidates → review and approve</p>
        </div>
      </div>

      {/* Steps indicator */}
      <div className="flex items-center gap-2 text-sm">
        {(['upload', 'review', 'done'] as Step[]).map((s, i) => (
          <div key={s} className="flex items-center gap-2">
            {i > 0 && <ChevronRight className="w-4 h-4 text-gray-300" />}
            <span className={`font-medium capitalize ${step === s ? 'text-primary-700' : step === 'done' && i < 2 ? 'text-gray-400 line-through' : 'text-gray-400'}`}>{s}</span>
          </div>
        ))}
      </div>

      {/* Step 1 — Upload */}
      {step === 'upload' && (
        <div className="space-y-5">
          <div className="card p-6 space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Training Category</label>
              <select value={category} onChange={e => setCategory(e.target.value)} className="input-field w-56">
                {CATEGORIES.map(c => <option key={c} value={c} className="capitalize">{c}</option>)}
              </select>
              <p className="text-xs text-gray-400 mt-1">The system will generate questions appropriate for this category from the analysis data.</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Analysis JSON
                <span className="text-gray-400 font-normal ml-2">— paste the exported JSON from PAEC Analysis Mode</span>
              </label>
              <textarea
                value={jsonText}
                onChange={e => setJsonText(e.target.value)}
                className="input-field font-mono text-xs resize-y"
                rows={14}
                placeholder={'{\n  "parsedLines": [...],\n  "phraseologyErrors": [...],\n  ...\n}'}
              />
            </div>

            {genError && (
              <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />{genError}
              </div>
            )}

            <div className="flex gap-3">
              <button onClick={handleGenerate} disabled={!jsonText.trim() || generating} className="btn-primary">
                {generating ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Generating...</> : <><Upload className="w-4 h-4 mr-2" />Generate Candidates</>}
              </button>
              <Link href="/dashboard/questions" className="btn-secondary">Cancel</Link>
            </div>
          </div>

          <div className="p-4 bg-blue-50 border border-blue-100 rounded-xl text-sm text-blue-700">
            <strong>How to export:</strong> In the main PAEC app, run an analysis → open browser DevTools → Network tab → find the analysis API response → copy the JSON body. Or use the Export button on the analysis results page.
          </div>
        </div>
      )}

      {/* Step 2 — Review */}
      {step === 'review' && (
        <div className="space-y-5">
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-600">
              <strong>{candidates.filter(c => c._selected).length}</strong> of <strong>{candidates.length}</strong> candidates selected
            </p>
            <div className="flex gap-2">
              <button onClick={() => setCandidates(prev => prev.map(c => ({ ...c, _selected: true })))} className="btn-secondary text-xs px-3 py-1.5">Select All</button>
              <button onClick={() => setCandidates(prev => prev.map(c => ({ ...c, _selected: false })))} className="btn-secondary text-xs px-3 py-1.5">Deselect All</button>
            </div>
          </div>

          <div className="space-y-3">
            {candidates.map((c, i) => (
              <div key={i} className={`card overflow-hidden ${c._selected ? 'ring-2 ring-primary-400' : 'opacity-60'}`}>
                <div className="flex items-center gap-3 p-4 bg-gray-50 border-b border-gray-100">
                  <input type="checkbox" checked={c._selected} onChange={() => toggleSelect(i)} className="rounded w-4 h-4" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="badge bg-primary-100 text-primary-700 capitalize">{c.category}</span>
                      <span className={`badge capitalize ${c.difficulty === 'easy' ? 'bg-green-100 text-green-700' : c.difficulty === 'hard' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>{c.difficulty}</span>
                    </div>
                    <p className="text-sm text-gray-700 line-clamp-1">{candidatePreview(c)}</p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button onClick={() => setEditingIdx(editingIdx === i ? null : i)} className="p-1.5 text-gray-400 hover:text-primary-600 hover:bg-primary-50 rounded-lg transition-colors">
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => removeCandidate(i)} className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {editingIdx === i && (
                  <div className="p-4 space-y-2">
                    <textarea
                      value={c._editingJson}
                      onChange={e => setCandidates(prev => prev.map((x, idx) => idx === i ? { ...x, _editingJson: e.target.value } : x))}
                      className={`input-field font-mono text-xs resize-y ${c._jsonError ? 'border-red-400' : ''}`}
                      rows={10}
                    />
                    {c._jsonError && <p className="text-xs text-red-600">{c._jsonError}</p>}
                    <div className="flex gap-2">
                      <button onClick={() => saveEdit(i)} className="btn-primary text-xs px-3 py-1.5"><CheckCircle className="w-3 h-3 mr-1" />Save Edit</button>
                      <button onClick={() => setEditingIdx(null)} className="btn-secondary text-xs px-3 py-1.5">Cancel</button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>

          {approveError && (
            <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />{approveError}
            </div>
          )}

          <div className="flex gap-3">
            <button onClick={handleApprove} disabled={approving || candidates.filter(c => c._selected).length === 0} className="btn-primary">
              {approving ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Approving...</> : <><CheckCircle className="w-4 h-4 mr-2" />Approve Selected → Add to Pool</>}
            </button>
            <button onClick={() => setStep('upload')} className="btn-secondary">Back</button>
          </div>
        </div>
      )}

      {/* Step 3 — Done */}
      {step === 'done' && (
        <div className="card p-8 text-center space-y-4">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto">
            <CheckCircle className="w-8 h-8 text-green-600" />
          </div>
          <h2 className="text-xl font-bold text-gray-900">{approvedCount} question{approvedCount !== 1 ? 's' : ''} added to the pool</h2>
          <p className="text-sm text-gray-500">Students will see these questions in their next {category} training session.</p>
          <div className="flex gap-3 justify-center pt-2">
            <Link href="/dashboard/questions" className="btn-primary">View All Questions</Link>
            <button onClick={() => { setStep('upload'); setCandidates([]); setJsonText(''); setGenError('') }} className="btn-secondary">Generate More</button>
          </div>
        </div>
      )}
    </div>
  )
}
