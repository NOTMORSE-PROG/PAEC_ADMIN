'use client'

import { useState, useRef } from 'react'
import { ArrowLeft, Upload, Loader2, CheckCircle, ChevronRight, Edit2, Trash2, AlertCircle, FileText, X, Plus, AlertTriangle } from 'lucide-react'
import Link from 'next/link'
import { parseAnalysisCSV } from '@/lib/csvParser'

type Step = 'upload' | 'review' | 'done'

interface Candidate {
  category: string
  difficulty: string
  question_data: Record<string, unknown>
  _selected: boolean
  _duplicate?: { score: number; matchId: string; matchPreview: string }
  _warnings?: string[]
}

function getQualityWarnings(c: Candidate): string[] {
  const w: string[] = []
  const d = c.question_data
  if (c.category === 'readback') {
    if ((d.incorrectReadback ?? '') === (d.correctReadback ?? '')) w.push('Identical texts')
  }
  if (c.category === 'scenario' && ((d.atcClearance as string) ?? '').length < 30) w.push('Short clearance')
  if (c.category === 'jumbled' && ((d.correctOrder as string[]) ?? []).length < 4) w.push('Very short phrase')
  return w
}

function candidatePreview(c: Candidate): string {
  const d = c.question_data
  if (c.category === 'readback') return (d.incorrectReadback as string) ?? ''
  if (c.category === 'scenario') return (d.atcClearance as string) ?? ''
  if (c.category === 'jumbled') return (d.instruction as string) ?? ((d.correctOrder as string[]) ?? []).slice(0, 3).join(' ') + '…'
  if (c.category === 'pronunciation') return `"${d.display}" — which ICAO pronunciation is correct?`
  return ''
}

// ── Inline edit forms per category ────────────────────────────────────────────

function ReadbackEditForm({ data, onChange }: { data: Record<string, unknown>; onChange: (d: Record<string, unknown>) => void }) {
  const set = (key: string, val: unknown) => onChange({ ...data, [key]: val })
  return (
    <div className="space-y-3">
      <Field label="ATC Instruction" value={data.atcInstruction as string ?? ''} onChange={v => set('atcInstruction', v)} />
      <Field label="Incorrect Readback" value={data.incorrectReadback as string ?? ''} onChange={v => set('incorrectReadback', v)} />
      <Field label="Correct Readback" value={data.correctReadback as string ?? ''} onChange={v => set('correctReadback', v)} />
      <Field label="Explanation" value={data.explanation as string ?? ''} onChange={v => set('explanation', v)} multiline />
    </div>
  )
}

function ScenarioEditForm({ data, onChange }: { data: Record<string, unknown>; onChange: (d: Record<string, unknown>) => void }) {
  const set = (key: string, val: unknown) => onChange({ ...data, [key]: val })
  const hints = (data.hints as string[]) ?? []
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Call Sign" value={data.callSign as string ?? ''} onChange={v => set('callSign', v)} />
        <Field label="Flight Phase" value={data.flightPhase as string ?? ''} onChange={v => set('flightPhase', v)} />
      </div>
      <Field label="Aircraft Type" value={data.aircraftType as string ?? ''} onChange={v => set('aircraftType', v)} />
      <Field label="Situation (context for student)" value={data.situation as string ?? ''} onChange={v => set('situation', v)} multiline />
      <Field label="ATC Clearance" value={data.atcClearance as string ?? ''} onChange={v => set('atcClearance', v)} multiline />
      <Field label="Correct Response" value={data.correctResponse as string ?? ''} onChange={v => set('correctResponse', v)} multiline />
      <TagList label="Hints" items={hints} onChange={v => set('hints', v)} />
    </div>
  )
}

function JumbledEditForm({ data, onChange }: { data: Record<string, unknown>; onChange: (d: Record<string, unknown>) => void }) {
  const set = (key: string, val: unknown) => onChange({ ...data, [key]: val })
  const correctOrder = (data.correctOrder as string[]) ?? []
  return (
    <div className="space-y-3">
      <Field label="Instruction" value={data.instruction as string ?? ''} onChange={v => set('instruction', v)} multiline />
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Correct Word Order</label>
        <input
          type="text"
          value={correctOrder.join(' ')}
          onChange={e => set('correctOrder', e.target.value.split(/\s+/).filter(Boolean))}
          className="input-field text-sm"
          placeholder="Type words separated by spaces"
        />
        <p className="text-xs text-gray-400 mt-1">Words split by spaces — students will rearrange these</p>
      </div>
    </div>
  )
}

