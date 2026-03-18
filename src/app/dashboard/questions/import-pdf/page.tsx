'use client'

import { useState, useRef } from 'react'
import {
  ArrowLeft, Upload, Loader2, CheckCircle, ChevronRight,
  Edit2, Trash2, AlertCircle, FileText, X, AlertTriangle, Download, Plus,
} from 'lucide-react'
import Link from 'next/link'
import {
  extractPdfText, parsePdfQuestions, getQualityWarnings,
  PDF_TEMPLATES, FORMAT_GUIDES,
  type ParsedCandidate,
} from '@/lib/pdfQuestionParser'

type Step = 'upload' | 'review' | 'done'

const CATEGORIES = ['scenario', 'readback', 'jumbled', 'pronunciation'] as const
type Category = typeof CATEGORIES[number]

const CATEGORY_LABELS: Record<Category, string> = {
  scenario:     'Scenario-Based Simulation',
  readback:     'Readback / Hearback Correction',
  jumbled:      'Jumbled Clearance',
  pronunciation: 'Pronunciation Drill',
}

const CATEGORY_COLORS: Record<Category, string> = {
  scenario:     'bg-blue-100 text-blue-700',
  readback:     'bg-amber-100 text-amber-700',
  jumbled:      'bg-violet-100 text-violet-700',
  pronunciation: 'bg-emerald-100 text-emerald-700',
}

const CATEGORY_FORMAT_NOTES: Record<Category, string> = {
  pronunciation: 'Numbered Q&A with four choices (a–d) and a "correct answer is X" line.',
  readback:      'Numbered blocks with labeled fields: ATC:, INCORRECT:, CORRECT:, ERRORS: (optional), EXPLANATION: (optional).',
  scenario:      'Numbered blocks with labeled fields: CALLSIGN:, PHASE:, AIRCRAFT:, SITUATION:, ATC:, CORRECT:, HINTS: (optional).',
  jumbled:       'Numbered blocks with labeled fields: INSTRUCTION:, CORRECT: (words in correct order), TYPE: (optional).',
}

// ── Shared helpers ─────────────────────────────────────────────────────────────

function Field({ label, value, onChange, multiline }: {
  label: string; value: string; onChange: (v: string) => void; multiline?: boolean
}) {
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
        <input type="text" value={draft} onChange={e => setDraft(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), add())}
          className="input-field text-sm flex-1" placeholder="Add item, press Enter" />
        <button type="button" onClick={add} className="btn-secondary text-xs px-2 py-1.5"><Plus className="w-3 h-3" /></button>
      </div>
    </div>
  )
}

// ── Per-category edit forms ────────────────────────────────────────────────────

function ReadbackEditForm({ data, onChange }: { data: Record<string, unknown>; onChange: (d: Record<string, unknown>) => void }) {
  const set = (key: string, val: unknown) => onChange({ ...data, [key]: val })
  return (
    <div className="space-y-3">
      <Field label="ATC Instruction" value={data.atcInstruction as string ?? ''} onChange={v => set('atcInstruction', v)} />
      <Field label="Incorrect Readback (what the pilot said)" value={data.incorrectReadback as string ?? ''} onChange={v => set('incorrectReadback', v)} />
      <Field label="Correct Readback (expected answer)" value={data.correctReadback as string ?? ''} onChange={v => set('correctReadback', v)} />
      <Field label="Explanation (optional)" value={data.explanation as string ?? ''} onChange={v => set('explanation', v)} multiline />
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
      <Field label="Type / Category (optional)" value={data.category as string ?? ''} onChange={v => set('category', v)} />
    </div>
  )
}

