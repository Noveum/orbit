import { afterAll, beforeAll, expect, it, spyOn } from 'bun:test';
import { createHmac } from 'node:crypto';
import { inspect } from 'node:util';
import { betterAuth } from 'better-auth';
import { memoryAdapter } from 'better-auth/adapters/memory';
import { APIError, createAuthEndpoint } from 'better-auth/api';
import { authHttpHandler, authLoggingOptions } from '../../../src/lib/auth/logging.ts';

import { nativeFetchGlobals } from '../../../tests-preload';

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

it('keeps bound credentials out of session, raw router errors and diagnostic messages', async () => {
  const token = 'SyntheticOpaqueSessionLettersOnly';
  const statement = 'select synthetic_private_column from session where token = $1';
  const driver = Object.assign(new Error(token), {
    name: 'PostgresError',
    code: '28P01',
    detail: token,
  });
  const failure = Object.assign(
    new Error(`Failed query: ${statement}\nparams: ${token}`, { cause: driver }),
    {
      query: statement,
      params: [token],
    },
  );
  const secret = 'test-only-private-signing-credential-for-this-fixture';
  const signature = createHmac('sha256', secret).update(token).digest('base64');
  const headers = {
    cookie: `better-auth.session_token=${encodeURIComponent(`${token}.${signature}`)}`,
  };
  const auth = betterAuth({
    baseURL: 'http://localhost:3000',
    secret,
    ...authLoggingOptions,
    database(options) {
      const adapter = memoryAdapter({ user: [], session: [], account: [], verification: [] })(
        options,
      );
      adapter.findOne = () => Promise.reject(failure);
      return adapter;
    },
    plugins: [
      {
        id: 'regression',
        endpoints: {
          deny: createAuthEndpoint('/synthetic-denial', { method: 'GET' }, () =>
            Promise.reject(
              new APIError(
                'UNAUTHORIZED',
                { message: 'test denial' },
                { 'www-authenticate': 'Bearer' },
              ),
            ),
          ),
          jump: createAuthEndpoint('/synthetic-redirect', { method: 'GET' }, (ctx) =>
            Promise.reject(ctx.redirect('http://localhost:3000/login')),
          ),
          rawFailure: createAuthEndpoint('/synthetic-failure', { method: 'GET' }, () =>
            Promise.reject(failure),
          ),
        },
      },
    ],
  });
  const capture = spyOn(console, 'error').mockImplementation(() => undefined);
  try {
    const respond = authHttpHandler(auth.handler);
    for (const path of ['get-session', 'synthetic-failure']) {
      const res = await respond(new Request(`http://localhost:3000/api/auth/${path}`, { headers }));
      expect(res.status).toBe(500);
      const body = await res.text();
      expect(body).not.toContain(token);
      expect(body).not.toContain(statement);
    }
    const denied = await respond(new Request('http://localhost:3000/api/auth/synthetic-denial'));
    expect(denied.status).toBe(401);
    expect(denied.headers.get('www-authenticate')).toBe('Bearer');
    expect(await denied.text()).toContain('test denial');
    const redirected = await respond(
      new Request('http://localhost:3000/api/auth/synthetic-redirect'),
    );
    expect(redirected.status).toBe(302);
    expect(redirected.headers.get('location')).toBe('http://localhost:3000/login');
    const navigation = Object.assign(new Error('navigation'), { digest: 'NEXT_REDIRECT' });
    const unrelated = authHttpHandler(() => Promise.reject(navigation));
    await expect(unrelated(new Request('http://localhost:3000'))).rejects.toBe(navigation);
    authLoggingOptions.logger.log('error', token, { secret: token });
    const logs = inspect(capture.mock.calls, { depth: null });
    expect(logs).toContain('28P01');
    expect(logs).not.toContain(token);
    expect(logs).not.toContain(statement);
    expect(logs).not.toContain('# SERVER_ERROR');
  } finally {
    capture.mockRestore();
  }
});
