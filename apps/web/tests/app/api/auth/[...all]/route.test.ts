import { beforeEach, describe, expect, it } from 'bun:test';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import {
  createOrganization,
  finalizeMcpConsent,
  recordMcpGrant,
  unbindMcpCredential,
  verifyMcpAccessToken,
} from '@orbit/core';
import { createWorkspace, resetDatabase, type Workspace } from '@orbit/core/test-support';
import { db, eq, schema } from '@orbit/db';
import { mcpContinueUrl } from '@/app/(auth)/login/continue-url.ts';
import { POST as authPost, GET } from '@/app/api/auth/[...all]/route.ts';
import { DEV_LOGIN_HEADER } from '@/lib/api/dev-login.ts';
import { auth } from '@/lib/auth/server.ts';
import { nativeFetchGlobals } from '../../../../../tests-preload.ts';

const APP_ORIGIN = 'http://localhost:3000';
const CALLBACK_URL = 'http://127.0.0.1:9000/callback';
const VALID_PKCE_CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

function authorizeRequest(search: URLSearchParams, cookie?: string): Request {
  const request = new Request(`${APP_ORIGIN}/api/auth/mcp/authorize?${search.toString()}`);
  if (cookie !== undefined) request.headers.set('cookie', cookie);
  return request;
}

function authorizeSearch(prompt?: string): URLSearchParams {
  const search = new URLSearchParams({
    response_type: 'code',
    client_id: 'client_test',
    redirect_uri: CALLBACK_URL,
    scope: 'openid orbit.read',
    state: 'state_test',
  });
  if (prompt !== undefined) search.set('prompt', prompt);
  return search;
}

async function signedSessionCookie(token: string): Promise<string> {
  const context = await auth.$context;
  const signature = createHmac('sha256', context.secret).update(token).digest('base64');
  return `${context.authCookies.sessionToken.name}=${encodeURIComponent(`${token}.${signature}`)}`;
}

function storeResponseCookies(cookies: Map<string, string>, response: Response): void {
  for (const header of response.headers.getSetCookie()) {
    const pair = header.split(';', 1)[0] ?? '';
    const separator = pair.indexOf('=');
    if (separator < 1) continue;
    const name = pair.slice(0, separator);
    if (/;\s*max-age=0(?:;|$)/i.test(header)) cookies.delete(name);
    else cookies.set(name, pair.slice(separator + 1));
  }
}

function cookieHeader(cookies: ReadonlyMap<string, string>): string {
  return Array.from(cookies, ([name, value]) => `${name}=${value}`).join('; ');
}

async function withNativeFetchGlobals<T>(operation: () => Promise<T>): Promise<T> {
  const domFetchGlobals = {
    Headers: globalThis.Headers,
    Request: globalThis.Request,
    Response: globalThis.Response,
  };
  Object.assign(globalThis, nativeFetchGlobals);
  try {
    return await operation();
  } finally {
    Object.assign(globalThis, domFetchGlobals);
  }
}

async function finalizedAuthorizationCode(workspace: Workspace): Promise<{
  code: string;
  verifier: string;
}> {
  const verifier = 'mcp-code-verifier-0123456789abcdefghijklmnopqrstuvwxyz';
  const consentCode = randomUUID().replace(/-/g, '');
  await db.insert(schema.verification).values({
    id: randomUUID(),
    identifier: consentCode,
    value: JSON.stringify({
      clientId: 'client_test',
      redirectURI: CALLBACK_URL,
      scope: ['openid', 'offline_access', 'orbit.read'],
      userId: workspace.adminUser.id,
      requireConsent: true,
      state: 'state_test',
      codeChallenge: createHash('sha256').update(verifier).digest('base64url'),
      codeChallengeMethod: 'S256',
    }),
    expiresAt: new Date(Date.now() + 600_000),
  });
  const approved = await finalizeMcpConsent({
    userId: workspace.adminUser.id,
    consentCode,
    accept: true,
    organizationId: workspace.organizationId,
  });
  const code = new URL(approved.redirectUri).searchParams.get('code');
  if (code === null) throw new Error('the consent redirect did not carry a code');
  return { code, verifier };
}

