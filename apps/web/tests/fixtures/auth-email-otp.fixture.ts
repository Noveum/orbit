import assert from 'node:assert/strict';
import { betterAuth } from 'better-auth';
import { memoryAdapter } from 'better-auth/adapters/memory';
import { emailOTP } from 'better-auth/plugins';
import { z } from 'zod';
import { SESSION_COOKIE_CACHE_POLICY } from '../../src/lib/auth/session-policy.ts';

let delivered = '';
const auth = betterAuth({
  baseURL: 'http://localhost:3000',
  secret: 'local-email-otp-regression-secret-20261116',
  database: memoryAdapter({ user: [], account: [], session: [], verification: [] }),
  emailAndPassword: { enabled: true },
  session: { cookieCache: SESSION_COOKIE_CACHE_POLICY },
  plugins: [
    emailOTP({
      storeOTP: 'hashed',
      sendVerificationOTP: ({ otp }) => {
        delivered = otp;
        return Promise.resolve();
      },
    }),
  ],
});
const signup = await auth.api.signUpEmail({
  body: { name: 'Local Tester', email: 'local@example.test', password: 'local-test-password' },
  asResponse: true,
});
const created = z.object({ user: z.object({ id: z.string() }) }).parse(await signup.json());
const oldHeaders = new Headers({
  cookie: signup.headers
    .getSetCookie()
    .map((cookie) => cookie.split(';')[0])
    .join('; '),
});
const context = await auth.$context;
await context.internalAdapter.createAccount({
  id: 'local-unproven-social-account',
  userId: created.user.id,
  providerId: 'google',
  accountId: 'unproven-provider-subject',
  createdAt: new Date(),
  updatedAt: new Date(),
});
await auth.api.sendVerificationOTP({ body: { email: 'local@example.test', type: 'sign-in' } });
assert.ok(delivered);
const signedIn = await auth.api.signInEmailOTP({
  body: { email: 'local@example.test', otp: delivered },
  asResponse: true,
});
assert.equal(signedIn.status, 200);
const newHeaders = new Headers({
  cookie: signedIn.headers
    .getSetCookie()
    .map((cookie) => cookie.split(';')[0])
    .join('; '),
});
const accounts = await auth.api.listUserAccounts({ headers: newHeaders });
const oldSession = await auth.api.getSession({ headers: oldHeaders });
const newSession = await auth.api.getSession({ headers: newHeaders });
assert.equal(accounts.length, 0, 'Mailbox proof must remove every unproven preexisting credential');
assert.equal(oldSession, null, 'Mailbox proof must revoke the unproven existing session');
assert.equal(newSession?.user.id, created.user.id);
assert.equal(newSession?.user.emailVerified, true);
console.log(
  JSON.stringify({ mailboxProof: true, unprovenCredentialsRemoved: true, oldSessionRevoked: true }),
);
