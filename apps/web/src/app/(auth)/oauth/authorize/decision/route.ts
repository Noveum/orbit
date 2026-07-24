import {
  listOrganizationsForUser,
  passkeyVerifiedWithin,
  recordMcpGrant,
  userHasPasskey,
} from '@orbit/core';
import { headers as nextHeaders } from 'next/headers';
import { auth } from '@/lib/auth/server.ts';
import { getSession } from '@/lib/auth/session.ts';
import { publicAppUrl } from '@/lib/env.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PASSKEY_STEP_UP_WINDOW_MS = 120_000;

function redirectTo(url: string): Response {
  return new Response(null, { status: 303, headers: { location: url } });
}

function consentError(reason: string): Response {
  return redirectTo(`/oauth/authorize?consent_error=${encodeURIComponent(reason)}`);
}

export async function POST(request: Request): Promise<Response> {
  const origin = request.headers.get('origin');
  if (origin !== null && origin !== publicAppUrl()) {
    return new Response('Invalid origin.', { status: 403 });
  }

  const session = await getSession();
  if (session === null) return new Response('Sign in to continue.', { status: 401 });

  const form = await request.formData();
  const decision = String(form.get('decision') ?? '');
  const consentCode = String(form.get('consent_code') ?? '');
  const clientId = String(form.get('client_id') ?? '');
  const scope = String(form.get('scope') ?? '');
  const organizationId = String(form.get('organization_id') ?? '');
  if (consentCode.length === 0) return consentError('missing_consent_code');

  const requestHeaders = await nextHeaders();

  if (decision !== 'allow') {
    const denied = await auth.api.oAuthConsent({
      body: { accept: false, consent_code: consentCode },
      headers: requestHeaders,
    });
    return redirectTo(denied.redirectURI);
  }

  if (await userHasPasskey(session.user.id)) {
    const fresh = await passkeyVerifiedWithin(session.user.id, PASSKEY_STEP_UP_WINDOW_MS);
    if (!fresh) return consentError('passkey_required');
  }

  const organizations = await listOrganizationsForUser(session.user.id);
  if (!organizations.some((entry) => entry.organization.id === organizationId)) {
    return consentError('invalid_workspace');
  }

  await recordMcpGrant({ clientId, userId: session.user.id, organizationId, scopes: scope });

  const approved = await auth.api.oAuthConsent({
    body: { accept: true, consent_code: consentCode },
    headers: requestHeaders,
  });
  return redirectTo(approved.redirectURI);
}
