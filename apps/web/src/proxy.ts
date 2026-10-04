import { getSessionCookie } from 'better-auth/cookies';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { signInRedirect } from '@/lib/auth/sign-in-redirect.ts';

export function proxy(request: NextRequest): NextResponse {
  const target = signInRedirect(
    request.nextUrl.pathname,
    request.nextUrl.search,
    getSessionCookie(request) !== null,
  );
  return target === null
    ? NextResponse.next()
    : NextResponse.redirect(new URL(target, request.url));
}

export const config = { matcher: ['/issue/:path*', '/projects/:path*'] };
