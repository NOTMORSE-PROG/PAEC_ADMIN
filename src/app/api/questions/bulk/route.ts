import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { bulkCreateTrainingQuestions } from '@/lib/database'

async function requireAdmin() {
  const session = await auth()
  if (!session || (session.user as { role?: string })?.role !== 'admin') return null
  return session
}

export async function POST(req: NextRequest) {
  const session = await requireAdmin()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { questions } = body

  if (!Array.isArray(questions) || questions.length === 0) {
    return NextResponse.json({ error: 'questions array required' }, { status: 400 })
  }
  if (questions.length > 20) {
    return NextResponse.json({ error: 'Max 20 questions per bulk request' }, { status: 400 })
  }

  const created = await bulkCreateTrainingQuestions(
    questions.map((q: { category: string; question_data: Record<string, unknown>; difficulty?: string; source_meta?: Record<string, unknown> }) => ({
      category: q.category,
      question_data: q.question_data,
      difficulty: q.difficulty ?? 'medium',
      is_active: true,
      source: 'analysis',
      source_meta: q.source_meta,
      created_by: session.user?.id,
    }))
  )

  return NextResponse.json({ created: created.length, questions: created }, { status: 201 })
}
