import { mock } from 'bun:test';
import { passkey } from '@better-auth/passkey';
import { betterAuth } from 'better-auth';
import { memoryAdapter } from 'better-auth/adapters/memory';
import { z } from 'zod';

const auth = betterAuth({
  baseURL: 'http://localhost:3000',
  secret: 'local-account-selector-regression-secret-20261116',
  database: memoryAdapter({ user: [], account: [], session: [], verification: [], passkey: [] }),
  emailAndPassword: { enabled: true },
  plugins: [passkey()],
});
const signup = await auth.handler(
  new Request('http://localhost:3000/api/auth/sign-up/email', {
    method: 'POST',
    headers: { origin: 'http://localhost:3000', 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'Local Tester',
      email: 'local@example.test',
      password: 'local-test-password',
    }),
  }),
);
const created = z.object({ user: z.object({ id: z.string() }) }).parse(await signup.json());
const context = await auth.$context;
await context.internalAdapter.createAccount({
  id: 'local-google-row',
  userId: created.user.id,
  providerId: 'google',
  accountId: 'provider-google-subject',
  createdAt: new Date(),
  updatedAt: new Date(),
});
const requestHeaders = new Headers({
  origin: 'http://localhost:3000',
  cookie: signup.headers
    .getSetCookie()
    .map((cookie) => cookie.split(';')[0])
    .join('; '),
});
mock.module('next/headers', () => ({ headers: () => Promise.resolve(requestHeaders) }));
mock.module(new URL('../../src/lib/auth/server.ts', import.meta.url).pathname, () => ({ auth }));
const { DELETE } = await import('../../src/app/api/account/credentials/route.ts');
const response = await DELETE(
  new Request('http://localhost:3000/api/account/credentials', {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      kind: 'account',
      providerId: 'google',
      accountId: 'provider-google-subject',
    }),
  }),
);
const accounts = await auth.api.listUserAccounts({ headers: requestHeaders });
console.log(
  JSON.stringify({
    status: response.status,
    googleAccounts: accounts.filter((account) => account.providerId === 'google').length,
    credentialAccounts: accounts.filter((account) => account.providerId === 'credential').length,
  }),
);
