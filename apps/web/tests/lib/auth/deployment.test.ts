import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { mcp } from '@better-auth/mcp';
import { betterAuth } from 'better-auth';
import { memoryAdapter } from 'better-auth/adapters/memory';
import { jwt } from 'better-auth/plugins';
import { deploymentAuthOptions } from '@/lib/auth/deployment';
import { nativeFetchGlobals } from '../../../tests-preload';

const canonical = 'https://orbit.example.com';
const preview = 'https://feature-login-orbit-pr.acme.workers.dev';
const previewHosts = '*-orbit-pr.acme.workers.dev';
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
      ORBIT_AUTH_ALLOWED_HOSTS: previewHosts,
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
      body: JSON.stringify({ provider, callbackURL, errorCallbackURL: `${origin}/login` }),
    }),
  );
}

describe('deployment authentication', () => {
  it('returns provider cancellation to the preview login page', async () => {
    const response = await socialSignIn(preview, 'google');
    const authorization = new URL((await response.json()).url);
    const callback = new URL(`${canonical}/api/auth/callback/google`);
    callback.searchParams.set('state', authorization.searchParams.get('state') ?? '');
    callback.searchParams.set('error', 'access_denied');
    const cancelled = await createAuth().handler(new nativeFetchGlobals.Request(callback));
    expect(cancelled.status).toBe(302);
    expect(cancelled.headers.get('location')).toBe(`${preview}/login?error=access_denied`);
  });

  it.each(['google', 'github'])(
    'creates a preview session after the canonical %s exchange and rejects replay',
    async (providerName) => {
      const previewAuth = createAuth();
      const productionAuth = createAuth('production-session-secret-different-from-preview');
      const productionContext = await productionAuth.$context;
      const provider = productionContext.socialProviders.find((item) => item.id === providerName);
      if (!provider) throw new Error('Missing social provider');
      const expectedCallback = `${canonical}/api/auth/callback/${providerName}`;
      const exchangeCallbacks: string[] = [];
      provider.validateAuthorizationCode = (parameters) => {
        exchangeCallbacks.push(parameters.redirectURI);
        return Promise.resolve(
          parameters.redirectURI === expectedCallback ? { accessToken: 'test-token' } : null,
        );
      };
      expect(
        await provider.validateAuthorizationCode({
          code: 'wrong-callback-control',
          redirectURI: `${preview}/api/auth/callback/${providerName}`,
        }),
      ).toBeNull();
      provider.getUserInfo = () =>
        Promise.resolve({
          user: {
            name: 'Preview Tester',
            email: 'tester@example.com',
            emailVerified: true,
          },
          data: { sub: 'provider-user', id: 'provider-user' },
        });
      const signIn = await previewAuth.handler(
        new nativeFetchGlobals.Request(`${preview}/api/auth/sign-in/social`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', origin: preview },
          body: JSON.stringify({ provider: providerName, callbackURL: `${preview}/inbox` }),
        }),
      );
      const authorization = new URL((await signIn.json()).url);
      const callback = new URL(expectedCallback);
      callback.searchParams.set('code', 'test-code');
      callback.searchParams.set('state', authorization.searchParams.get('state') ?? '');
      const exchange = await productionAuth.handler(new nativeFetchGlobals.Request(callback));
      expect(exchangeCallbacks.at(-1)).toBe(expectedCallback);
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
    },
  );

  it('allows the canonical host and the configured preview pattern', () => {
    const options = deploymentAuthOptions({
      BETTER_AUTH_URL: canonical,
      ORBIT_AUTH_ALLOWED_HOSTS: ` ${previewHosts} , orbit-*-team.example.app,staging.example.com `,
    });
    expect(options.baseURL).toMatchObject({
      allowedHosts: [
        'orbit.example.com',
        '*-orbit-pr.acme.workers.dev',
        'orbit-*-team.example.app',
        'staging.example.com',
      ],
      fallback: canonical,
    });
    expect(options.plugins).toEqual([]);
  });

  it('rejects malformed host configuration and short proxy secrets', () => {
    expect(() =>
      deploymentAuthOptions({ ORBIT_AUTH_ALLOWED_HOSTS: 'https://example.com/path' }),
    ).toThrow();
    expect(() => deploymentAuthOptions({ OAUTH_PROXY_SECRET: 'short' })).toThrow();
  });

  it.each([
    '*',
    '*.dev',
    '*.workers.dev',
    '*.example.com',
    'orbit.*.example.com',
    '*-orbit-pr.*.workers.dev',
    '**-orbit-pr.acme.workers.dev',
    '*-orbit-pr.workers',
  ])('refuses the wildcard %s, which reaches beyond one deployment', (pattern) => {
    expect(() =>
      deploymentAuthOptions({ BETTER_AUTH_URL: canonical, ORBIT_AUTH_ALLOWED_HOSTS: pattern }),
    ).toThrow();
  });

  it('accepts a bare wildcard label above three fixed labels', () => {
    const options = deploymentAuthOptions({
      BETTER_AUTH_URL: canonical,
      ORBIT_AUTH_ALLOWED_HOSTS: '*.preview.example.com',
    });
    expect(options.baseURL).toMatchObject({
      allowedHosts: ['orbit.example.com', '*.preview.example.com'],
    });
  });

  it('resolves MCP OAuth metadata on the canonical origin without a request', async () => {
    const deployment = deploymentAuthOptions({
      BETTER_AUTH_URL: canonical,
      ORBIT_AUTH_ALLOWED_HOSTS: previewHosts,
    });
    const auth = betterAuth({
      ...deployment,
      database: memoryAdapter({
        user: [],
        account: [],
        session: [],
        verification: [],
        jwks: [],
        oauthResource: [],
      }),
      secret: 'preview-session-secret-at-least-32-characters',
      plugins: [
        ...deployment.plugins,
        jwt({ jwt: { issuer: canonical } }),
        mcp({ loginPage: '/login', consentPage: '/oauth/authorize', resource: `${canonical}/mcp` }),
      ],
    });

    const withoutRequest = await auth.api.getOAuthServerConfig();
    expect(withoutRequest?.issuer).toBe(canonical);

    const previewHost = await auth.api.getOAuthServerConfig({
      headers: new Headers({ host: new URL(preview).host }),
    });
    expect(previewHost?.issuer).toBe(canonical);

    const unknownHost = await auth.api.getOAuthServerConfig({
      headers: new Headers({ host: 'attacker.example' }),
    });
    expect(unknownHost?.issuer).toBe(canonical);
  });

  it('ignores empty optional deployment values in local configuration', () => {
    const options = deploymentAuthOptions({
      ORBIT_AUTH_ALLOWED_HOSTS: ' , ',
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

  it.each([
    'https://orbit.acme.workers.dev',
    'https://orbit-pr.acme.workers.dev',
    'https://feature-orbit-pr.other.workers.dev',
    'https://feature-orbit-pr.acme.workers.dev.attacker.example',
  ])('rejects %s, which the preview pattern does not cover', async (origin) => {
    const response = await socialSignIn(origin, 'google');
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: 'INVALID_ORIGIN' });
  });

  it('rejects an external post-login redirect', async () => {
    const response = await socialSignIn(preview, 'google', 'https://attacker.example/inbox');
    expect(response.status).toBe(403);
  });
});
