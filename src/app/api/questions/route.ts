import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { getTrainingQuestions, countTrainingQuestions, createTrainingQuestion } from '@/lib/database'

async function requireAdmin() {
  const session = await auth()
  if (!session || (session.user as { role?: string })?.role !== 'admin') return null
  return session
}

export async function GET(req: NextRequest) {
  if (!await requireAdmin()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const category = searchParams.get('category') ?? undefined
  const status = searchParams.get('status') // 'published' | 'draft' | null
  const source = searchParams.get('source') ?? undefined
  const search = searchParams.get('search') ?? undefined
  const page = parseInt(searchParams.get('page') ?? '1', 10)
  const limit = parseInt(searchParams.get('limit') ?? '20', 10)
  const offset = (page - 1) * limit

  const isActive = status === 'published' ? true : status === 'draft' ? false : undefined

  const [questions, total] = await Promise.all([
    getTrainingQuestions({ category, isActive, source, search, limit, offset }),
    countTrainingQuestions({ category, isActive, source, search }),
  ])

  return NextResponse.json({ questions, total, page, totalPages: Math.ceil(total / limit) })
}

export async function POST(req: NextRequest) {
  const session = await requireAdmin()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { category, question_data, is_active = false, source = 'manual', source_meta } = body

  if (!category || !question_data) return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })

  const question = await createTrainingQuestion({
    category, question_data, is_active, source,
    source_meta, created_by: session.user?.id,
  })

  return NextResponse.json({ question }, { status: 201 })
}