function PronunciationEditForm({ data, onChange }: { data: Record<string, unknown>; onChange: (d: Record<string, unknown>) => void }) {
  const set = (key: string, val: unknown) => onChange({ ...data, [key]: val })
  const options = (data.options as string[]) ?? ['', '', '', '']
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Display (e.g. '9')" value={data.display as string ?? ''} onChange={v => set('display', v)} />
        <Field label="Correct Pronunciation" value={data.correctPronunciation as string ?? ''} onChange={v => set('correctPronunciation', v)} />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Options (4 choices)</label>
        <div className="grid grid-cols-2 gap-2">
          {[0, 1, 2, 3].map(i => (
            <input
              key={i}
              type="text"
              value={options[i] ?? ''}
              onChange={e => { const o = [...options]; o[i] = e.target.value; set('options', o) }}
              className="input-field text-sm"
              placeholder={`Option ${i + 1}`}
            />
          ))}
        </div>
      </div>
      <Field label="Explanation" value={data.explanation as string ?? ''} onChange={v => set('explanation', v)} multiline />
    </div>
  )
}

// ── Shared small components ────────────────────────────────────────────────────

function Field({ label, value, onChange, multiline }: { label: string; value: string; onChange: (v: string) => void; multiline?: boolean }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
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
      <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
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

function CandidateEditPanel({ c, onChange }: { c: Candidate; onChange: (d: Record<string, unknown>) => void }) {
  return (
    <div className="p-4 border-t border-gray-100 bg-white">
      {c.category === 'readback' && <ReadbackEditForm data={c.question_data} onChange={onChange} />}
      {c.category === 'scenario' && <ScenarioEditForm data={c.question_data} onChange={onChange} />}
      {c.category === 'jumbled' && <JumbledEditForm data={c.question_data} onChange={onChange} />}
      {c.category === 'pronunciation' && <PronunciationEditForm data={c.question_data} onChange={onChange} />}
    </div>
  )
}

// ── Main page ──────────────────────────────────────────────────────────────────

const CATEGORIES = ['scenario', 'readback', 'jumbled', 'pronunciation']

export default function FromAnalysisPage() {
  const [step, setStep] = useState<Step>('upload')
  const [category, setCategory] = useState('readback')
  const [csvFile, setCsvFile] = useState<File | null>(null)
  const [dragging, setDragging] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [genError, setGenError] = useState('')
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [approving, setApproving] = useState(false)
  const [approveError, setApproveError] = useState('')
  const [approvedCount, setApprovedCount] = useState(0)
  const [editingIdx, setEditingIdx] = useState<number | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFileDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file && (file.name.endsWith('.csv') || file.type === 'text/csv' || file.type === 'application/vnd.ms-excel')) {
      setCsvFile(file); setGenError('')
    } else {
      setGenError('Please upload a .csv file exported from the system analysis.')
    }
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) { setCsvFile(file); setGenError('') }
  }

  const handleGenerate = async () => {
    if (!csvFile) { setGenError('Please upload a CSV file first.'); return }
    setGenError(''); setGenerating(true)
    try {
      const csvText = await csvFile.text()
      const analysis = parseAnalysisCSV(csvText)
      if (!analysis.parsedLines.length && !analysis.phraseologyErrors.length) {
        setGenError('Could not parse the CSV file. Make sure it is a Corpus-Based System analysis export with ERROR SUMMARY and ANNOTATED TRANSCRIPT sections.')
        return
      }
      const res = await fetch('/api/questions/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category, analysis }),
      })
      const data = await res.json()
      if (!res.ok) { setGenError(data.error ?? 'Generation failed'); return }
      if (!data.candidates?.length) {
        setGenError('No suitable questions could be generated from this analysis for the selected category. Try a different category.')
        return
      }

      const rawCandidates: Candidate[] = data.candidates.map((c: { category: string; difficulty: string; question_data: Record<string, unknown> }) => ({
        ...c, _selected: true, _warnings: [],
      }))
      // Quality pass
      for (const c of rawCandidates) c._warnings = getQualityWarnings(c)

      // Check for duplicates against the existing DB
      try {
        const dupRes = await fetch('/api/questions/check-duplicates', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ candidates: rawCandidates.map(c => ({ category: c.category, question_data: c.question_data })) }),
        })
        if (dupRes.ok) {
          const dupData = await dupRes.json()
          for (const r of dupData.results) {
            if (r.duplicate) rawCandidates[r.index]._duplicate = { score: r.score, matchId: r.matchId, matchPreview: r.matchPreview }
          }
        }
      } catch { /* duplicate check is best-effort */ }

      setCandidates(rawCandidates)
      setStep('review')
    } catch { setGenError('Failed to read or parse the CSV file.') }
    finally { setGenerating(false) }
  }

  const updateCandidateData = (i: number, data: Record<string, unknown>) => {
    setCandidates(prev => prev.map((c, idx) => {
      if (idx !== i) return c
      const updated = { ...c, question_data: data }
      updated._warnings = getQualityWarnings(updated)
      return updated
    }))
  }

  const toggleSelect = (i: number) => {
    setCandidates(prev => prev.map((c, idx) => idx === i ? { ...c, _selected: !c._selected } : c))
  }

  const removeCandidate = (i: number) => {
    setCandidates(prev => prev.filter((_, idx) => idx !== i))
    if (editingIdx === i) setEditingIdx(null)
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
            source_meta: { generatedFrom: category, fileName: csvFile?.name },
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
          <p className="text-sm text-gray-500">Upload a system analysis CSV export → auto-generate up to 10 candidates → review and approve</p>
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
              <p className="text-xs text-gray-400 mt-1">The system will generate questions appropriate for this category.</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Analysis CSV Export
                <span className="text-gray-400 font-normal ml-2">— exported from Analysis Mode</span>
              </label>
              {csvFile ? (
                <div className="flex items-center gap-3 p-4 bg-green-50 border border-green-200 rounded-xl">
                  <FileText className="w-8 h-8 text-green-600 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-green-800 truncate">{csvFile.name}</p>
                    <p className="text-xs text-green-600">{(csvFile.size / 1024).toFixed(1)} KB — ready to generate</p>
                  </div>
                  <button onClick={() => { setCsvFile(null); if (fileInputRef.current) fileInputRef.current.value = '' }} className="p-1 text-green-500 hover:text-green-700 rounded transition-colors">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <div
                  onDragOver={e => { e.preventDefault(); setDragging(true) }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={handleFileDrop}
                  onClick={() => fileInputRef.current?.click()}
                  className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-colors ${dragging ? 'border-primary-400 bg-primary-50' : 'border-gray-200 hover:border-primary-300 hover:bg-gray-50'}`}
                >
                  <Upload className="w-8 h-8 text-gray-400 mx-auto mb-3" />
                  <p className="text-sm font-medium text-gray-700">Drop your CSV file here</p>
                  <p className="text-xs text-gray-400 mt-1">or click to browse</p>
                  <p className="text-xs text-gray-300 mt-2">.csv files only</p>
                </div>
              )}
              <input ref={fileInputRef} type="file" accept=".csv,text/csv" className="hidden" onChange={handleFileSelect} />
            </div>

            {genError && (
              <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />{genError}
              </div>
            )}

            <div className="flex gap-3">
              <button onClick={handleGenerate} disabled={!csvFile || generating} className="btn-primary">
                {generating ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Generating...</> : <><Upload className="w-4 h-4 mr-2" />Generate Candidates</>}
              </button>
              <Link href="/dashboard/questions" className="btn-secondary">Cancel</Link>
            </div>
          </div>

          <div className="p-4 bg-blue-50 border border-blue-100 rounded-xl text-sm text-blue-700">
            <strong>How to export:</strong> In the Corpus-Based System, run an analysis on a corpus file → click <strong>Export CSV</strong> on the results page → save the file → upload it here.
          </div>
        </div>
      )}

      {/* Step 2 — Review */}
      {step === 'review' && (
        <div className="space-y-5">
          {candidates.some(c => c._duplicate) && (
            <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-xl text-amber-800 text-sm">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>
                <strong>{candidates.filter(c => c._duplicate).length}</strong> candidate{candidates.filter(c => c._duplicate).length !== 1 ? 's are' : ' is'} similar to questions already in the database. Review before approving to avoid duplicates.
              </span>
            </div>
          )}
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
              <div key={i} className={`card overflow-hidden ${c._selected ? 'ring-2 ring-primary-400' : 'opacity-60'} ${c._duplicate ? 'ring-2 ring-amber-400' : ''}`}>
                <div className="flex items-center gap-3 p-4 bg-gray-50 border-b border-gray-100">
                  <input type="checkbox" checked={c._selected} onChange={() => toggleSelect(i)} className="rounded w-4 h-4" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                      <span className="badge bg-primary-100 text-primary-700 capitalize">{c.category}</span>
                      <span className={`badge capitalize ${c.difficulty === 'easy' ? 'bg-green-100 text-green-700' : c.difficulty === 'hard' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>{c.difficulty}</span>
                      {c._duplicate && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800 border border-amber-300">
                          <AlertTriangle className="w-3 h-3" />
                          {c._duplicate.score}% similar to existing
                        </span>
                      )}
                      {(c._warnings ?? []).map(w => (
                        <span key={w} className="text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 border border-gray-200">{w}</span>
                      ))}
                    </div>
                    <p className="text-sm text-gray-700 line-clamp-1">{candidatePreview(c)}</p>
                    {c._duplicate && (
                      <p className="text-xs text-amber-600 mt-0.5 line-clamp-1">
                        Existing: {c._duplicate.matchPreview}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => setEditingIdx(editingIdx === i ? null : i)}
                      className={`p-1.5 rounded-lg transition-colors ${editingIdx === i ? 'text-primary-600 bg-primary-50' : 'text-gray-400 hover:text-primary-600 hover:bg-primary-50'}`}
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => removeCandidate(i)} className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {editingIdx === i && (
                  <CandidateEditPanel c={c} onChange={data => updateCandidateData(i, data)} />
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
            <button onClick={() => { setStep('upload'); setCandidates([]); setCsvFile(null); setGenError('') }} className="btn-secondary">Generate More</button>
          </div>
        </div>
      )}
    </div>
  )
}
