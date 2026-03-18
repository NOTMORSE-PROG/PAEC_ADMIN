import { getAdminStats } from '@/lib/database'
import { BookOpen, Users, CheckCircle, FileText, FileUp } from 'lucide-react'
import Link from 'next/link'

export default async function OverviewPage() {
  const stats = await getAdminStats()

  const cards = [
    { label: 'Total Questions', value: stats.totalQuestions, icon: BookOpen, color: 'text-primary-600 bg-primary-50' },
    { label: 'Published', value: stats.activeQuestions, icon: CheckCircle, color: 'text-green-600 bg-green-50' },
    { label: 'Drafts', value: stats.draftQuestions, icon: FileText, color: 'text-amber-600 bg-amber-50' },
    { label: 'Total Users', value: stats.totalUsers, icon: Users, color: 'text-indigo-600 bg-indigo-50' },
  ]

  const CATEGORIES = ['scenario', 'readback', 'jumbled', 'pronunciation']

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 mb-1">Overview</h1>
        <p className="text-gray-500 text-sm">Training question pool status</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map(c => (
          <div key={c.label} className="card p-5">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center mb-3 ${c.color}`}>
              <c.icon className="w-5 h-5" />
            </div>
            <div className="text-2xl font-bold text-gray-900">{c.value}</div>
            <div className="text-sm text-gray-500">{c.label}</div>
          </div>
        ))}
      </div>

      {/* Per category */}
      <div className="card overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-900">Questions by Category</h2>
        </div>
        <div className="divide-y divide-gray-100">
          {CATEGORIES.map(cat => {
            const row = stats.byCategory.find(r => r.category === cat)
            const total = row?.total ?? 0
            const active = row?.active ?? 0
            const pct = total > 0 ? Math.round(active / total * 100) : 0
            const ready = active >= 10
            return (
              <div key={cat} className="flex items-center justify-between px-6 py-4">
                <div className="flex items-center gap-3">
                  <span className="capitalize font-medium text-gray-900 w-28">{cat}</span>
                  <span className={`badge ${ready ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                    {ready ? `${active} published` : `${active} published — needs ${10 - active} more`}
                  </span>
                </div>
                <div className="flex items-center gap-4">
                  <div className="w-32 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full bg-primary-500 rounded-full" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="text-sm text-gray-500 w-16 text-right">{total} total</span>
                  <Link href={`/dashboard/questions?category=${cat}`} className="btn-secondary text-xs px-3 py-1.5">Manage</Link>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Quick actions */}
      <div className="grid sm:grid-cols-3 gap-4">
        <Link href="/dashboard/questions/new" className="card p-5 hover:shadow-md transition-shadow flex items-center gap-4">
          <div className="w-10 h-10 bg-primary-100 rounded-xl flex items-center justify-center">
            <BookOpen className="w-5 h-5 text-primary-600" />
          </div>
          <div>
            <div className="font-medium text-gray-900">Create Question</div>
            <div className="text-sm text-gray-500">Manually write a new question</div>
          </div>
        </Link>
        <Link href="/dashboard/questions/from-analysis" className="card p-5 hover:shadow-md transition-shadow flex items-center gap-4">
          <div className="w-10 h-10 bg-emerald-100 rounded-xl flex items-center justify-center">
            <FileText className="w-5 h-5 text-emerald-600" />
          </div>
          <div>
            <div className="font-medium text-gray-900">Generate from Analysis</div>
            <div className="text-sm text-gray-500">Upload CSV → auto-generate candidates</div>
          </div>
        </Link>
        <Link href="/dashboard/questions/import-pdf" className="card p-5 hover:shadow-md transition-shadow flex items-center gap-4">
          <div className="w-10 h-10 bg-orange-100 rounded-xl flex items-center justify-center">
            <FileUp className="w-5 h-5 text-orange-600" />
          </div>
          <div>
            <div className="font-medium text-gray-900">Import from PDF</div>
            <div className="text-sm text-gray-500">Upload Q&amp;A PDF → identification questions</div>
          </div>
        </Link>
      </div>
    </div>
  )
}
