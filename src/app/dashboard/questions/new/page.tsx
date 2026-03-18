'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Save, Loader2, CheckCircle } from 'lucide-react'
import Link from 'next/link'

type Category = 'scenario' | 'readback' | 'jumbled' | 'pronunciation'

function autoDetectErrors(incorrect: string, correct: string) {
  if (!incorrect.trim() || !correct.trim()) return []
  const tok = (s: string) => s.trim().split(/\s+/).map(w => w.replace(/[,.]$/,''))
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

export default function NewQuestionPage() {
  const router = useRouter()
  const [category, setCategory] = useState<Category>('readback')
  const [difficulty, setDifficulty] = useState('medium')
  const [isActive, setIsActive] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Readback fields
  const [rb_atcInstruction, setRb_atcInstruction] = useState('')
  const [rb_incorrectReadback, setRb_incorrectReadback] = useState('')
  const [rb_correctReadback, setRb_correctReadback] = useState('')
  const [rb_explanation, setRb_explanation] = useState('')

  // Scenario fields
  const [sc_callSign, setSc_callSign] = useState('')
  const [sc_flightPhase, setSc_flightPhase] = useState('departure')
  const [sc_aircraftType, setSc_aircraftType] = useState('')
  const [sc_situation, setSc_situation] = useState('')
  const [sc_atcClearance, setSc_atcClearance] = useState('')
  const [sc_correctResponse, setSc_correctResponse] = useState('')
  const [sc_hints, setSc_hints] = useState('')

  // Jumbled fields
  const [jm_instruction, setJm_instruction] = useState('')
  const [jm_correctOrder, setJm_correctOrder] = useState('')
  const [jm_category, setJm_category] = useState('clearance')

  // Pronunciation fields
  const [pr_type, setPr_type] = useState('number')
  const [pr_display, setPr_display] = useState('')
  const [pr_correct, setPr_correct] = useState('')
  const [pr_options, setPr_options] = useState('')
  const [pr_explanation, setPr_explanation] = useState('')

  const buildQuestionData = (): Record<string, unknown> => {
    switch (category) {
      case 'readback':
        return {
          atcInstruction: rb_atcInstruction,
          incorrectReadback: rb_incorrectReadback,
          correctReadback: rb_correctReadback,
          errors: autoDetectErrors(rb_incorrectReadback, rb_correctReadback),
          explanation: rb_explanation,
        }
      case 'scenario':
        return { callSign: sc_callSign, flightPhase: sc_flightPhase, aircraftType: sc_aircraftType, situation: sc_situation, atcClearance: sc_atcClearance, correctResponse: sc_correctResponse, hints: sc_hints.split('\n').map(s => s.trim()).filter(Boolean) }
      case 'jumbled':
        return { instruction: jm_instruction, correctOrder: jm_correctOrder.split(/\s+/).filter(Boolean), category: jm_category }
      case 'pronunciation':
        return { type: pr_type, display: pr_display, correctPronunciation: pr_correct, options: pr_options.split(',').map(s => s.trim()).filter(Boolean), explanation: pr_explanation, audioHint: pr_correct }
    }
  }

  const validate = (): string | null => {
    const issues: string[] = []
    if (category === 'readback') {
      if (!rb_atcInstruction.trim()) issues.push('ATC Instruction is required')
      if (!rb_incorrectReadback.trim()) issues.push('Incorrect Readback is required')
      if (!rb_correctReadback.trim()) issues.push('Correct Readback is required')
      if (rb_incorrectReadback.trim() && rb_correctReadback.trim() && rb_incorrectReadback.trim() === rb_correctReadback.trim()) issues.push('Incorrect and Correct Readback must differ')
    } else if (category === 'scenario') {
      if (!sc_callSign.trim()) issues.push('Call Sign is required')
      if (!sc_atcClearance.trim()) issues.push('ATC Clearance is required')
      if (!sc_correctResponse.trim()) issues.push('Correct Response is required')
    } else if (category === 'jumbled') {
      if (!jm_instruction.trim()) issues.push('Instruction is required')
      const words = jm_correctOrder.split(/\s+/).filter(Boolean)
      if (words.length < 5) issues.push('Correct Word Order must have at least 5 words')
    } else if (category === 'pronunciation') {
      if (!pr_display.trim()) issues.push('Display is required')
      if (!pr_correct.trim()) issues.push('Correct Pronunciation is required')
      const opts = pr_options.split(',').map(s => s.trim()).filter(Boolean)
      if (opts.length !== 4) issues.push('Exactly 4 options are required')
      if (pr_correct.trim() && opts.length === 4 && !opts.includes(pr_correct.trim())) issues.push('Correct Pronunciation must be one of the options')
    }
    return issues.length > 0 ? issues.join('; ') : null
  }

  const handleSave = async (forceActive?: boolean) => {
    const validationError = validate()
    if (validationError) { setError(validationError); return }
    setSaving(true); setError('')
    try {
      const res = await fetch('/api/questions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category, difficulty, is_active: forceActive ?? isActive, question_data: buildQuestionData(), source: 'manual' }),
      })
      if (!res.ok) { const d = await res.json(); setError(d.error ?? 'Failed to save'); return }
      router.push('/dashboard/questions')
    } catch { setError('Network error') }
    finally { setSaving(false) }
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/dashboard/questions" className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">New Question</h1>
          <p className="text-sm text-gray-500">Manually create a training question</p>
        </div>
      </div>

      {error && <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">{error}</div>}

      <div className="card p-6 space-y-5">
        {/* Meta */}
        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
            <select value={category} onChange={e => setCategory(e.target.value as Category)} className="input-field">
              <option value="readback">Readback</option>
              <option value="scenario">Scenario</option>
              <option value="jumbled">Jumbled</option>
              <option value="pronunciation">Pronunciation</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Difficulty</label>
            <select value={difficulty} onChange={e => setDifficulty(e.target.value)} className="input-field">
              <option value="easy">Easy</option>
              <option value="medium">Medium</option>
              <option value="hard">Hard</option>
            </select>
          </div>
          <div className="flex items-end pb-1">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={isActive} onChange={e => setIsActive(e.target.checked)} className="rounded" />
              <span className="text-sm font-medium text-gray-700">Publish immediately</span>
            </label>
          </div>
        </div>

        <hr className="border-gray-100" />

        {/* Category-specific fields */}
        {category === 'readback' && (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">ATC Instruction</label>
              <textarea value={rb_atcInstruction} onChange={e => setRb_atcInstruction(e.target.value)} className="input-field resize-none" rows={2} placeholder="PAL456, descend to 3000 feet, QNH 1013" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Incorrect Readback <span className="text-red-500">*</span></label>
              <textarea value={rb_incorrectReadback} onChange={e => setRb_incorrectReadback(e.target.value)} className="input-field resize-none" rows={2} placeholder="Descend to 4000 feet, QNH 1013, PAL456" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Correct Readback <span className="text-red-500">*</span></label>
              <textarea value={rb_correctReadback} onChange={e => setRb_correctReadback(e.target.value)} className="input-field resize-none" rows={2} placeholder="Descend to 3000 feet, QNH 1013, PAL456" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Explanation</label>
              <textarea value={rb_explanation} onChange={e => setRb_explanation(e.target.value)} className="input-field resize-none" rows={2} placeholder="Pilot misread altitude..." />
            </div>
          </div>
        )}

        {category === 'scenario' && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Call Sign <span className="text-red-500">*</span></label>
                <input value={sc_callSign} onChange={e => setSc_callSign(e.target.value)} className="input-field" placeholder="PAL456" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Flight Phase</label>
                <select value={sc_flightPhase} onChange={e => setSc_flightPhase(e.target.value)} className="input-field">
                  <option value="departure">Departure</option>
                  <option value="approach">Approach</option>
                  <option value="ground">Ground</option>
                  <option value="cruise">Cruise</option>
                </select>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Aircraft Type</label>
              <input value={sc_aircraftType} onChange={e => setSc_aircraftType(e.target.value)} className="input-field" placeholder="Airbus A320" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Situation (context for student)</label>
              <textarea value={sc_situation} onChange={e => setSc_situation(e.target.value)} className="input-field resize-none" rows={2} placeholder="You are departing Manila, climbing after takeoff on runway 24..." />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">ATC Clearance <span className="text-red-500">*</span></label>
              <textarea value={sc_atcClearance} onChange={e => setSc_atcClearance(e.target.value)} className="input-field resize-none" rows={2} placeholder="PAL456, cleared to Manila via LUSPO..." />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Correct Pilot Response <span className="text-red-500">*</span></label>
              <textarea value={sc_correctResponse} onChange={e => setSc_correctResponse(e.target.value)} className="input-field resize-none" rows={2} placeholder="Cleared to Manila via LUSPO, PAL456" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Hints (one per line)</label>
              <textarea value={sc_hints} onChange={e => setSc_hints(e.target.value)} className="input-field resize-none" rows={2} placeholder="Include all elements&#10;Say call sign last" />
            </div>
          </div>
        )}

        {category === 'jumbled' && (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Instruction <span className="text-red-500">*</span></label>
              <textarea value={jm_instruction} onChange={e => setJm_instruction(e.target.value)} className="input-field resize-none" rows={2} placeholder="ATC says: 'PAL456, climb and maintain FL350'. Arrange the correct readback:" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Correct Word Order (space-separated words) <span className="text-red-500">*</span></label>
              <textarea value={jm_correctOrder} onChange={e => setJm_correctOrder(e.target.value)} className="input-field resize-none" rows={2} placeholder="Climb and maintain flight level tree fife zero PAL456" />
              <p className="text-xs text-gray-400 mt-1">Each word/token separated by comma. These will be shuffled for the student.</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Sub-category</label>
              <input value={jm_category} onChange={e => setJm_category(e.target.value)} className="input-field" placeholder="altitude, heading, taxi, clearance..." />
            </div>
          </div>
        )}

        {category === 'pronunciation' && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
                <select value={pr_type} onChange={e => setPr_type(e.target.value)} className="input-field">
                  <option value="number">Number</option>
                  <option value="letter">Letter</option>
                  <option value="word">Word/Term</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Display <span className="text-red-500">*</span></label>
                <input value={pr_display} onChange={e => setPr_display(e.target.value)} className="input-field" placeholder="9" />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Correct Pronunciation <span className="text-red-500">*</span></label>
              <input value={pr_correct} onChange={e => setPr_correct(e.target.value)} className="input-field" placeholder="Niner" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">All Options (comma-separated, include correct) <span className="text-red-500">*</span></label>
              <input value={pr_options} onChange={e => setPr_options(e.target.value)} className="input-field" placeholder="Nine, Niner, Ni-ner, Nein" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Explanation</label>
              <textarea value={pr_explanation} onChange={e => setPr_explanation(e.target.value)} className="input-field resize-none" rows={2} placeholder="ICAO: '9' is 'Niner' to avoid confusion with German 'Nein'" />
            </div>
          </div>
        )}
      </div>

      <div className="flex gap-3">
        <button onClick={() => handleSave()} disabled={saving} className="btn-primary">
          {saving ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Saving...</> : <><Save className="w-4 h-4 mr-2" />Save Question</>}
        </button>
        <button onClick={() => handleSave(true)} disabled={saving} className="btn-secondary">
          <CheckCircle className="w-4 h-4 mr-2" />Save & Publish
        </button>
        <Link href="/dashboard/questions" className="btn-secondary">Cancel</Link>
      </div>
    </div>
  )
}
