import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { getUsers } from '@/lib/database'

async function requireAdmin() {
  const session = await auth()
  if (!session || (session.user as { role?: string })?.role !== 'admin') return null
  return session
}

export async function GET(req: NextRequest) {
  if (!await requireAdmin()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { searchParams } = new URL(req.url)
  const page = parseInt(searchParams.get('page') ?? '1', 10)
  const limit = 30
  const users = await getUsers(limit, (page - 1) * limit)
  return NextResponse.json({ users })
}
