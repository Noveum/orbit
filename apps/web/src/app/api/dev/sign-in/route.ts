import { db, eq, schema } from '@orbit/db';
import { notFound } from '@orbit/shared/errors';
import { devSignInSchema } from '@orbit/shared/validators';
import { NextResponse } from 'next/server';
import { DEV_LOGIN_HEADER, devLoginEnabled } from '@/lib/api/dev-login.ts';
import { listDevUsers } from '@/lib/api/dev-users.ts';
import { errorResponse, readJson } from '@/lib/api/handler.ts';
import { auth } from '@/lib/auth/server.ts';

export async function GET(): Promise<Response> {
  if (!devLoginEnabled()) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json({ users: await listDevUsers() });
}

export async function POST(request: Request): Promise<Response> {
  if (!devLoginEnabled()) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const body = await readJson(request);

  try {
    const { email } = devSignInSchema.parse(body);

    const [existing] = await db
      .select({ id: schema.user.id })
      .from(schema.user)
      .where(eq(schema.user.email, email))
      .limit(1);
    if (existing === undefined) throw notFound('No seeded user with that email.');

    const forwarded = new Headers(request.headers);
    forwarded.set(DEV_LOGIN_HEADER, '1');
    const otp = await auth.api.createVerificationOTP({
      body: { email, type: 'sign-in' },
    });
    const verified = await auth.api.signInEmailOTP({
      body: { email, otp },
      headers: forwarded,
      asResponse: true,
    });

    const response = NextResponse.json({ signedIn: true, email });
    for (const cookie of verified.headers.getSetCookie()) {
      response.headers.append('set-cookie', cookie);
    }
    return response;
  } catch (error: unknown) {
    return errorResponse(error);
  }
}
