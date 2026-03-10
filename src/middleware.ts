import { auth } from '@/lib/auth'
import { NextResponse } from 'next/server'

export default auth((req) => {
  const { pathname } = req.nextUrl
  const session = req.auth

  if (pathname.startsWith('/dashboard')) {
    if (!session) return NextResponse.redirect(new URL('/auth/login', req.url))
    if ((session.user as { role?: string })?.role !== 'admin') {
      return NextResponse.redirect(new URL('/unauthorized', req.url))
    }
  }

  return NextResponse.next()
})

export const config = { matcher: ['/dashboard/:path*'] }
