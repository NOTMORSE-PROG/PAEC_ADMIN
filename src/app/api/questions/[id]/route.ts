import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { getTrainingQuestionById, updateTrainingQuestion, deleteTrainingQuestion } from '@/lib/database'

async function requireAdmin() {
  const session = await auth()
  if (!session || (session.user as { role?: string })?.role !== 'admin') return null
  return session
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  if (!await requireAdmin()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const question = await getTrainingQuestionById(params.id)
  if (!question) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ question })
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  if (!await requireAdmin()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json()
  const updated = await updateTrainingQuestion(params.id, body)
  if (!updated) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ question: updated })
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  if (!await requireAdmin()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  await deleteTrainingQuestion(params.id)
  return NextResponse.json({ ok: true })
}
