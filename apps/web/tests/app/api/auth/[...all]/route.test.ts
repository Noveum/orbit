import { beforeEach, describe, expect, it } from 'bun:test';
import { createHmac, randomUUID } from 'node:crypto';
import { createWorkspace, resetDatabase, type Workspace } from '@orbit/core/test-support';
import { db, desc, schema } from '@orbit/db';
import { mcpContinueUrl } from '../../../../../src/app/(auth)/login/continue-url.ts';
import { POST as authPost, GET } from '../../../../../src/app/api/auth/[...all]/route.ts';
import { DEV_LOGIN_HEADER } from '../../../../../src/lib/api/dev-login.ts';
import { auth } from '../../../../../src/lib/auth/server.ts';
import { nativeFetchGlobals } from '../../../../../tests-preload.ts';

const APP_ORIGIN = 'http://localhost:3000';
const CALLBACK_URL = 'http://127.0.0.1:9000/callback';

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

describe('MCP authorize consent boundary', () => {
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
        search.set('code_challenge', 'challenge');
        search.set('code_challenge_method', 'S256');
        const start = await GET(authorizeRequest(search));
        expect(start.status).toBe(302);
        storeResponseCookies(cookies, start);
        expect(cookies.has('oidc_login_prompt')).toBe(true);
        const loginLocation = new URL(start.headers.get('location') ?? '', APP_ORIGIN);
        expect(loginLocation.pathname).toBe('/login');
        const callbackUrl = mcpContinueUrl(Object.fromEntries(loginLocation.searchParams));
        expect(callbackUrl).toBeDefined();

        const beginLogin = new Request(`${APP_ORIGIN}/api/auth/sign-in/magic-link`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            origin: APP_ORIGIN,
            [DEV_LOGIN_HEADER]: '1',
          },
          body: JSON.stringify({ email: workspace.adminUser.email, callbackURL: callbackUrl }),
        });
        beginLogin.headers.set('cookie', cookieHeader(cookies));
        const loginStarted = await authPost(beginLogin);
        expect(loginStarted.status).toBe(200);
        storeResponseCookies(cookies, loginStarted);

        const [pending] = await db
          .select({ identifier: schema.verification.identifier })
          .from(schema.verification)
          .orderBy(desc(schema.verification.createdAt))
          .limit(1);
        if (pending === undefined) throw new Error('the magic link token was not stored');
        const verifyUrl = new URL(`${APP_ORIGIN}/api/auth/magic-link/verify`);
        verifyUrl.searchParams.set('token', pending.identifier);
        verifyUrl.searchParams.set('callbackURL', callbackUrl ?? '');
        const verify = new Request(verifyUrl);
        verify.headers.set(DEV_LOGIN_HEADER, '1');
        verify.headers.set('cookie', cookieHeader(cookies));
        const verified = await GET(verify);
        expect(verified.status).toBe(302);
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
    search.set('code_challenge', 'challenge');
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

  it('accepts an S256 challenge and continues to explicit consent', async () => {
    const search = authorizeSearch('consent');
    search.set('code_challenge', 'challenge');
    search.set('code_challenge_method', 'S256');
    const response = await GET(authorizeRequest(search, cookie));
    expect(response.status).toBe(302);
    const location = new URL(response.headers.get('location') ?? '', APP_ORIGIN);
    expect(location.pathname).toBe('/oauth/authorize');
    expect(location.searchParams.get('consent_code')).not.toBeNull();
  });
});
