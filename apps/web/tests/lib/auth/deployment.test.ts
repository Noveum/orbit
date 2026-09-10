import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { betterAuth } from 'better-auth';
import { memoryAdapter } from 'better-auth/adapters/memory';
import { symmetricDecrypt } from 'better-auth/crypto';
import { deploymentAuthOptions } from '@/lib/auth/deployment';
import { nativeFetchGlobals } from '../../../tests-preload';

const canonical = 'https://orbit.example.com';
const preview = 'https://orbit-abc123-magicapi.vercel.app';
const browserFetchGlobals = {
  Headers: globalThis.Headers,
  Request: globalThis.Request,
  Response: globalThis.Response,
};

beforeAll(() => {
  Object.assign(globalThis, nativeFetchGlobals);
});
afterAll(() => {
  Object.assign(globalThis, browserFetchGlobals);
});

function createAuth(secret = 'preview-session-secret-at-least-32-characters') {
  return betterAuth({
    ...deploymentAuthOptions({
      BETTER_AUTH_URL: canonical,
      ORBIT_AUTH_ALLOWED_HOSTS: 'orbit-*-magicapi.vercel.app',
      OAUTH_PROXY_SECRET: 'dedicated-proxy-secret-at-least-32-characters',
    }),
    database: memoryAdapter({ user: [], account: [], session: [], verification: [] }),
    advanced: { disableOriginCheck: false, disableCSRFCheck: false },
    secret,
    socialProviders: {
      google: { clientId: 'test-google-client', clientSecret: 'test-google-secret' },
      github: { clientId: 'test-github-client', clientSecret: 'test-github-secret' },
    },
  });
}

function socialSignIn(origin: string, provider: string, callbackURL = '/inbox') {
  return createAuth().handler(
    new nativeFetchGlobals.Request(`${origin}/api/auth/sign-in/social`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin, cookie: 'existing=1' },
      body: JSON.stringify({ provider, callbackURL }),
    }),
  );
}

describe('deployment authentication', () => {
  it('creates a session on the preview after the production callback and rejects replay', async () => {
    const previewAuth = createAuth();
    const productionAuth = createAuth('production-session-secret-different-from-preview');
    const productionContext = await productionAuth.$context;
    const provider = productionContext.socialProviders.find((item) => item.id === 'google');
    if (!provider) throw new Error('Missing Google provider');
    provider.validateAuthorizationCode = () => Promise.resolve({ accessToken: 'test-token' });
    provider.getUserInfo = () =>
      Promise.resolve({
        user: {
          id: 'provider-user',
          name: 'Preview Tester',
          email: 'tester@example.com',
          emailVerified: true,
        },
        data: {},
      });
    const signIn = await previewAuth.handler(
      new nativeFetchGlobals.Request(`${preview}/api/auth/sign-in/social`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: preview },
        body: JSON.stringify({ provider: 'google', callbackURL: `${preview}/inbox` }),
      }),
    );
    const authorization = new URL((await signIn.json()).url);
    const callback = new URL(`${canonical}/api/auth/callback/google`);
    callback.searchParams.set('code', 'test-code');
    callback.searchParams.set('state', authorization.searchParams.get('state') ?? '');
    const exchange = await productionAuth.handler(new nativeFetchGlobals.Request(callback));
    expect(exchange.status).toBe(302);
    const location = exchange.headers.get('location') ?? '';
    expect(new URL(location).origin).toBe(preview);
    const login = await previewAuth.handler(new nativeFetchGlobals.Request(location));
    expect(login.status).toBe(302);
    expect(login.headers.get('location')).toBe(`${preview}/inbox`);
    const cookies = login.headers.getSetCookie();
    expect(cookies.some((cookie) => cookie.includes('session_token='))).toBe(true);
    expect(cookies.join(';')).not.toContain('Domain=');
    const session = await previewAuth.api.getSession({
      headers: new Headers({
        host: new URL(preview).host,
        cookie: cookies.map((cookie) => cookie.split(';')[0]).join('; '),
      }),
    });
    expect(session?.user.email).toBe('tester@example.com');
    expect(
      await productionContext.internalAdapter.findUserByEmail('tester@example.com'),
    ).toBeNull();
    const replay = await previewAuth.handler(new nativeFetchGlobals.Request(location));
    expect(replay.headers.get('location')).toContain('state_mismatch');
  });

  it('includes the exact deployment and branch aliases', () => {
    const options = deploymentAuthOptions({
      BETTER_AUTH_URL: canonical,
      VERCEL_URL: 'orbit-abc123-magicapi.vercel.app',
      VERCEL_BRANCH_URL: 'orbit-git-feature-magicapi.vercel.app',
    });
    expect(options.baseURL).toMatchObject({
      allowedHosts: [
        'orbit.example.com',
        'orbit-abc123-magicapi.vercel.app',
        'orbit-git-feature-magicapi.vercel.app',
      ],
    });
    expect(options.plugins).toEqual([]);
  });

  it('rejects malformed host configuration and short proxy secrets', () => {
    expect(() =>
      deploymentAuthOptions({ ORBIT_AUTH_ALLOWED_HOSTS: 'https://example.com/path' }),
    ).toThrow();
    expect(() => deploymentAuthOptions({ OAUTH_PROXY_SECRET: 'short' })).toThrow();
  });

  it('ignores empty optional deployment values in local configuration', () => {
    const options = deploymentAuthOptions({
      VERCEL_URL: '',
      VERCEL_BRANCH_URL: ' ',
      OAUTH_PROXY_SECRET: '',
    });
    expect(options.baseURL).toBe('http://localhost:3000');
    expect(options.plugins).toEqual([]);
  });

  it.each(['google', 'github'])(
    'routes preview %s authorization through the stable callback',
    async (provider) => {
      const response = await socialSignIn(preview, provider);
      expect(response.status).toBe(200);
      const body = await response.json();
      const url = new URL(body.url);
      expect(url.searchParams.get('redirect_uri')).toBe(
        `${canonical}/api/auth/callback/${provider}`,
      );
      expect(url.searchParams.get('state')).toBeTruthy();
      const state = JSON.parse(
        await symmetricDecrypt({
          key: 'dedicated-proxy-secret-at-least-32-characters',
          data: url.searchParams.get('state') ?? '',
        }),
      );
      const payload = JSON.parse(
        await symmetricDecrypt({
          key: 'dedicated-proxy-secret-at-least-32-characters',
          data: state.stateCookie,
        }),
      );
      expect(new URL(payload.callbackURL).origin).toBe(preview);
    },
  );

  it('preserves normal production login', async () => {
    const response = await socialSignIn(canonical, 'google');
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(new URL(body.url).searchParams.get('redirect_uri')).toBe(
      `${canonical}/api/auth/callback/google`,
    );
  });

  it('rejects another Vercel project', async () => {
    await expect(socialSignIn('https://other-magicapi.vercel.app', 'google')).rejects.toThrow();
  });

  it('rejects an external post-login redirect', async () => {
    const response = await socialSignIn(preview, 'google', 'https://attacker.example/inbox');
    expect(response.status).toBe(403);
  });
});
