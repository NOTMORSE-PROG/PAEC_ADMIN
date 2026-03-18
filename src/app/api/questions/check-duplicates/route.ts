import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { getTrainingQuestions } from '@/lib/database'

async function requireAdmin() {
  const session = await auth()
  if (!session || (session.user as { role?: string })?.role !== 'admin') return null
  return session
}

// ── Similarity helpers ────────────────────────────────────────────────────────

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()
}

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length
  if (m === 0) return n
  if (n === 0) return m
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  )
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i-1] === b[j-1] ? dp[i-1][j-1] : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1])
  return dp[m][n]
}

function similarity(a: string, b: string): number {
  const na = normalize(a)
  const nb = normalize(b)
  if (!na && !nb) return 1
  if (!na || !nb) return 0
  // Use the shorter string length to cap distance for speed
  if (Math.abs(na.length - nb.length) / Math.max(na.length, nb.length) > 0.6) return 0
  const dist = levenshtein(na, nb)
  return Math.max(0, 1 - dist / Math.max(na.length, nb.length))
}

/** Extract the main searchable text for a question by category */
function questionText(category: string, data: Record<string, unknown>): string {
  if (category === 'readback') return [data.incorrectReadback, data.correctReadback, data.atcInstruction].filter(Boolean).join(' ')
  if (category === 'scenario') return [data.atcClearance, data.correctResponse].filter(Boolean).join(' ')
  if (category === 'jumbled') return ((data.correctOrder as string[]) ?? []).join(' ')
  if (category === 'pronunciation') return `${data.display} ${data.correctPronunciation}`
  return JSON.stringify(data)
}

// ── Route ─────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  if (!await requireAdmin()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const candidates: { category: string; question_data: Record<string, unknown> }[] = body.candidates ?? []

  if (!candidates.length) return NextResponse.json({ results: [] })

  // Group candidates by category to minimise DB queries
  const categories = [...new Set(candidates.map(c => c.category))]
  const existingByCategory: Record<string, { id: string; preview: string; text: string }[]> = {}

  await Promise.all(categories.map(async cat => {
    const rows = await getTrainingQuestions({ category: cat, limit: 1000 })
    existingByCategory[cat] = rows.map(r => ({
      id: r.id,
      preview: questionText(cat, r.question_data).slice(0, 120),
      text: questionText(cat, r.question_data),
    }))
  }))

  const THRESHOLD = 0.65 // 65% similarity → flag as duplicate

  const results = candidates.map((c, i) => {
    const pool = existingByCategory[c.category] ?? []
    if (pool.length === 0) return { index: i, duplicate: false }

    const candText = questionText(c.category, c.question_data)
    let best = { score: 0, id: '', preview: '' }

    for (const existing of pool) {
      const score = similarity(candText, existing.text)
      if (score > best.score) best = { score, id: existing.id, preview: existing.preview }
    }

    if (best.score >= THRESHOLD) {
      return { index: i, duplicate: true, score: Math.round(best.score * 100), matchId: best.id, matchPreview: best.preview }
    }
    return { index: i, duplicate: false }
  })

  return NextResponse.json({ results })
}
