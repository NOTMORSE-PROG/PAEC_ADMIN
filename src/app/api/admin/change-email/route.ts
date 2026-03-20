import { auth } from '@/lib/auth'
import { Pool } from 'pg'
import bcrypt from 'bcryptjs'
import { NextResponse } from 'next/server'

const pool = new Pool({ connectionString: process.env.DATABASE_URL })

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { currentPassword, newEmail } = await req.json()

  if (!currentPassword || !newEmail) {
    return NextResponse.json({ error: 'All fields are required' }, { status: 400 })
  }

  // Restrictive measure 1: valid email format
  if (!EMAIL_RE.test(newEmail)) {
    return NextResponse.json({ error: 'Invalid email format' }, { status: 400 })
  }

  const { rows } = await pool.query(
    'SELECT email, password_hash FROM users WHERE id = $1',
    [session.user.id]
  )
  const user = rows[0]
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

  // Restrictive measure 2: must be different from current email
  if (newEmail.toLowerCase() === user.email.toLowerCase()) {
    return NextResponse.json(
      { error: 'New email must be different from your current email' },
      { status: 400 }
    )
  }

  // Restrictive measure 3: verify current password
  const valid = await bcrypt.compare(currentPassword, user.password_hash)
  if (!valid) return NextResponse.json({ error: 'Current password is incorrect' }, { status: 400 })

  // Restrictive measure 4: email must not be taken by another user
  const { rows: existing } = await pool.query(
    'SELECT id FROM users WHERE LOWER(email) = LOWER($1) AND id != $2',
    [newEmail, session.user.id]
  )
  if (existing.length > 0) {
    return NextResponse.json({ error: 'Email is already in use' }, { status: 409 })
  }

  await pool.query('UPDATE users SET email = $1 WHERE id = $2', [newEmail, session.user.id])

  return NextResponse.json({ ok: true })
}
