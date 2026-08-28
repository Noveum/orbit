import { afterEach, describe, expect, it } from 'bun:test';
import { auth, passwordAuthEnabled } from '../../../src/lib/auth/server.ts';

const SOCIAL_PROVIDERS = [['google'], ['github']] as const;

describe('password authentication', () => {
  it('stays off unless ORBIT_PASSWORD_AUTH is set', () => {
    expect(process.env['ORBIT_PASSWORD_AUTH']).toBeUndefined();
    expect(passwordAuthEnabled).toBe(false);
    expect(auth.options.emailAndPassword?.enabled).toBe(false);
    expect(auth.options.rateLimit).toBeUndefined();
  });

  it('keeps the passwordless methods available', () => {
    expect(auth.options.plugins?.map((plugin) => plugin.id)).toEqual(
      expect.arrayContaining(['passkey', 'email-otp', 'organization']),
    );
  });

  it('stores sign in codes as hashes', () => {
    const plugin = auth.options.plugins?.find((candidate) => candidate.id === 'email-otp');
    expect(plugin?.options).toMatchObject({ storeOTP: 'hashed' });
  });

  it('exposes the MCP OAuth provider for one-click clients', () => {
    expect(auth.options.plugins?.map((plugin) => plugin.id)).toEqual(
      expect.arrayContaining(['mcp']),
    );
  });

  it('lets an authenticated user link a provider whose email differs', () => {
    expect(auth.options.account?.accountLinking?.enabled).toBe(true);
    expect(auth.options.account?.accountLinking?.allowDifferentEmails).toBe(true);
  });

  it('hashes with argon2id and verifies the hash', async () => {
    const hash = await Bun.password.hash('a-very-long-password', { algorithm: 'argon2id' });
    expect(hash.startsWith('$argon2id$')).toBe(true);
    expect(await Bun.password.verify('a-very-long-password', hash)).toBe(true);
    expect(await Bun.password.verify('wrong', hash)).toBe(false);
  });
});

describe('email domain allowlist', () => {
  const previous = process.env['ALLOWED_EMAIL_DOMAINS'];

  afterEach(() => {
    process.env['ALLOWED_EMAIL_DOMAINS'] = previous ?? '';
  });

  function createUserHook() {
    const before = auth.options.databaseHooks?.user?.create?.before;
    if (before === undefined) throw new Error('the user create hook is missing');
    return (email: string) =>
      before({
        id: 'user_1',
        name: 'Pulkit',
        email,
        emailVerified: true,
        image: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
  }

  it.each(SOCIAL_PROVIDERS)('rejects an ineligible first-time %s account', async (provider) => {
    process.env['ALLOWED_EMAIL_DOMAINS'] = 'magicapi.com,noveum.ai';
    const hook = createUserHook();

    let thrown: unknown;
    try {
      await hook(`${provider}-kpulkit15234@gmail.com`);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toMatchObject({ status: 'FORBIDDEN' });
  });

  it('allows an address from the configured domain', async () => {
    process.env['ALLOWED_EMAIL_DOMAINS'] = 'magicapi.com,noveum.ai';
    const allowed = await createUserHook()('shashank@magicapi.com');
    expect(allowed.data.email).toBe('shashank@magicapi.com');
  });

  it('allows every address when nothing is configured', async () => {
    process.env['ALLOWED_EMAIL_DOMAINS'] = '';
    const allowed = await createUserHook()('kpulkit15234@gmail.com');
    expect(allowed.data.handle).toBeDefined();
  });
});
