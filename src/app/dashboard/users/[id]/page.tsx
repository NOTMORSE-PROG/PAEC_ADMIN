'use client'

import { useState, useEffect, useCallback } from 'react'
import { ArrowLeft, User, Shield, ChevronDown, ChevronRight, Loader2, BookOpen } from 'lucide-react'
import Link from 'next/link'
import { useParams } from 'next/navigation'

interface UserData {
  id: string
  name: string
  email: string
  role: string
  created_at: string
}

interface Session {
  id: string
  category: string
  question_ids: string[]
  answers: Record<string, string>
  question_scores: Record<string, number>
  score: number
  completed_at: string
  started_at: string
}

const CATEGORY_COLORS: Record<string, string> = {
  scenario: 'bg-blue-100 text-blue-700',
  readback: 'bg-purple-100 text-purple-700',
  jumbled: 'bg-orange-100 text-orange-700',
  pronunciation: 'bg-green-100 text-green-700',
}

export default function UserDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [user, setUser] = useState<UserData | null>(null)
  const [sessions, setSessions] = useState<Session[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    setLoading(true)
    const res = await fetch(`/api/users/${id}/sessions`)
    if (res.ok) {
      const data = await res.json()
      setUser(data.user)
      setSessions(data.sessions)
    }
    setLoading(false)
  }, [id])

  useEffect(() => { fetchData() }, [fetchData])

  const toggle = (sessionId: string) =>
    setExpandedId(prev => (prev === sessionId ? null : sessionId))

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-gray-400">
        <Loader2 className="w-6 h-6 animate-spin mr-2" />Loading user data...
      </div>
    )
  }

  if (!user) {
    return (
      <div className="space-y-4">
        <Link href="/dashboard/users" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700">
          <ArrowLeft className="w-4 h-4" />Back to Users
        </Link>
        <p className="text-gray-500">User not found.</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Back link */}
      <Link href="/dashboard/users" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700">
        <ArrowLeft className="w-4 h-4" />Back to Users
      </Link>

      {/* User header */}
      <div className="card p-6 flex items-center gap-5">
        <div className="w-14 h-14 bg-primary-100 rounded-full flex items-center justify-center text-primary-700 font-bold text-xl flex-shrink-0">
          {user.name?.charAt(0)?.toUpperCase() ?? '?'}
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold text-gray-900">{user.name || '—'}</h1>
          <p className="text-sm text-gray-500">{user.email}</p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <span className={`badge flex items-center gap-1 ${user.role === 'admin' ? 'bg-primary-100 text-primary-700' : 'bg-gray-100 text-gray-600'}`}>
            {user.role === 'admin' ? <Shield className="w-3 h-3" /> : <User className="w-3 h-3" />}
            {user.role}
          </span>
          <span className="text-xs text-gray-400">
            Joined {new Date(user.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
          </span>
        </div>
      </div>

      {/* Sessions */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-semibold text-gray-900">Training Sessions</h2>
          <span className="text-sm text-gray-500">{sessions.length} completed</span>
        </div>

        {sessions.length === 0 ? (
          <div className="card flex flex-col items-center justify-center py-16 text-gray-400">
            <BookOpen className="w-10 h-10 mb-3" />
            <p>No completed sessions yet</p>
          </div>
        ) : (
          <div className="space-y-2">
            {sessions.map(session => {
              const isOpen = expandedId === session.id
              const questionIds: string[] = Array.isArray(session.question_ids)
                ? session.question_ids
                : []
              const answers = session.answers ?? {}
              const scores = session.question_scores ?? {}

              return (
                <div key={session.id} className="card overflow-hidden">
                  {/* Row header — clickable */}
                  <button
                    onClick={() => toggle(session.id)}
                    className="w-full flex items-center gap-4 px-5 py-4 text-left hover:bg-gray-50 transition-colors"
                  >
                    <span className={`badge text-xs font-semibold capitalize ${CATEGORY_COLORS[session.category] ?? 'bg-gray-100 text-gray-600'}`}>
                      {session.category}
                    </span>
                    <div className="flex-1 min-w-0">
                      <span className="text-sm text-gray-700 font-medium">
                        Score: {session.score ?? 0}%
                      </span>
                      <span className="text-xs text-gray-400 ml-3">
                        {questionIds.length} question{questionIds.length !== 1 ? 's' : ''}
                      </span>
                    </div>
                    <span className="text-xs text-gray-400 flex-shrink-0">
                      {new Date(session.completed_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </span>
                    {isOpen ? <ChevronDown className="w-4 h-4 text-gray-400 flex-shrink-0" /> : <ChevronRight className="w-4 h-4 text-gray-400 flex-shrink-0" />}
                  </button>

                  {/* Expanded answers table */}
                  {isOpen && (
                    <div className="border-t border-gray-100 overflow-x-auto">
                      <table className="w-full min-w-[400px]">
                        <thead>
                          <tr className="bg-gray-50 border-b border-gray-100">
                            <th className="text-left px-5 py-2 text-xs font-semibold text-gray-500 uppercase w-8">#</th>
                            <th className="text-left px-5 py-2 text-xs font-semibold text-gray-500 uppercase">User Answer</th>
                            <th className="text-left px-5 py-2 text-xs font-semibold text-gray-500 uppercase w-20">Score</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50">
                          {questionIds.map((qid, idx) => {
                            const answer = answers[qid]
                            const score = scores[qid]
                            return (
                              <tr key={qid} className="hover:bg-gray-50/50">
                                <td className="px-5 py-3 text-xs text-gray-400">{idx + 1}</td>
                                <td className="px-5 py-3 text-sm text-gray-800 break-words">
                                  {answer !== undefined && answer !== null && answer !== ''
                                    ? String(answer)
                                    : <span className="italic text-gray-400">no answer</span>}
                                </td>
                                <td className="px-5 py-3 text-sm">
                                  {score !== undefined ? (
                                    <span className={`font-medium ${score >= 70 ? 'text-green-600' : score >= 40 ? 'text-yellow-600' : 'text-red-500'}`}>
                                      {score}%
                                    </span>
                                  ) : (
                                    <span className="text-gray-400">—</span>
                                  )}
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
