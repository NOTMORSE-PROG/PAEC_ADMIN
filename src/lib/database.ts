import { Pool } from 'pg'

const pool = new Pool({ connectionString: process.env.DATABASE_URL })

export async function query<T = unknown>(sql: string, params?: unknown[]): Promise<T[]> {
  const { rows } = await pool.query(sql, params)
  return rows as T[]
}

export interface TrainingQuestion {
  id: string
  category: string
  question_data: Record<string, unknown>
  difficulty: string
  is_active: boolean
  source: string
  source_meta: Record<string, unknown> | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface User {
  id: string
  name: string
  email: string
  role: string
  created_at: string
}

// ── Questions ────────────────────────────────────────────────────────────────

export async function getTrainingQuestions(opts?: { category?: string; isActive?: boolean; source?: string; limit?: number; offset?: number }) {
  const conditions: string[] = []
  const params: unknown[] = []

  if (opts?.category) { conditions.push(`category = $${params.length + 1}`); params.push(opts.category) }
  if (opts?.isActive !== undefined) { conditions.push(`is_active = $${params.length + 1}`); params.push(opts.isActive) }
  if (opts?.source) { conditions.push(`source = $${params.length + 1}`); params.push(opts.source) }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  const limit = opts?.limit ?? 50
  const offset = opts?.offset ?? 0

  return query<TrainingQuestion>(
    `SELECT * FROM training_questions ${where} ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset]
  )
}

export async function countTrainingQuestions(opts?: { category?: string; isActive?: boolean; source?: string }) {
  const conditions: string[] = []
  const params: unknown[] = []

  if (opts?.category) { conditions.push(`category = $${params.length + 1}`); params.push(opts.category) }
  if (opts?.isActive !== undefined) { conditions.push(`is_active = $${params.length + 1}`); params.push(opts.isActive) }
  if (opts?.source) { conditions.push(`source = $${params.length + 1}`); params.push(opts.source) }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  const rows = await query<{ count: string }>(`SELECT COUNT(*) as count FROM training_questions ${where}`, params)
  return parseInt(rows[0]?.count ?? '0', 10)
}

export async function getTrainingQuestionById(id: string) {
  const rows = await query<TrainingQuestion>('SELECT * FROM training_questions WHERE id = $1', [id])
  return rows[0] ?? null
}

export async function createTrainingQuestion(data: {
  category: string
  question_data: Record<string, unknown>
  difficulty: string
  is_active: boolean
  source: string
  source_meta?: Record<string, unknown>
  created_by?: string
}) {
  const rows = await query<TrainingQuestion>(
    `INSERT INTO training_questions (category, question_data, difficulty, is_active, source, source_meta, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [data.category, JSON.stringify(data.question_data), data.difficulty, data.is_active, data.source, data.source_meta ? JSON.stringify(data.source_meta) : null, data.created_by ?? null]
  )
  return rows[0]
}

export async function bulkCreateTrainingQuestions(questions: Array<{
  category: string
  question_data: Record<string, unknown>
  difficulty: string
  is_active: boolean
  source: string
  source_meta?: Record<string, unknown>
  created_by?: string
}>) {
  if (questions.length === 0) return []
  const results = await Promise.all(questions.map(q => createTrainingQuestion(q)))
  return results
}

export async function updateTrainingQuestion(id: string, data: {
  question_data?: Record<string, unknown>
  difficulty?: string
  is_active?: boolean
}) {
  const sets: string[] = []
  const params: unknown[] = []

  if (data.question_data !== undefined) { sets.push(`question_data = $${params.length + 1}`); params.push(JSON.stringify(data.question_data)) }
  if (data.difficulty !== undefined) { sets.push(`difficulty = $${params.length + 1}`); params.push(data.difficulty) }
  if (data.is_active !== undefined) { sets.push(`is_active = $${params.length + 1}`); params.push(data.is_active) }

  if (sets.length === 0) return null
  sets.push(`updated_at = CURRENT_TIMESTAMP`)

  params.push(id)
  const rows = await query<TrainingQuestion>(
    `UPDATE training_questions SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`,
    params
  )
  return rows[0] ?? null
}

export async function deleteTrainingQuestion(id: string) {
  await query('DELETE FROM training_questions WHERE id = $1', [id])
}

export async function toggleQuestionActive(id: string, isActive: boolean) {
  return updateTrainingQuestion(id, { is_active: isActive })
}

// ── Users ────────────────────────────────────────────────────────────────────

export async function getUsers(limit = 50, offset = 0) {
  return query<User & { session_count: number }>(
    `SELECT u.id, u.name, u.email, u.role, u.created_at,
       (SELECT COUNT(*) FROM training_sessions ts WHERE ts.user_id = u.id AND ts.completed = true)::int AS session_count
     FROM users u
     ORDER BY u.created_at DESC
     LIMIT $1 OFFSET $2`,
    [limit, offset]
  )
}

export async function setUserRole(userId: string, role: string) {
  await query('UPDATE users SET role = $1 WHERE id = $2', [role, userId])
}

export async function getAdminStats() {
  const [totalQ, activeQ, draftQ, totalUsers] = await Promise.all([
    query<{ count: string }>('SELECT COUNT(*) as count FROM training_questions', []),
    query<{ count: string }>('SELECT COUNT(*) as count FROM training_questions WHERE is_active = true', []),
    query<{ count: string }>('SELECT COUNT(*) as count FROM training_questions WHERE is_active = false', []),
    query<{ count: string }>('SELECT COUNT(*) as count FROM users', []),
  ])

  const byCategory = await query<{ category: string; total: number; active: number }>(
    `SELECT category,
       COUNT(*)::int AS total,
       COUNT(*) FILTER (WHERE is_active = true)::int AS active
     FROM training_questions
     GROUP BY category`,
    []
  )

  return {
    totalQuestions: parseInt(totalQ[0]?.count ?? '0', 10),
    activeQuestions: parseInt(activeQ[0]?.count ?? '0', 10),
    draftQuestions: parseInt(draftQ[0]?.count ?? '0', 10),
    totalUsers: parseInt(totalUsers[0]?.count ?? '0', 10),
    byCategory,
  }
}