describe('MCP authorize consent boundary', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('rejects a direct request that omits prompt before login', async () => {
    const response = await GET(authorizeRequest(authorizeSearch()));
    expect(response.status).toBe(400);
  });

  it('rejects duplicate prompt parameters', async () => {
    const search = authorizeSearch('consent');
    search.append('prompt', 'consent');
    const response = await GET(authorizeRequest(search));
    expect(response.status).toBe(400);
  });

  it('returns OAuth errors for malformed and unsupported token grants', async () => {
    const missingCode = await authPost(
      new Request(`${APP_ORIGIN}/api/auth/mcp/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ grant_type: 'authorization_code' }),
      }),
    );
    expect(missingCode.status).toBe(400);
    expect(await missingCode.json()).toMatchObject({ error: 'invalid_request' });

    const missingRefreshToken = await authPost(
      new Request(`${APP_ORIGIN}/api/auth/mcp/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ grant_type: 'refresh_token' }),
      }),
    );
    expect(missingRefreshToken.status).toBe(400);
    expect(await missingRefreshToken.json()).toMatchObject({ error: 'invalid_request' });

    const unsupportedGrant = await authPost(
      new Request(`${APP_ORIGIN}/api/auth/mcp/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ grant_type: 'client_credentials' }),
      }),
    );
    expect(unsupportedGrant.status).toBe(400);
    expect(await unsupportedGrant.json()).toMatchObject({ error: 'unsupported_grant_type' });
  });

  it('rate limits invalid token requests before their database prechecks', async () => {
    await withNativeFetchGlobals(async () => {
      const context = await auth.$context;
      const previous = {
        enabled: context.rateLimit.enabled,
        max: context.rateLimit.max,
        window: context.rateLimit.window,
      };
      Object.assign(context.rateLimit, { enabled: true, max: 1, window: 60 });
      try {
        const invalidTokenRequest = () =>
          authPost(
            new Request(`${APP_ORIGIN}/api/auth/mcp/token`, {
              method: 'POST',
              headers: {
                'content-type': 'application/json',
                'x-forwarded-for': '203.0.113.77',
              },
              body: JSON.stringify({
                grant_type: 'authorization_code',
                code: 'unknown-code',
              }),
            }),
          );
        expect((await invalidTokenRequest()).status).toBe(400);
        expect((await invalidTokenRequest()).status).toBe(429);
      } finally {
        Object.assign(context.rateLimit, previous);
      }
    });
  });
});

describe('MCP authorize PKCE boundary', () => {
  let workspace: Workspace;
  let cookie: string;

  beforeEach(async () => {
    await resetDatabase();
    workspace = await createWorkspace('McpAuthorization');
    await db.insert(schema.oauthApplication).values({
      id: randomUUID(),
      name: 'Test MCP client',
      clientId: 'client_test',
      redirectUrls: CALLBACK_URL,
      type: 'public',
      userId: workspace.adminUser.id,
    });
    const token = `session_${randomUUID()}`;
    await db.insert(schema.session).values({
      id: randomUUID(),
      token,
      userId: workspace.adminUser.id,
      activeOrganizationId: workspace.organizationId,
      expiresAt: new Date(Date.now() + 3_600_000),
    });
    cookie = await signedSessionCookie(token);
  });

  it('keeps authorization behind consent after login resumes the request', async () => {
    const previousDevLogin = process.env['ORBIT_DEV_LOGIN'];
    process.env['ORBIT_DEV_LOGIN'] = '1';
    try {
      await withNativeFetchGlobals(async () => {
        await db.delete(schema.session);
        const cookies = new Map<string, string>();
        const search = authorizeSearch('consent');
        search.set('code_challenge', VALID_PKCE_CHALLENGE);
        search.set('code_challenge_method', 'S256');
        const start = await GET(authorizeRequest(search));
        expect(start.status).toBe(302);
        storeResponseCookies(cookies, start);
        expect(cookies.has('oidc_login_prompt')).toBe(true);
        const loginLocation = new URL(start.headers.get('location') ?? '', APP_ORIGIN);
        expect(loginLocation.pathname).toBe('/login');
        const callbackUrl = mcpContinueUrl(Object.fromEntries(loginLocation.searchParams));
        expect(callbackUrl).toBeDefined();

        const beginLogin = new Request(`${APP_ORIGIN}/api/auth/email-otp/send-verification-otp`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            origin: APP_ORIGIN,
            [DEV_LOGIN_HEADER]: '1',
          },
          body: JSON.stringify({ email: workspace.adminUser.email, type: 'sign-in' }),
        });
        beginLogin.headers.set('cookie', cookieHeader(cookies));
        const loginStarted = await authPost(beginLogin);
        expect(loginStarted.status).toBe(200);
        storeResponseCookies(cookies, loginStarted);

        const otp = await auth.api.createVerificationOTP({
          body: { email: workspace.adminUser.email, type: 'sign-in' },
        });
        const verify = new Request(`${APP_ORIGIN}/api/auth/sign-in/email-otp`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            origin: APP_ORIGIN,
            [DEV_LOGIN_HEADER]: '1',
          },
          body: JSON.stringify({ email: workspace.adminUser.email, otp }),
        });
        verify.headers.set('cookie', cookieHeader(cookies));
        const verified = await authPost(verify);
        expect(verified.status).toBe(302);
        storeResponseCookies(cookies, verified);
        expect(new URL(verified.headers.get('location') ?? '', APP_ORIGIN).pathname).toBe(
          '/oauth/authorize',
        );

        const records = await db
          .select({ value: schema.verification.value })
          .from(schema.verification);
        const parsedRecords = records.map(
          (record) => JSON.parse(record.value) as Record<string, unknown>,
        );
        const resumed = parsedRecords.find((value) => value['clientId'] === 'client_test');
        expect(resumed?.['requireConsent']).toBe(true);
        expect(resumed?.['state']).toBe('state_test');
      });
    } finally {
      if (previousDevLogin === undefined) delete process.env['ORBIT_DEV_LOGIN'];
      else process.env['ORBIT_DEV_LOGIN'] = previousDevLogin;
    }
  });

  it('rejects prompt=none for an authenticated request', async () => {
    const search = authorizeSearch('none');
    search.set('code_challenge', VALID_PKCE_CHALLENGE);
    search.set('code_challenge_method', 'S256');
    const response = await GET(authorizeRequest(search, cookie));
    expect(response.status).toBe(400);
  });

  it('rejects an authorization request without PKCE', async () => {
    const response = await GET(authorizeRequest(authorizeSearch('consent'), cookie));
    expect(response.status).toBe(302);
    const location = new URL(response.headers.get('location') ?? '', APP_ORIGIN);
    expect(location.origin + location.pathname).toBe(CALLBACK_URL);
    expect(location.searchParams.get('error')).toBe('invalid_request');
  });

  it('rejects code challenges that are not S256 digests', async () => {
    const invalidChallenges = ['A'.repeat(42), 'A'.repeat(44), `${'A'.repeat(42)}=`];
    for (const challenge of invalidChallenges) {
      const search = authorizeSearch('consent');
      search.set('code_challenge', challenge);
      search.set('code_challenge_method', 'S256');
      const response = await GET(authorizeRequest(search, cookie));
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ error: 'invalid_request' });
    }
    expect(await db.select().from(schema.verification)).toHaveLength(0);
  });

  it('accepts an S256 challenge and continues to explicit consent', async () => {
    const search = authorizeSearch('consent');
    search.set('code_challenge', VALID_PKCE_CHALLENGE);
    search.set('code_challenge_method', 'S256');
    const response = await GET(authorizeRequest(search, cookie));
    expect(response.status).toBe(302);
    const location = new URL(response.headers.get('location') ?? '', APP_ORIGIN);
    expect(location.pathname).toBe('/oauth/authorize');
    expect(location.searchParams.get('consent_code')).not.toBeNull();
  });

  it('rejects authorization code verifiers outside RFC 7636 syntax before consuming the code', async () => {
    await withNativeFetchGlobals(async () => {
      const invalidVerifiers = ['A'.repeat(42), 'A'.repeat(129), `${'A'.repeat(42)}%`];
      for (const verifier of invalidVerifiers) {
        const { code } = await finalizedAuthorizationCode(workspace);
        const response = await authPost(
          new Request(`${APP_ORIGIN}/api/auth/mcp/token`, {
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              grant_type: 'authorization_code',
              code,
              client_id: 'client_test',
              redirect_uri: CALLBACK_URL,
              code_verifier: verifier,
            }),
          }),
        );
        expect(response.ok).toBe(false);
        expect(await response.json()).toMatchObject({ error: 'invalid_request' });
        const [remaining] = await db
          .select({ identifier: schema.verification.identifier })
          .from(schema.verification)
          .where(eq(schema.verification.identifier, code));
        expect(remaining?.identifier).toBe(code);
      }
    });
  });

  it('binds authorization and refresh tokens to the consented workspace grant', async () => {
    await withNativeFetchGlobals(async () => {
      const { code, verifier } = await finalizedAuthorizationCode(workspace);
      const token = await authPost(
        new Request(`${APP_ORIGIN}/api/auth/mcp/token`, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'authorization_code',
            code,
            client_id: 'client_test',
            redirect_uri: CALLBACK_URL,
            code_verifier: verifier,
          }),
        }),
      );
      expect(token.status).toBe(200);
      const tokenBody = (await token.json()) as Record<string, unknown>;
      const accessToken = tokenBody['access_token'];
      const refreshToken = tokenBody['refresh_token'];
      expect(typeof accessToken).toBe('string');
      expect(typeof refreshToken).toBe('string');
      if (typeof accessToken !== 'string' || typeof refreshToken !== 'string') {
        throw new Error('the token response did not contain both credentials');
      }
      const context = await auth.$context;
      const accessBinding = unbindMcpCredential(accessToken, context.secret);
      const refreshBinding = unbindMcpCredential(refreshToken, context.secret);
      expect(accessBinding).not.toBeNull();
      expect(refreshBinding).not.toBeNull();
      if (accessBinding === null || refreshBinding === null) {
        throw new Error('the token response did not bind both credentials');
      }
      expect((await verifyMcpAccessToken(accessToken)).organizationId).toBe(
        workspace.organizationId,
      );
      await expect(verifyMcpAccessToken(accessBinding.credential)).rejects.toMatchObject({
        code: 'unauthorized',
      });

      const rawRefresh = await authPost(
        new Request(`${APP_ORIGIN}/api/auth/mcp/token`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            grant_type: 'refresh_token',
            refresh_token: refreshBinding.credential,
            client_id: 'client_test',
          }),
        }),
      );
      expect(rawRefresh.status).toBe(400);
      expect(await rawRefresh.json()).toMatchObject({ error: 'invalid_grant' });

      const refreshed = await authPost(
        new Request(`${APP_ORIGIN}/api/auth/mcp/token`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            grant_type: 'refresh_token',
            refresh_token: refreshToken,
            client_id: 'client_test',
          }),
        }),
      );
      expect(refreshed.status).toBe(200);
      expect(refreshed.headers.get('cache-control')).toBe('no-store');
      expect(refreshed.headers.get('pragma')).toBe('no-cache');
      const refreshedBody = (await refreshed.json()) as Record<string, unknown>;
      const refreshedAccess = refreshedBody['access_token'];
      expect(typeof refreshedAccess).toBe('string');
      if (typeof refreshedAccess !== 'string') {
        throw new Error('the refresh response did not contain an access token');
      }
      expect((await verifyMcpAccessToken(refreshedAccess)).organizationId).toBe(
        workspace.organizationId,
      );

      const replayed = await authPost(
        new Request(`${APP_ORIGIN}/api/auth/mcp/token`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            grant_type: 'refresh_token',
            refresh_token: refreshToken,
            client_id: 'client_test',
          }),
        }),
      );
      expect(replayed.status).toBe(400);
      expect(await replayed.json()).toMatchObject({ error: 'invalid_grant' });
    });
  });

  it('lets only one concurrent refresh consume a credential', async () => {
    await withNativeFetchGlobals(async () => {
      const { code, verifier } = await finalizedAuthorizationCode(workspace);
      const token = await authPost(
        new Request(`${APP_ORIGIN}/api/auth/mcp/token`, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'authorization_code',
            code,
            client_id: 'client_test',
            redirect_uri: CALLBACK_URL,
            code_verifier: verifier,
          }),
        }),
      );
      const tokenBody = (await token.json()) as Record<string, unknown>;
      const refreshToken = tokenBody['refresh_token'];
      if (typeof refreshToken !== 'string') {
        throw new Error('the token response did not contain a refresh credential');
      }

      const refresh = () =>
        authPost(
          new Request(`${APP_ORIGIN}/api/auth/mcp/token`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              grant_type: 'refresh_token',
              refresh_token: refreshToken,
              client_id: 'client_test',
            }),
          }),
        );
      const responses = await Promise.all([refresh(), refresh(), refresh()]);
      expect(responses.filter(({ ok }) => ok)).toHaveLength(1);
      const failures = responses.filter(({ ok }) => !ok);
      expect(failures).toHaveLength(2);
      for (const response of failures) {
        expect(await response.json()).toMatchObject({ error: 'invalid_grant' });
      }
    });
  });

  it('preserves HTTP Basic authentication for a confidential client', async () => {
    await withNativeFetchGlobals(async () => {
      const otherClientId = `other_${randomUUID().replace(/-/g, '')}`;
      await db.insert(schema.oauthApplication).values({
        id: randomUUID(),
        name: 'Other MCP client',
        clientId: otherClientId,
        redirectUrls: CALLBACK_URL,
        type: 'public',
        userId: workspace.adminUser.id,
      });
      await db
        .update(schema.oauthApplication)
        .set({ type: 'confidential', clientSecret: 'client-secret' })
        .where(eq(schema.oauthApplication.clientId, 'client_test'));
      const [otherClient] = await db
        .select({ type: schema.oauthApplication.type })
        .from(schema.oauthApplication)
        .where(eq(schema.oauthApplication.clientId, otherClientId));
      expect(otherClient?.type).toBe('public');
      const { code, verifier } = await finalizedAuthorizationCode(workspace);
      const authorization = `Basic ${Buffer.from('client_test:client-secret').toString('base64')}`;
      const token = await authPost(
        new Request(`${APP_ORIGIN}/api/auth/mcp/token`, {
          method: 'POST',
          headers: {
            authorization,
            'content-type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            grant_type: 'authorization_code',
            code,
            client_id: 'client_test',
            redirect_uri: CALLBACK_URL,
            code_verifier: verifier,
          }),
        }),
      );
      expect(token.status).toBe(200);
      const tokenBody = (await token.json()) as Record<string, unknown>;
      const refreshToken = tokenBody['refresh_token'];
      if (typeof refreshToken !== 'string') {
        throw new Error('the token response did not contain a refresh credential');
      }

      const refreshed = await authPost(
        new Request(`${APP_ORIGIN}/api/auth/mcp/token`, {
          method: 'POST',
          headers: { authorization, 'content-type': 'application/json' },
          body: JSON.stringify({
            grant_type: 'refresh_token',
            refresh_token: refreshToken,
            client_id: 'client_test',
          }),
        }),
      );
      expect(refreshed.status).toBe(200);
    });
  });

  it('refuses an authorization code after re-consent selects another workspace', async () => {
    await withNativeFetchGlobals(async () => {
      const { code, verifier } = await finalizedAuthorizationCode(workspace);
      const other = await createOrganization(workspace.adminUser.id, {
        name: 'Other workspace',
        slug: `other-${randomUUID().slice(0, 8)}`,
      });
      await recordMcpGrant({
        clientId: 'client_test',
        userId: workspace.adminUser.id,
        organizationId: other.organization.id,
        scopes: 'openid offline_access orbit.read',
      });

      const token = await authPost(
        new Request(`${APP_ORIGIN}/api/auth/mcp/token`, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'authorization_code',
            code,
            client_id: 'client_test',
            redirect_uri: CALLBACK_URL,
            code_verifier: verifier,
          }),
        }),
      );
      expect(token.status).toBe(400);
      expect(await token.json()).toMatchObject({ error: 'invalid_grant' });
      expect(await db.select().from(schema.oauthAccessToken)).toHaveLength(0);
    });
  });

  it('rejects alternate token paths without exposing an unbound token', async () => {
    await withNativeFetchGlobals(async () => {
      const { code, verifier } = await finalizedAuthorizationCode(workspace);
      for (const path of ['/api/auth/mcp/token/', '/api/auth/mcp/TOKEN', '/api/auth/mcp/%74oken']) {
        const token = await authPost(
          new Request(`${APP_ORIGIN}${path}`, {
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              grant_type: 'authorization_code',
              code,
              client_id: 'client_test',
              redirect_uri: CALLBACK_URL,
              code_verifier: verifier,
            }),
          }),
        );
        expect(token.status).toBe(404);
      }
      expect(await db.select().from(schema.oauthAccessToken)).toHaveLength(0);
    });
  });
});