function PronunciationQuestionEditForm({
  data,
  onChange,
}: {
  data: Record<string, unknown>
  onChange: (d: Record<string, unknown>) => void
}) {
  const options = (data.options as string[]) ?? ['', '', '', '']
  const currentCorrect = data.correctPronunciation as string ?? ''

  const setOption = (i: number, v: string) => {
    const next = [...options]
    next[i] = v
    const wasCorrect = currentCorrect === options[i]
    onChange({
      ...data,
      options: next,
      ...(wasCorrect ? { correctPronunciation: v, audioHint: v } : {}),
    })
  }

  const correctIdx = options.findIndex(o => o === currentCorrect)

  const setCorrectByIndex = (i: number) => {
    onChange({ ...data, correctPronunciation: options[i] ?? '', audioHint: options[i] ?? '' })
  }

  const LABELS = ['A', 'B', 'C', 'D']

  return (
    <div className="space-y-3">
      <Field
        label="Question"
        value={data.display as string ?? ''}
        onChange={v => onChange({ ...data, display: v })}
        multiline
      />
      <div className="grid grid-cols-2 gap-3">
        {[0, 1, 2, 3].map(i => (
          <Field key={i} label={`Choice ${LABELS[i]}`} value={options[i] ?? ''} onChange={v => setOption(i, v)} />
        ))}
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Correct Answer</label>
        <select
          value={correctIdx >= 0 ? correctIdx : ''}
          onChange={e => setCorrectByIndex(Number(e.target.value))}
          className="input-field w-64 text-sm"
        >
          <option value="" disabled>Select correct choice</option>
          {[0, 1, 2, 3].map(i => (
            <option key={i} value={i}>{LABELS[i]}. {options[i] || '(empty)'}</option>
          ))}
        </select>
      </div>
      <Field
        label="Explanation (optional)"
        value={data.explanation as string ?? ''}
        onChange={v => onChange({ ...data, explanation: v })}
        multiline
      />
    </div>
  )
}

function CandidateEditPanel({ c, onChange }: { c: ParsedCandidate; onChange: (d: Record<string, unknown>) => void }) {
  return (
    <div className="p-4 border-t border-gray-100 bg-white">
      {c.category === 'readback'     && <ReadbackEditForm data={c.question_data} onChange={onChange} />}
      {c.category === 'scenario'     && <ScenarioEditForm data={c.question_data} onChange={onChange} />}
      {c.category === 'jumbled'      && <JumbledEditForm data={c.question_data} onChange={onChange} />}
      {c.category === 'pronunciation' && <PronunciationQuestionEditForm data={c.question_data} onChange={onChange} />}
    </div>
  )
}

// ── Candidate preview text ─────────────────────────────────────────────────────

function candidatePreview(c: ParsedCandidate): string {
  const d = c.question_data
  if (c.category === 'readback')     return (d.incorrectReadback as string) ?? (d.atcInstruction as string) ?? ''
  if (c.category === 'scenario')     return (d.atcClearance as string) ?? ''
  if (c.category === 'jumbled')      return (d.instruction as string) ?? ((d.correctOrder as string[]) ?? []).join(' ')
  if (c.category === 'pronunciation') return (d.display as string) ?? ''
  return ''
}

// ── Template download ─────────────────────────────────────────────────────────

