import { getUserById, getUserSessions } from '@/lib/database'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const user = await getUserById(id)
  if (!user) return Response.json({ error: 'User not found' }, { status: 404 })
  const sessions = await getUserSessions(id)
  return Response.json({ user, sessions })
}
