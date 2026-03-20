'use client'

import { useState, useEffect, useCallback, Suspense } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Plus, Search, CheckCircle, FileText, Trash2, Edit2, Loader2, BookOpen, RefreshCw, FileUp } from 'lucide-react'
import ScrollToTop from '@/components/ScrollToTop'

interface Question {
  id: string
  category: string
  is_active: boolean
  source: string
  created_at: string
  question_data: Record<string, unknown>
}

function questionPreview(q: Question): string {
  const d = q.question_data
  if (q.category === 'readback') return (d.incorrectReadback as string) ?? ''
  if (q.category === 'scenario') return (d.atcClearance as string) ?? ''
  if (q.category === 'jumbled') return (d.instruction as string) ?? ((d.correctOrder as string[]) ?? []).slice(0, 3).join(' ') + '…'
  if (q.category === 'pronunciation') return d.type === 'question' ? (d.display as string) ?? '' : `"${d.display}" — which ICAO pronunciation is correct?`
  return JSON.stringify(d).slice(0, 80)
}

const CARD_STYLES: Record<string, { border: string; badge: string; label: string }> = {
  readback:     { border: 'border-l-4 border-l-amber-400',   badge: 'bg-amber-100 text-amber-700',   label: 'Readback' },
  scenario:     { border: 'border-l-4 border-l-blue-400',    badge: 'bg-blue-100 text-blue-700',     label: 'Scenario' },
  jumbled:      { border: 'border-l-4 border-l-violet-400',  badge: 'bg-violet-100 text-violet-700', label: 'Jumbled' },
  pronunciation:{ border: 'border-l-4 border-l-emerald-400', badge: 'bg-emerald-100 text-emerald-700', label: 'Pronunciation' },
}

const PAGE_SIZE = 10

// ── Per-category card ──────────────────────────────────────────────────────────

