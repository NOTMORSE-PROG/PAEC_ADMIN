'use client'

import { useState } from 'react'
import { useSession } from 'next-auth/react'
import { KeyRound, Mail, Loader2, CheckCircle, AlertCircle, Eye, EyeOff } from 'lucide-react'

export default function SettingsPage() {
  // ── Change Password ──────────────────────────────────────────────────────
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showCurrent, setShowCurrent] = useState(false)
  const [showNext, setShowNext] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [pwLoading, setPwLoading] = useState(false)
  const [pwError, setPwError] = useState('')
  const [pwSuccess, setPwSuccess] = useState(false)

  // ── Change Email ─────────────────────────────────────────────────────────
  const { data: session } = useSession()
  const currentEmail = (session?.user as { email?: string })?.email ?? ''

  const [newEmail, setNewEmail] = useState('')
  const [confirmEmail, setConfirmEmail] = useState('')
  const [emailPassword, setEmailPassword] = useState('')
  const [showEmailPw, setShowEmailPw] = useState(false)
  const [emailLoading, setEmailLoading] = useState(false)
  const [emailError, setEmailError] = useState('')
  const [emailSuccess, setEmailSuccess] = useState(false)

  // ── Handlers ─────────────────────────────────────────────────────────────
  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setPwError(''); setPwSuccess(false)

    if (next !== confirm) { setPwError('New passwords do not match.'); return }
    if (next.length < 8) { setPwError('New password must be at least 8 characters.'); return }

    setPwLoading(true)
    const res = await fetch('/api/admin/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword: current, newPassword: next }),
    })
    const data = await res.json()
    setPwLoading(false)

    if (!res.ok) { setPwError(data.error ?? 'Failed to change password.'); return }

    setPwSuccess(true)
    setCurrent(''); setNext(''); setConfirm('')
  }

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setEmailError(''); setEmailSuccess(false)

    // Client-side restrictive measures
    const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRe.test(newEmail)) { setEmailError('Invalid email format.'); return }
    if (newEmail !== confirmEmail) { setEmailError('Email addresses do not match.'); return }
    if (newEmail.toLowerCase() === currentEmail.toLowerCase()) {
      setEmailError('New email must be different from your current email.'); return
    }
    if (!emailPassword) { setEmailError('Current password is required.'); return }

    setEmailLoading(true)
    const res = await fetch('/api/admin/change-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword: emailPassword, newEmail }),
    })
    const data = await res.json()
    setEmailLoading(false)

    if (!res.ok) { setEmailError(data.error ?? 'Failed to change email.'); return }

    setEmailSuccess(true)
    setNewEmail(''); setConfirmEmail(''); setEmailPassword('')
  }

  return (
    <div className="max-w-md space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
        <p className="text-sm text-gray-500">Manage your admin account</p>
      </div>

      {/* ── Change Password ── */}
      <div className="card p-6 space-y-5">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-primary-100 rounded-xl flex items-center justify-center">
            <KeyRound className="w-5 h-5 text-primary-600" />
          </div>
          <div>
            <p className="font-semibold text-gray-900">Change Password</p>
            <p className="text-xs text-gray-500">Minimum 8 characters</p>
          </div>
        </div>

        {pwSuccess && (
          <div className="flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-lg text-green-700 text-sm">
            <CheckCircle className="w-4 h-4 shrink-0" />Password changed successfully.
          </div>
        )}
        {pwError && (
          <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
            <AlertCircle className="w-4 h-4 shrink-0" />{pwError}
          </div>
        )}

        <form onSubmit={handlePasswordSubmit} className="space-y-4">
          {[
            { label: 'Current Password', value: current, set: setCurrent, show: showCurrent, toggle: () => setShowCurrent(v => !v) },
            { label: 'New Password', value: next, set: setNext, show: showNext, toggle: () => setShowNext(v => !v) },
            { label: 'Confirm New Password', value: confirm, set: setConfirm, show: showConfirm, toggle: () => setShowConfirm(v => !v) },
          ].map(({ label, value, set, show, toggle }) => (
            <div key={label}>
              <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
              <div className="relative">
                <input
                  type={show ? 'text' : 'password'}
                  value={value}
                  onChange={e => set(e.target.value)}
                  required
                  className="input-field pr-10"
                />
                <button
                  type="button"
                  onClick={toggle}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
          ))}

          <button type="submit" disabled={pwLoading} className="btn-primary w-full">
            {pwLoading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Updating...</> : 'Update Password'}
          </button>
        </form>
      </div>

      {/* ── Change Email ── */}
      <div className="card p-6 space-y-5">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-primary-100 rounded-xl flex items-center justify-center">
            <Mail className="w-5 h-5 text-primary-600" />
          </div>
          <div>
            <p className="font-semibold text-gray-900">Change Email</p>
            <p className="text-xs text-gray-500">Current: {currentEmail || '—'}</p>
          </div>
        </div>

        {emailSuccess && (
          <div className="flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-lg text-green-700 text-sm">
            <CheckCircle className="w-4 h-4 shrink-0" />Email changed successfully. Please sign in again with your new email.
          </div>
        )}
        {emailError && (
          <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
            <AlertCircle className="w-4 h-4 shrink-0" />{emailError}
          </div>
        )}

        <form onSubmit={handleEmailSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">New Email</label>
            <input
              type="email"
              value={newEmail}
              onChange={e => setNewEmail(e.target.value)}
              required
              className="input-field"
              placeholder="new@example.com"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Confirm New Email</label>
            <input
              type="email"
              value={confirmEmail}
              onChange={e => setConfirmEmail(e.target.value)}
              required
              className="input-field"
              placeholder="new@example.com"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Current Password</label>
            <div className="relative">
              <input
                type={showEmailPw ? 'text' : 'password'}
                value={emailPassword}
                onChange={e => setEmailPassword(e.target.value)}
                required
                className="input-field pr-10"
                placeholder="Confirm your identity"
              />
              <button
                type="button"
                onClick={() => setShowEmailPw(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                {showEmailPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <button type="submit" disabled={emailLoading} className="btn-primary w-full">
            {emailLoading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Updating...</> : 'Update Email'}
          </button>
        </form>
      </div>
    </div>
  )
}
