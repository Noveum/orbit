import { listOrganizationsForUser, passkeyVerifiedWithin, userHasPasskey } from '@orbit/core';
import { toDomainError } from '@orbit/shared/errors';
import { databaseLogFields } from '@orbit/shared/utils';
import { mcpConsentDecisionSchema } from '@orbit/shared/validators';
import { finalizeProviderConsent } from '@/lib/auth/mcp-consent.ts';
import { auth } from '@/lib/auth/server.ts';
import { getSession } from '@/lib/auth/session.ts';
import { publicAppUrl } from '@/lib/env.ts';
import { FRESH_SESSION_WINDOW_MS, PASSKEY_STEP_UP_WINDOW_MS, signedInWithin } from '../step-up.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  const origin = request.headers.get('origin');
  if (origin !== null && origin !== publicAppUrl()) {
    return Response.json({ error: 'invalid_origin' }, { status: 403 });
  }

  const session = await getSession();
  if (session === null) return Response.json({ error: 'unauthorized' }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'invalid_request' }, { status: 400 });
  }
  const parsed = mcpConsentDecisionSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: 'invalid_request' }, { status: 400 });
  const { decision, consentCode, organizationId, agent } = parsed.data;
  const userId = session.user.id;

  try {
    if (decision === 'deny') {
      const denied = await finalizeProviderConsent(
        { userId, consentCode, accept: false },
        auth.api,
        request.headers,
      );
      return Response.json({ redirectUri: denied.redirectUri });
    }

    const justSignedIn = signedInWithin(session.session.createdAt, FRESH_SESSION_WINDOW_MS);
    if (!justSignedIn && (await userHasPasskey(userId))) {
      const fresh = await passkeyVerifiedWithin(userId, PASSKEY_STEP_UP_WINDOW_MS);
      if (!fresh) return Response.json({ status: 'passkey_required' });
    }

    const organizations = await listOrganizationsForUser(userId);
    if (!organizations.some((entry) => entry.organization.id === organizationId)) {
      return Response.json({ error: 'invalid_workspace' }, { status: 400 });
    }

    const approved = await finalizeProviderConsent(
      {
        userId,
        consentCode,
        accept: true,
        organizationId,
        ...(agent === undefined ? {} : { agent }),
      },
      auth.api,
      request.headers,
    );
    return Response.json({ redirectUri: approved.redirectUri });
  } catch (error) {
    const domain = toDomainError(error);
    console.error('mcp consent decision failed', databaseLogFields(error) ?? { code: domain.code });
    const message =
      domain.status >= 500 ? 'Something went wrong. Try connecting again.' : domain.message;
    return Response.json({ error: domain.code, message }, { status: domain.status });
  }
}
