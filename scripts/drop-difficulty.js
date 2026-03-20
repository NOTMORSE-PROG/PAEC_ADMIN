/**
 * drop-difficulty.js
 * Drops the difficulty column from training_questions table.
 *
 * Usage: node scripts/drop-difficulty.js
 * Requires DATABASE_URL in env (from .env.local or shell)
 */

require('dotenv').config({ path: '.env.local' })
const { Pool } = require('pg')

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL })
  await pool.query('ALTER TABLE training_questions DROP COLUMN IF EXISTS difficulty')
  console.log('Done: difficulty column dropped from training_questions')
  await pool.end()
}

main().catch(err => { console.error(err); process.exit(1) })
