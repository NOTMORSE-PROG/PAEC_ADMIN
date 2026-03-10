'use client'

import { useState, useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { ArrowLeft, Save, Trash2, Loader2, CheckCircle, XCircle } from 'lucide-react'
import Link from 'next/link'

interface Question {
  id: string
  category: string
  difficulty: string
  is_active: boolean
  source: string
  question_data: Record<string, unknown>
  created_at: string
}

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

  // Editable data
  const [difficulty, setDifficulty] = useState('medium')
  const [isActive, setIsActive] = useState(false)
  const [questionData, setQuestionData] = useState('{}')
  const [jsonError, setJsonError] = useState('')

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 3000) }

  useEffect(() => {
    fetch(`/api/questions/${id}`)
      .then(r => r.json())
      .then(d => {
        if (d.question) {
          setQuestion(d.question)
          setDifficulty(d.question.difficulty)
          setIsActive(d.question.is_active)
          setQuestionData(JSON.stringify(d.question.question_data, null, 2))
        }
      })
      .catch(() => setError('Failed to load question'))
      .finally(() => setLoading(false))
  }, [id])

  const handleSave = async () => {
    setJsonError('')
    let parsed: Record<string, unknown>
    try { parsed = JSON.parse(questionData) } catch { setJsonError('Invalid JSON in question data'); return }
    setSaving(true); setError('')
    try {
      const res = await fetch(`/api/questions/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ difficulty, is_active: isActive, question_data: parsed }),
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

  const previewText = (() => {
    const d = question.question_data
    if (question.category === 'readback') return (d.incorrectReadback as string) ?? ''
    if (question.category === 'scenario') return (d.atcClearance as string) ?? ''
    if (question.category === 'jumbled') return ((d.correctOrder as string[]) ?? []).join(' ')
    if (question.category === 'pronunciation') return `${d.display} → ${d.correctPronunciation}`
    return ''
  })()

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

      <div className="card p-5 text-sm text-gray-600 bg-gray-50">
        <span className="font-medium text-gray-700">Preview: </span>{previewText || '—'}
      </div>

      <div className="card p-6 space-y-5">
        <div className="grid grid-cols-2 gap-4">
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
              <span className="text-sm font-medium text-gray-700">Published (visible to students)</span>
            </label>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Question Data (JSON)</label>
          <textarea value={questionData} onChange={e => setQuestionData(e.target.value)}
            className={`input-field font-mono text-xs resize-y ${jsonError ? 'border-red-400' : ''}`} rows={12} />
          {jsonError && <p className="text-xs text-red-600 mt-1">{jsonError}</p>}
          <p className="text-xs text-gray-400 mt-1">Edit the JSON directly. Make sure it is valid JSON before saving.</p>
        </div>
      </div>

      <div className="flex gap-3">
        <button onClick={handleSave} disabled={saving} className="btn-primary">
          {saving ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Saving...</> : <><Save className="w-4 h-4 mr-2" />Save Changes</>}
        </button>
        <button onClick={() => { setIsActive(!isActive); setTimeout(handleSave, 100) }} className="btn-secondary">
          {isActive ? <><XCircle className="w-4 h-4 mr-1" />Unpublish</> : <><CheckCircle className="w-4 h-4 mr-1" />Publish</>}
        </button>
      </div>

      {/* Delete zone */}
      <div className="card p-6 border-red-200 space-y-4">
        <h3 className="font-semibold text-red-700">Delete Question</h3>
        <p className="text-sm text-gray-600">This action is irreversible. Type <strong>delete</strong> to confirm.</p>
        <div className="flex gap-3">
          <input value={deleteConfirm} onChange={e => setDeleteConfirm(e.target.value)}
            className="input-field flex-1" placeholder='Type "delete" to confirm' />
          <button onClick={handleDelete} disabled={deleteConfirm !== 'delete' || deleting} className="btn-danger disabled:opacity-40">
            {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4 mr-1" />}Delete
          </button>
        </div>
      </div>
    </div>
  )
}