function CategoryCard({
  category, search, status, refreshKey, onToast,
}: {
  category: string
  search: string
  status: string
  refreshKey: number
  onToast: (msg: string) => void
}) {
  const [questions, setQuestions] = useState<Question[]>([])
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkLoading, setBulkLoading] = useState(false)

  const style = CARD_STYLES[category]

  const fetchQuestions = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams()
    params.set('category', category)
    if (status) params.set('status', status)
    if (search) params.set('search', search)
    params.set('page', String(page))
    params.set('limit', String(PAGE_SIZE))
    const res = await fetch(`/api/questions?${params}`)
    const data = await res.json()
    setQuestions(data.questions ?? [])
    setTotal(data.total ?? 0)
    setTotalPages(data.totalPages ?? 1)
    setLoading(false)
    setSelected(new Set())
  }, [category, search, status, page, refreshKey]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { fetchQuestions() }, [fetchQuestions])

  // Reset to page 1 when filters change
  useEffect(() => { setPage(1) }, [search, status, refreshKey])

  const toggleSelect = (id: string) =>
    setSelected(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s })
  const selectAll = () =>
    setSelected(questions.length === selected.size ? new Set() : new Set(questions.map(q => q.id)))

  const bulkPublish = async (active: boolean) => {
    setBulkLoading(true)
    await Promise.allSettled(Array.from(selected).map(id =>
      fetch(`/api/questions/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ is_active: active }) })
    ))
    onToast(`${selected.size} ${active ? 'published' : 'unpublished'}`)
    setBulkLoading(false)
    fetchQuestions()
  }

  const bulkDelete = async () => {
    if (!confirm(`Delete ${selected.size} question(s)? This cannot be undone.`)) return
    setBulkLoading(true)
    await Promise.allSettled(Array.from(selected).map(id =>
      fetch(`/api/questions/${id}`, { method: 'DELETE' })
    ))
    onToast(`${selected.size} deleted`)
    setBulkLoading(false)
    fetchQuestions()
  }

  const deleteOne = async (q: Question) => {
    if (!confirm('Delete this question? This cannot be undone.')) return
    await fetch(`/api/questions/${q.id}`, { method: 'DELETE' })
    onToast('Question deleted')
    fetchQuestions()
  }

  const toggleActive = async (q: Question) => {
    await fetch(`/api/questions/${q.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ is_active: !q.is_active }) })
    onToast(`Question ${!q.is_active ? 'published' : 'unpublished'}`)
    fetchQuestions()
  }

  return (
    <div className={`card overflow-hidden flex flex-col ${style.border}`}>
      {/* Card header */}
      <div className="px-4 py-3 border-b border-gray-100 bg-gray-50 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className={`badge text-xs capitalize shrink-0 ${style.badge}`}>{style.label}</span>
          <span className="text-xs text-gray-400 shrink-0">{total} total</span>
        </div>
        <input
          type="checkbox"
          checked={selected.size === questions.length && questions.length > 0}
          onChange={selectAll}
          className="rounded shrink-0"
          title="Select all on page"
        />
      </div>

      {/* Bulk actions bar */}
      {selected.size > 0 && (
        <div className="flex items-center gap-1.5 px-3 py-2 bg-primary-50 border-b border-primary-200 flex-wrap">
          <span className="text-xs font-medium text-primary-700 mr-1">{selected.size} sel.</span>
          <button onClick={() => bulkPublish(true)} disabled={bulkLoading} className="btn-primary text-xs px-2 py-1">
            {bulkLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Publish'}
          </button>
          <button onClick={() => bulkPublish(false)} disabled={bulkLoading} className="btn-secondary text-xs px-2 py-1">Unpub.</button>
          <button onClick={bulkDelete} disabled={bulkLoading} className="btn-danger text-xs px-2 py-1">
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      )}

      {/* Body */}
      <div className="flex-1 divide-y divide-gray-100">
        {loading ? (
          <div className="flex items-center justify-center py-10 text-gray-400">
            <Loader2 className="w-5 h-5 animate-spin mr-2" />Loading…
          </div>
        ) : questions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-gray-400 text-sm">
            <BookOpen className="w-7 h-7 mb-2" />
            <p>No questions</p>
          </div>
        ) : (
          questions.map(q => (
            <div key={q.id} className="flex items-start gap-2 px-3 py-2.5 hover:bg-gray-50 transition-colors group">
              <input
                type="checkbox"
                checked={selected.has(q.id)}
                onChange={() => toggleSelect(q.id)}
                className="rounded mt-0.5 shrink-0"
              />
              <div className="flex-1 min-w-0">
                <p className="text-xs text-gray-800 line-clamp-2 leading-snug">{questionPreview(q)}</p>
                <div className="flex items-center gap-1.5 mt-1">
                  <button
                    onClick={() => toggleActive(q)}
                    className={`inline-flex items-center gap-0.5 text-xs px-1.5 py-0.5 rounded-full font-medium transition-colors cursor-pointer ${
                      q.is_active ? 'bg-green-100 text-green-700 hover:bg-green-200' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                    }`}
                  >
                    {q.is_active ? <><CheckCircle className="w-2.5 h-2.5" />Pub</> : <><FileText className="w-2.5 h-2.5" />Draft</>}
                  </button>
                  <span className="text-xs text-gray-300 capitalize">{q.source}</span>
                </div>
              </div>
              <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                <Link
                  href={`/dashboard/questions/${q.id}`}
                  className="p-1 text-gray-400 hover:text-primary-600 hover:bg-primary-50 rounded transition-colors"
                >
                  <Edit2 className="w-3 h-3" />
                </Link>
                <button
                  onClick={() => deleteOne(q)}
                  className="p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Pagination — always visible */}
      <div className="flex items-center justify-between px-3 py-2 border-t border-gray-100 bg-gray-50">
        <span className="text-xs text-gray-400">Page {page} of {totalPages || 1}</span>
        <div className="flex gap-1">
          <button
            disabled={page === 1}
            onClick={() => setPage(p => p - 1)}
            className="btn-secondary text-xs px-2 py-1 disabled:opacity-40"
          >‹</button>
          <button
            disabled={page >= totalPages}
            onClick={() => setPage(p => p + 1)}
            className="btn-secondary text-xs px-2 py-1 disabled:opacity-40"
          >›</button>
        </div>
      </div>
    </div>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────────

function QuestionsPageInner() {
  const searchParams = useSearchParams()
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [status, setStatus] = useState(searchParams.get('status') ?? '')
  const [categoryFilter, setCategoryFilter] = useState(searchParams.get('category') ?? '')
  const [refreshKey, setRefreshKey] = useState(0)
  const [toast, setToast] = useState('')

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 3000) }

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 350)
    return () => clearTimeout(t)
  }, [search])

  const ALL_CATS = ['readback', 'scenario', 'jumbled', 'pronunciation']
  const searchAsCategory = ALL_CATS.find(c => c === debouncedSearch.toLowerCase().trim()) ?? ''
  const visibleCats = ALL_CATS.filter(cat =>
    (!categoryFilter || cat === categoryFilter) &&
    (!searchAsCategory || cat === searchAsCategory)
  )
  // When the search text IS a category name, don't send it as content search
  const contentSearch = searchAsCategory ? '' : debouncedSearch

  return (
    <div className="space-y-5">
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 px-4 py-3 bg-gray-900 text-white text-sm rounded-xl shadow-lg flex items-center gap-2">
          <CheckCircle className="w-4 h-4 text-green-400" />{toast}
        </div>
      )}

      <ScrollToTop />

      {/* Header */}
      <div className="flex flex-wrap items-start sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Questions</h1>
          <p className="text-sm text-gray-500">Manage training questions by category</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/dashboard/questions/from-analysis" className="btn-secondary">
            <span className="hidden sm:inline">Generate from Analysis</span>
            <span className="sm:hidden">From Analysis</span>
          </Link>
          <Link href="/dashboard/questions/import-pdf" className="btn-secondary">
            <FileUp className="w-4 h-4 mr-1" />
            <span className="hidden sm:inline">Import PDF</span>
            <span className="sm:hidden">PDF</span>
          </Link>
          <Link href="/dashboard/questions/new" className="btn-primary">
            <Plus className="w-4 h-4 mr-1" />
            <span className="hidden sm:inline">New Question</span>
            <span className="sm:hidden">New</span>
          </Link>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search all categories…"
            className="input-field pl-9 w-full sm:w-64"
          />
        </div>
        <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)} className="input-field w-auto">
          <option value="">All Categories</option>
          <option value="readback">Readback</option>
          <option value="scenario">Scenario</option>
          <option value="jumbled">Jumbled</option>
          <option value="pronunciation">Pronunciation</option>
        </select>
        <select value={status} onChange={e => setStatus(e.target.value)} className="input-field w-auto">
          <option value="">All Status</option>
          <option value="published">Published</option>
          <option value="draft">Draft</option>
        </select>
        <button onClick={() => setRefreshKey(k => k + 1)} className="btn-secondary px-3 py-2" title="Refresh all">
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {/* 4-column category cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {visibleCats.map(cat => (
          <CategoryCard
            key={cat}
            category={cat}
            search={contentSearch}
            status={status}
            refreshKey={refreshKey}
            onToast={showToast}
          />
        ))}
      </div>
    </div>
  )
}

export default function QuestionsPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center py-16 text-gray-400">
        <Loader2 className="w-6 h-6 animate-spin mr-2" />Loading…
      </div>
    }>
      <QuestionsPageInner />
    </Suspense>
  )
}
