import { NextRequest, NextResponse } from 'next/server'
import { getToken } from 'next-auth/jwt'

/**
 * Middleware — reads the JWT cookie directly via getToken() so the auth
 * check never constructs a base URL and is not affected by AUTH_URL / NEXTAUTH_URL.
 */
export default async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl

  if (!pathname.startsWith('/dashboard')) return NextResponse.next()

  const token = await getToken({
    req,
    secret: process.env.AUTH_SECRET,
    cookieName: 'cbs-admin.session-token',
  })

  if (!token) {
    const loginUrl = new URL('/auth/login', req.nextUrl.origin)
    loginUrl.searchParams.set('callbackUrl', pathname)
    return NextResponse.redirect(loginUrl)
  }

  if ((token.role as string) !== 'admin') {
    return NextResponse.redirect(new URL('/unauthorized', req.nextUrl.origin))
  }

  return NextResponse.next()
}

export const config = { matcher: ['/dashboard/:path*'] }
