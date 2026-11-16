import { describe, expect, it } from 'bun:test';
import { betterAuth } from 'better-auth';
import { memoryAdapter } from 'better-auth/adapters/memory';
import { symmetricEncrypt } from 'better-auth/crypto';
import { oAuthProxy } from 'better-auth/plugins';

const SECRET = 'local-auth-proxy-regression-secret-20261116';

function proxyAuth() {
  return betterAuth({
    baseURL: 'http://localhost:3000',
    secret: SECRET,
    logger: { disabled: true },
    database: memoryAdapter({}),
    socialProviders: {
      google: { clientId: 'local-google-client', clientSecret: 'local-google-secret' },
    },
    plugins: [oAuthProxy()],
  });
}

describe('OAuth proxy payload boundaries', () => {
  for (const path of ['/oauth-proxy-callback']) {
    it(`rejects pre-upgrade state encryption as a profile at ${path}`, async () => {
      const auth = proxyAuth();
      const profile = await symmetricEncrypt({
        key: SECRET,
        data: JSON.stringify({ callbackURL: '/dashboard' }),
      });
      const query = new URLSearchParams({ callbackURL: '/dashboard', profile });
      const response = await auth.handler(
        new Request(`http://localhost:3000/api/auth${path}?${query}`),
      );
      expect(response.headers.get('location')).toContain('error=invalid_profile');
      expect(response.headers.get('set-cookie')).toBeNull();
    });
  }
});
