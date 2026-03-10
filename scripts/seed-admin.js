/**
 * seed-admin.js
 * Creates an admin user with username admin@paec.local / admin
 *
 * Usage: node scripts/seed-admin.js
 * Requires DATABASE_URL in env (from .env.local or shell)
 */

require('dotenv').config({ path: '.env.local' })
const { Pool } = require('pg')
const bcrypt = require('bcryptjs')

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL })

  const email = 'admin@paec.local'
  const password = 'admin'
  const name = 'Admin'
  const role = 'admin'

  // Check if already exists
  const { rows: existing } = await pool.query('SELECT id FROM users WHERE email = $1', [email])
  if (existing.length > 0) {
    console.log(`Admin user already exists (id: ${existing[0].id})`)
    console.log(`  Email: ${email}`)
    console.log(`  Password: ${password}`)
    await pool.end()
    return
  }

  const hash = await bcrypt.hash(password, 12)
  const { rows } = await pool.query(
    `INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING id`,
    [name, email, hash, role]
  )

  console.log(`Admin user created successfully!`)
  console.log(`  ID: ${rows[0].id}`)
  console.log(`  Email: ${email}`)
  console.log(`  Password: ${password}`)

  await pool.end()
}

main().catch(err => { console.error(err); process.exit(1) })
