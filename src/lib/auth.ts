import NextAuth from 'next-auth'
import Credentials from 'next-auth/providers/credentials'
import { Pool } from 'pg'
import bcrypt from 'bcryptjs'

const pool = new Pool({ connectionString: process.env.DATABASE_URL })

export const { handlers, auth, signIn, signOut } = NextAuth({
  secret: process.env.AUTH_SECRET,
  trustHost: true,
  session: { strategy: 'jwt' },
  cookies: {
    sessionToken: {
      name: 'cbs-admin.session-token',
      options: { httpOnly: true, sameSite: 'lax', path: '/', secure: process.env.NODE_ENV === 'production' },
    },
  },
  pages: {
    signIn: '/auth/login',
    error: '/auth/login',
  },
  providers: [
    Credentials({
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null
        const { rows } = await pool.query('SELECT * FROM users WHERE email = $1', [credentials.email])
        const user = rows[0]
        if (!user) return null
        const valid = await bcrypt.compare(credentials.password as string, user.password_hash)
        if (!valid) return null
        if (user.role !== 'admin') return null  // Admin only
        return { id: user.id, name: user.name, email: user.email, role: user.role }
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) { token.id = user.id; token.role = (user as { role?: string }).role }
      return token
    },
    async session({ session, token }) {
      if (session.user) { session.user.id = token.id as string; (session.user as { role?: string }).role = token.role as string }
      return session
    },
  },
})