function downloadTemplate(category: Category) {
  const content = PDF_TEMPLATES[category] ?? ''
  const blob = new Blob([content], { type: 'text/plain' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `template-${category}.txt`
  a.click()
  URL.revokeObjectURL(url)
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function ImportPdfPage() {
  const [step, setStep] = useState<Step>('upload')
  const [category, setCategory] = useState<Category>('pronunciation')
  const [pdfFile, setPdfFile] = useState<File | null>(null)
  const [dragging, setDragging] = useState(false)
  const [extracting, setExtracting] = useState(false)
  const [extractError, setExtractError] = useState('')
  const [parseErrors, setParseErrors] = useState<string[]>([])
  const [difficulty, setDifficulty] = useState('medium')
  const [candidates, setCandidates] = useState<ParsedCandidate[]>([])
  const [editingIdx, setEditingIdx] = useState<number | null>(null)
  const [importing, setImporting] = useState(false)
  const [importError, setImportError] = useState('')
  const [importedCount, setImportedCount] = useState(0)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleCategoryChange = (cat: Category) => {
    setCategory(cat)
    setCandidates([])
    setParseErrors([])
    setExtractError('')
    setEditingIdx(null)
  }

  const handleFileDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file?.type === 'application/pdf') {
      setPdfFile(file); setExtractError('')
    } else {
      setExtractError('Please upload a PDF file.')
    }
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) { setPdfFile(file); setExtractError('') }
  }

  const handleExtract = async () => {
    if (!pdfFile) { setExtractError('Please select a PDF file first.'); return }
    setExtracting(true); setExtractError(''); setParseErrors([])
    try {
      const text = await extractPdfText(pdfFile)
      const result = parsePdfQuestions(text, category)

      if (result.questions.length === 0) {
        setExtractError(result.errors[0] ?? 'No questions could be extracted from this PDF. Check the format.')
        return
      }

      setDifficulty(result.difficulty)
      setParseErrors(result.errors)
      setCandidates(result.questions)
      setStep('review')
    } catch (err) {
      setExtractError(`Extraction failed: ${err instanceof Error ? err.message : 'Unknown error'}`)
    } finally {
      setExtracting(false)
    }
  }

  const updateCandidateData = (i: number, data: Record<string, unknown>) => {
    setCandidates(prev => prev.map((c, idx) => {
      if (idx !== i) return c
      return {
        ...c,
        question_data: data as ParsedCandidate['question_data'],
        _warnings: getQualityWarnings(c.category, data),
      }
    }))
  }

  const toggleSelect = (i: number) =>
    setCandidates(prev => prev.map((c, idx) => idx === i ? { ...c, _selected: !c._selected } : c))

  const removeCandidate = (i: number) => {
    setCandidates(prev => prev.filter((_, idx) => idx !== i))
    if (editingIdx === i) setEditingIdx(null)
    else if (editingIdx !== null && editingIdx > i) setEditingIdx(editingIdx - 1)
  }

  const handleImport = async () => {
    const selected = candidates.filter(c => c._selected)
    if (selected.length === 0) { setImportError('Select at least one question.'); return }
    setImporting(true); setImportError('')
    try {
      const res = await fetch('/api/questions/import-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: pdfFile?.name,
          questions: selected.map(c => ({
            category: c.category,
            question_data: c.question_data,
            difficulty: c.difficulty,
          })),
        }),
      })
      const data = await res.json()
      if (!res.ok) { setImportError(data.error ?? 'Import failed'); return }
      setImportedCount(data.created)
      setStep('done')
    } catch { setImportError('Network error') }
    finally { setImporting(false) }
  }

  const reset = () => {
    setStep('upload'); setCandidates([]); setPdfFile(null)
    setExtractError(''); setParseErrors([]); setEditingIdx(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const selectedCount = candidates.filter(c => c._selected).length
  const catLabel = CATEGORY_LABELS[category]
  const catColor = CATEGORY_COLORS[category]

  return (
    <div className="max-w-3xl space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href="/dashboard/questions" className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Import from PDF</h1>
          <p className="text-sm text-gray-500">Upload a question PDF → questions added to the selected training pool</p>
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

      {/* ── Step 1: Upload ── */}
      {step === 'upload' && (
        <div className="space-y-5">
          <div className="card p-6 space-y-5">

            {/* Category selector */}
            <div>
              <label className="block text-sm font-semibold text-gray-800 mb-2">Target training category</label>
              <div className="grid grid-cols-2 gap-2">
                {CATEGORIES.map(cat => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => handleCategoryChange(cat)}
                    className={`flex items-center gap-2 px-4 py-3 rounded-xl border text-sm font-medium transition-colors text-left ${
                      category === cat
                        ? 'border-primary-400 bg-primary-50 text-primary-800 ring-2 ring-primary-300'
                        : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:bg-gray-50'
                    }`}
                  >
                    <span className={`badge text-xs ${CATEGORY_COLORS[cat]}`}>{cat}</span>
                    <span className="truncate">{CATEGORY_LABELS[cat]}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* File drop */}
            {pdfFile ? (
              <div className="flex items-center gap-3 p-4 bg-green-50 border border-green-200 rounded-xl">
                <FileText className="w-8 h-8 text-green-600 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-green-800 truncate">{pdfFile.name}</p>
                  <p className="text-xs text-green-600">{(pdfFile.size / 1024).toFixed(1)} KB — ready to extract</p>
                </div>
                <button
                  onClick={() => { setPdfFile(null); if (fileInputRef.current) fileInputRef.current.value = '' }}
                  className="p-1 text-green-500 hover:text-green-700 rounded transition-colors"
                >
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
                <p className="text-sm font-medium text-gray-700">Drop your PDF here</p>
                <p className="text-xs text-gray-400 mt-1">or click to browse</p>
                <p className="text-xs text-gray-300 mt-2">.pdf files only</p>
              </div>
            )}
            <input ref={fileInputRef} type="file" accept="application/pdf,.pdf" className="hidden" onChange={handleFileSelect} />

            {extractError && (
              <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />{extractError}
              </div>
            )}

            <div className="flex gap-3">
              <button onClick={handleExtract} disabled={!pdfFile || extracting} className="btn-primary">
                {extracting
                  ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Extracting...</>
                  : <><Upload className="w-4 h-4 mr-2" />Extract Questions</>}
              </button>
              <Link href="/dashboard/questions" className="btn-secondary">Cancel</Link>
            </div>
          </div>

          {/* Format guide */}
          <div className="p-4 bg-blue-50 border border-blue-100 rounded-xl space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-blue-800">
                  Expected PDF format — <span className={`badge text-xs ml-1 ${catColor}`}>{category}</span>
                </p>
                <p className="text-xs text-blue-600 mt-0.5">{CATEGORY_FORMAT_NOTES[category]}</p>
              </div>
              <button
                onClick={() => downloadTemplate(category)}
                className="flex items-center gap-1.5 text-xs font-medium text-blue-700 hover:text-blue-900 border border-blue-300 rounded-lg px-2.5 py-1.5 hover:bg-blue-100 transition-colors shrink-0"
              >
                <Download className="w-3.5 h-3.5" />Download sample
              </button>
            </div>
            <pre className="text-xs text-blue-700 font-mono leading-relaxed bg-white/60 rounded-lg p-3 border border-blue-100 whitespace-pre-wrap">
              {FORMAT_GUIDES[category]}
            </pre>
            <div className="text-xs text-blue-600 space-y-1">
              <p><strong>All formats:</strong> Add <code className="bg-white/60 px-1 rounded">DIFFICULTY: easy</code> / <code className="bg-white/60 px-1 rounded">medium</code> / <code className="bg-white/60 px-1 rounded">hard</code> on the first line to set difficulty for all questions in the file.</p>
              {category === 'pronunciation' && (
                <p>Questions are numbered <strong>1.</strong> / <strong>1)</strong>, choices labeled <strong>a–d</strong>, correct answer on its own line: <strong>correct answer is b</strong>.</p>
              )}
              {(category === 'readback' || category === 'scenario' || category === 'jumbled') && (
                <p>Each question starts with a number on its own line (<strong>1.</strong> or <strong>1)</strong>). Fields follow as <strong>LABEL: value</strong>. Multi-line values are supported — just continue on the next line before the next label.</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Step 2: Review ── */}
      {step === 'review' && (
        <div className="space-y-5">
          {parseErrors.length > 0 && (
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl space-y-1">
              <div className="flex items-center gap-2 text-amber-800 text-sm font-semibold">
                <AlertTriangle className="w-4 h-4" />
                {parseErrors.length} parsing issue{parseErrors.length !== 1 ? 's' : ''} — affected questions are deselected
              </div>
              <ul className="text-xs text-amber-700 pl-5 space-y-0.5 list-disc">
                {parseErrors.slice(0, 6).map((e, i) => <li key={i}>{e}</li>)}
                {parseErrors.length > 6 && <li>…and {parseErrors.length - 6} more</li>}
              </ul>
            </div>
          )}

          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-600">
              <strong>{selectedCount}</strong> of <strong>{candidates.length}</strong> selected
              <span className="ml-2 text-gray-400">· {difficulty} difficulty · {category} pool</span>
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
                    <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                      <span className={`badge ${CATEGORY_COLORS[c.category as Category]}`}>{c.category}</span>
                      <span className={`badge capitalize ${c.difficulty === 'easy' ? 'bg-green-100 text-green-700' : c.difficulty === 'hard' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>{c.difficulty}</span>
                      {(c._warnings ?? []).map(w => (
                        <span key={w} className="text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 border border-gray-200">{w}</span>
                      ))}
                    </div>
                    <p className="text-sm text-gray-700 line-clamp-1">{candidatePreview(c)}</p>
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

          {importError && (
            <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />{importError}
            </div>
          )}

          <div className="flex gap-3">
            <button onClick={handleImport} disabled={importing || selectedCount === 0} className="btn-primary">
              {importing
                ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Importing...</>
                : <><CheckCircle className="w-4 h-4 mr-2" />Import {selectedCount} Selected</>}
            </button>
            <button onClick={() => setStep('upload')} className="btn-secondary">Back</button>
          </div>
        </div>
      )}

      {/* ── Step 3: Done ── */}
      {step === 'done' && (
        <div className="card p-8 text-center space-y-4">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto">
            <CheckCircle className="w-8 h-8 text-green-600" />
          </div>
          <h2 className="text-xl font-bold text-gray-900">
            {importedCount} question{importedCount !== 1 ? 's' : ''} imported
          </h2>
          <p className="text-sm text-gray-500">
            Added to the <strong className="capitalize">{category}</strong> pool ({CATEGORY_LABELS[category]}).
            Students will see them in their next session once they are published.
          </p>
          <div className="flex gap-3 justify-center pt-2">
            <Link href={`/dashboard/questions?category=${category}`} className="btn-primary">View Questions</Link>
            <button onClick={reset} className="btn-secondary">Import Another PDF</button>
          </div>
        </div>
      )}
    </div>
  )
}
