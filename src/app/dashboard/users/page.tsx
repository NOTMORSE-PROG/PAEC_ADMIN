'use client'

import { useState, useEffect, useCallback } from 'react'
import { Shield, User, Loader2, CheckCircle, RefreshCw } from 'lucide-react'

interface UserRow {
  id: string
  name: string
  email: string
  role: string
  created_at: string
  session_count: number
}

export default function UsersPage() {
  const [users, setUsers] = useState<UserRow[]>([])
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState('')
  const [updatingId, setUpdatingId] = useState<string | null>(null)

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 3000) }

  const fetchUsers = useCallback(async () => {
    setLoading(true)
    const res = await fetch('/api/users')
    const data = await res.json()
    setUsers(data.users ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { fetchUsers() }, [fetchUsers])

  const toggleRole = async (user: UserRow) => {
    const newRole = user.role === 'admin' ? 'student' : 'admin'
    setUpdatingId(user.id)
    const res = await fetch(`/api/users/${user.id}/role`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: newRole }),
    })
    if (res.ok) {
      setUsers(prev => prev.map(u => u.id === user.id ? { ...u, role: newRole } : u))
      showToast(`${user.name} is now a${newRole === 'admin' ? 'n admin' : ' student'}`)
    } else {
      const d = await res.json()
      showToast(d.error ?? 'Failed to update role')
    }
    setUpdatingId(null)
  }

  return (
    <div className="space-y-6">
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 px-4 py-3 bg-gray-900 text-white text-sm rounded-xl shadow-lg flex items-center gap-2">
          <CheckCircle className="w-4 h-4 text-green-400" />{toast}
        </div>
      )}

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Users</h1>
          <p className="text-sm text-gray-500">{users.length} registered users</p>
        </div>
        <button onClick={fetchUsers} className="btn-secondary px-3 py-2"><RefreshCw className="w-4 h-4" /></button>
      </div>

      <div className="card overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-gray-400">
            <Loader2 className="w-6 h-6 animate-spin mr-2" />Loading users...
          </div>
        ) : users.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-gray-400">
            <User className="w-10 h-10 mb-3" />
            <p>No users found</p>
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase">Name</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase">Email</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase w-24">Role</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase w-24">Sessions</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase w-28">Joined</th>
                <th className="w-32 px-5 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {users.map(user => (
                <tr key={user.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 bg-primary-100 rounded-full flex items-center justify-center text-primary-700 font-semibold text-sm">
                        {user.name?.charAt(0)?.toUpperCase() ?? '?'}
                      </div>
                      <span className="font-medium text-gray-900 text-sm">{user.name || '—'}</span>
                    </div>
                  </td>
                  <td className="px-5 py-4 text-sm text-gray-600">{user.email}</td>
                  <td className="px-5 py-4">
                    <span className={`badge ${user.role === 'admin' ? 'bg-primary-100 text-primary-700' : 'bg-gray-100 text-gray-600'} flex items-center gap-1 w-fit`}>
                      {user.role === 'admin' ? <Shield className="w-3 h-3" /> : <User className="w-3 h-3" />}
                      {user.role}
                    </span>
                  </td>
                  <td className="px-5 py-4 text-sm text-gray-600">{user.session_count}</td>
                  <td className="px-5 py-4 text-sm text-gray-500">
                    {new Date(user.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </td>
                  <td className="px-5 py-4">
                    <button
                      onClick={() => toggleRole(user)}
                      disabled={updatingId === user.id}
                      className={`text-xs font-medium px-3 py-1.5 rounded-lg border transition-colors disabled:opacity-50 ${
                        user.role === 'admin'
                          ? 'border-red-200 text-red-600 hover:bg-red-50'
                          : 'border-primary-200 text-primary-600 hover:bg-primary-50'
                      }`}
                    >
                      {updatingId === user.id ? <Loader2 className="w-3 h-3 animate-spin inline" /> :
                        user.role === 'admin' ? 'Remove Admin' : 'Make Admin'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
