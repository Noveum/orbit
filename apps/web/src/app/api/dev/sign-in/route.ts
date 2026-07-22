import { db, desc, eq, ilike, schema } from '@orbit/db';
import { notFound } from '@orbit/shared/errors';
import { emailSchema } from '@orbit/shared/validators';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { devLoginEnabled, listDevUsers } from '@/lib/api/dev-login.ts';
import { errorResponse, readJson } from '@/lib/api/handler.ts';
import { auth } from '@/lib/auth/server.ts';

const signInSchema = z.object({ email: emailSchema });

export async function GET(): Promise<Response> {
  if (!devLoginEnabled()) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json({ users: await listDevUsers() });
}

export async function POST(request: Request): Promise<Response> {
  if (!devLoginEnabled()) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const body = await readJson(request);

  try {
    const { email } = signInSchema.parse(body);

    const [existing] = await db
      .select({ id: schema.user.id })
      .from(schema.user)
      .where(eq(schema.user.email, email))
      .limit(1);
    if (existing === undefined) throw notFound('No seeded user with that email.');

    const forwarded = new Headers(request.headers);
    await auth.api.signInMagicLink({
      body: { email, callbackURL: '/' },
      headers: forwarded,
    });

    const [pending] = await db
      .select({ identifier: schema.verification.identifier })
      .from(schema.verification)
      .where(ilike(schema.verification.value, `%${email}%`))
      .orderBy(desc(schema.verification.createdAt))
      .limit(1);
    if (pending === undefined) throw notFound('Could not mint a dev session.');

    const verified = await auth.api.magicLinkVerify({
      query: { token: pending.identifier, callbackURL: '/' },
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
