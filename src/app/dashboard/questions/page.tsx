'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useSearchParams, useRouter } from 'next/navigation'
import { Plus, Search, Filter, CheckCircle, FileText, Trash2, Edit2, Loader2, BookOpen, RefreshCw } from 'lucide-react'

interface Question {
  id: string
  category: string
  difficulty: string
  is_active: boolean
  source: string
  created_at: string
  question_data: Record<string, unknown>
}

const CATEGORIES = ['', 'scenario', 'readback', 'jumbled', 'pronunciation']

function questionPreview(q: Question): string {
  const d = q.question_data
  if (q.category === 'readback') return (d.incorrectReadback as string) ?? ''
  if (q.category === 'scenario') return (d.atcClearance as string) ?? ''
  if (q.category === 'jumbled') return ((d.correctOrder as string[]) ?? []).join(' ')
  if (q.category === 'pronunciation') return `${d.display} → ${d.correctPronunciation}`
  return JSON.stringify(d).slice(0, 80)
}

export default function QuestionsPage() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const [questions, setQuestions] = useState<Question[]>([])
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState(searchParams.get('category') ?? '')
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkLoading, setBulkLoading] = useState(false)
  const [toast, setToast] = useState('')

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 3000) }

  const fetchQuestions = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams()
    if (category) params.set('category', category)
    if (status) params.set('status', status)
    params.set('page', String(page))
    const res = await fetch(`/api/questions?${params}`)
    const data = await res.json()
    setQuestions(data.questions ?? [])
    setTotal(data.total ?? 0)
    setTotalPages(data.totalPages ?? 1)
    setLoading(false)
    setSelected(new Set())
  }, [category, status, page])

  useEffect(() => { fetchQuestions() }, [fetchQuestions])

  const toggleSelect = (id: string) => {
    setSelected(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s })
  }
  const selectAll = () => setSelected(questions.length === selected.size ? new Set() : new Set(questions.map(q => q.id)))

  const bulkPublish = async (active: boolean) => {
    setBulkLoading(true)
    await Promise.all(Array.from(selected).map(id => fetch(`/api/questions/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ is_active: active }) })))
    showToast(`${selected.size} question${selected.size !== 1 ? 's' : ''} ${active ? 'published' : 'unpublished'}`)
    setBulkLoading(false)
    fetchQuestions()
  }

  const bulkDelete = async () => {
    if (!confirm(`Delete ${selected.size} question(s)? This cannot be undone.`)) return
    setBulkLoading(true)
    await Promise.all(Array.from(selected).map(id => fetch(`/api/questions/${id}`, { method: 'DELETE' })))
    showToast(`${selected.size} question(s) deleted`)
    setBulkLoading(false)
    fetchQuestions()
  }

  const toggleActive = async (q: Question) => {
    await fetch(`/api/questions/${q.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ is_active: !q.is_active }) })
    showToast(`Question ${!q.is_active ? 'published' : 'unpublished'}`)
    fetchQuestions()
  }

  const filtered = search ? questions.filter(q => questionPreview(q).toLowerCase().includes(search.toLowerCase())) : questions

  return (
    <div className="space-y-6">
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 px-4 py-3 bg-gray-900 text-white text-sm rounded-xl shadow-lg flex items-center gap-2">
          <CheckCircle className="w-4 h-4 text-green-400" />{toast}
        </div>
      )}

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Questions</h1>
          <p className="text-sm text-gray-500">{total} total questions</p>
        </div>
        <div className="flex gap-2">
          <Link href="/dashboard/questions/from-analysis" className="btn-secondary">Generate from Analysis</Link>
          <Link href="/dashboard/questions/new" className="btn-primary"><Plus className="w-4 h-4 mr-1" />New Question</Link>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search questions..."
            className="input-field pl-9 w-60" />
        </div>
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-gray-400" />
          <select value={category} onChange={e => { setCategory(e.target.value); setPage(1) }} className="input-field w-auto">
            <option value="">All Categories</option>
            {CATEGORIES.filter(Boolean).map(c => <option key={c} value={c} className="capitalize">{c}</option>)}
          </select>
          <select value={status} onChange={e => { setStatus(e.target.value); setPage(1) }} className="input-field w-auto">
            <option value="">All Status</option>
            <option value="published">Published</option>
            <option value="draft">Draft</option>
          </select>
        </div>
        <button onClick={fetchQuestions} className="btn-secondary px-3 py-2"><RefreshCw className="w-4 h-4" /></button>
      </div>

      {/* Bulk actions */}
      {selected.size > 0 && (
        <div className="flex items-center gap-3 px-4 py-3 bg-primary-50 border border-primary-200 rounded-xl">
          <span className="text-sm font-medium text-primary-700">{selected.size} selected</span>
          <button onClick={() => bulkPublish(true)} disabled={bulkLoading} className="btn-primary text-xs px-3 py-1.5">
            {bulkLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle className="w-3 h-3 mr-1" />}Publish
          </button>
          <button onClick={() => bulkPublish(false)} disabled={bulkLoading} className="btn-secondary text-xs px-3 py-1.5">Unpublish</button>
          <button onClick={bulkDelete} disabled={bulkLoading} className="btn-danger text-xs px-3 py-1.5">
            <Trash2 className="w-3 h-3 mr-1" />Delete
          </button>
        </div>
      )}

      {/* Table */}
      <div className="card overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-gray-400">
            <Loader2 className="w-6 h-6 animate-spin mr-2" />Loading questions...
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-gray-400">
            <BookOpen className="w-10 h-10 mb-3" />
            <p className="font-medium">No questions found</p>
            <p className="text-sm mt-1">Try adjusting your filters or create a new question</p>
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="w-10 px-4 py-3">
                  <input type="checkbox" checked={selected.size === questions.length && questions.length > 0}
                    onChange={selectAll} className="rounded" />
                </th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Question</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase w-28">Category</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase w-24">Difficulty</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase w-24">Status</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase w-20">Source</th>
                <th className="w-24 px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map(q => (
                <tr key={q.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3">
                    <input type="checkbox" checked={selected.has(q.id)} onChange={() => toggleSelect(q.id)} className="rounded" />
                  </td>
                  <td className="px-4 py-3">
                    <p className="text-sm text-gray-900 line-clamp-1">{questionPreview(q)}</p>
                  </td>
                  <td className="px-4 py-3">
                    <span className="badge bg-gray-100 text-gray-700 capitalize">{q.category}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`badge capitalize ${q.difficulty === 'easy' ? 'bg-green-100 text-green-700' : q.difficulty === 'hard' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>{q.difficulty}</span>
                  </td>
                  <td className="px-4 py-3">
                    <button onClick={() => toggleActive(q)}
                      className={`badge cursor-pointer transition-colors ${q.is_active ? 'bg-green-100 text-green-700 hover:bg-green-200' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>
                      {q.is_active ? <><CheckCircle className="w-3 h-3 mr-1" />Published</> : <><FileText className="w-3 h-3 mr-1" />Draft</>}
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-xs text-gray-400 capitalize">{q.source}</span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <Link href={`/dashboard/questions/${q.id}`} className="p-1.5 text-gray-400 hover:text-primary-600 hover:bg-primary-50 rounded-lg transition-colors">
                        <Edit2 className="w-3.5 h-3.5" />
                      </Link>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
            <span className="text-sm text-gray-500">Page {page} of {totalPages}</span>
            <div className="flex gap-2">
              <button disabled={page === 1} onClick={() => setPage(p => p - 1)} className="btn-secondary text-xs px-3 py-1.5 disabled:opacity-40">Previous</button>
              <button disabled={page === totalPages} onClick={() => setPage(p => p + 1)} className="btn-secondary text-xs px-3 py-1.5 disabled:opacity-40">Next</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
