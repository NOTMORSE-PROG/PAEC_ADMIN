import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { setUserRole } from '@/lib/database'

async function requireAdmin() {
  const session = await auth()
  if (!session || (session.user as { role?: string })?.role !== 'admin') return null
  return session
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await requireAdmin()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { role } = await req.json()
  if (!['admin', 'student'].includes(role)) return NextResponse.json({ error: 'Invalid role' }, { status: 400 })
  // Prevent self-demotion
  if (params.id === session.user?.id && role !== 'admin') {
    return NextResponse.json({ error: 'Cannot change your own role' }, { status: 400 })
  }
  await setUserRole(params.id, role)
  return NextResponse.json({ ok: true })
}
