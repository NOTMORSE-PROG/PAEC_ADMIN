import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { generateCandidates } from '@/lib/questionGenerator'

async function requireAdmin() {
  const session = await auth()
  if (!session || (session.user as { role?: string })?.role !== 'admin') return null
  return session
}

export async function POST(req: NextRequest) {
  if (!await requireAdmin()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { category, analysis } = body

  if (!category || !analysis) return NextResponse.json({ error: 'category and analysis required' }, { status: 400 })
  if (!['scenario', 'readback', 'jumbled', 'pronunciation'].includes(category)) {
    return NextResponse.json({ error: 'Invalid category' }, { status: 400 })
  }

  const candidates = generateCandidates(category, analysis)
  return NextResponse.json({ candidates, count: candidates.length })
}
