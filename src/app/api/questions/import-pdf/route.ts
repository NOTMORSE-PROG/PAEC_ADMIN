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
  const { questions, filename } = body

  if (!Array.isArray(questions) || questions.length === 0) {
    return NextResponse.json({ error: 'questions array required' }, { status: 400 })
  }

  // Process in DB batches of 50 to avoid query size limits
  const BATCH = 50
  let totalCreated = 0
  for (let i = 0; i < questions.length; i += BATCH) {
    const batch = questions.slice(i, i + BATCH)
    const created = await bulkCreateTrainingQuestions(
      batch.map((q: {
        category: string
        question_data: Record<string, unknown>
      }) => ({
        category: q.category,
        question_data: q.question_data,
        is_active: true,
        source: 'pdf_import',
        source_meta: { filename: filename ?? 'unknown', importedAt: new Date().toISOString() },
        created_by: session.user?.id,
      }))
    )
    totalCreated += created.length
  }

  return NextResponse.json({ created: totalCreated }, { status: 201 })
}
