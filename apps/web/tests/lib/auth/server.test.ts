import { afterEach, describe, expect, it } from 'bun:test';
import { fileURLToPath } from 'node:url';
import { auth } from '../../../src/lib/auth/server.ts';

describe('password authentication', () => {
  it.each([
    { value: undefined, enabled: false },
    { value: 'false', enabled: false },
    { value: '0', enabled: false },
    { value: 'true', enabled: true },
    { value: '1', enabled: true },
  ])('configures password authentication for $value', async ({ value, enabled }) => {
    const source = `
      const value = ${JSON.stringify(value) ?? 'undefined'};
      if (value === undefined) delete process.env['ORBIT_PASSWORD_AUTH'];
      else process.env['ORBIT_PASSWORD_AUTH'] = value;
      const { auth, passwordAuthEnabled } = await import('./src/lib/auth/server.ts');
      console.log(JSON.stringify({
        flag: passwordAuthEnabled,
        enabled: auth.options.emailAndPassword?.enabled,
        plugins: auth.options.plugins?.map((plugin) => plugin.id),
      }));
    `;
    const child = Bun.spawn([process.execPath, '--eval', source], {
      cwd: fileURLToPath(new URL('../../../', import.meta.url)),
      env: process.env,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    expect({ exitCode, stderr }).toMatchObject({ exitCode: 0 });
    expect(JSON.parse(stdout)).toEqual({
      flag: enabled,
      enabled,
      plugins: expect.arrayContaining(['passkey', 'email-otp', 'organization', 'mcp']),
    });
  });

  it('keeps the passwordless methods available', () => {
    expect(auth.options.plugins?.map((plugin) => plugin.id)).toEqual(
      expect.arrayContaining(['passkey', 'email-otp', 'organization']),
    );
  });

  it('stores sign in codes as hashes', () => {
    const plugin = auth.options.plugins?.find((candidate) => candidate.id === 'email-otp');
    if (!(plugin && 'options' in plugin)) throw new Error('Email OTP plugin is missing');
    expect(plugin.options).toMatchObject({ storeOTP: 'hashed' });
  });

  it('exposes only session switching through the organization plugin', () => {
    const plugin = auth.options.plugins?.find((candidate) => candidate.id === 'organization');
    if (plugin === undefined || !('endpoints' in plugin)) {
      throw new Error('Organization plugin is missing');
    }
    expect(Object.keys(plugin.endpoints ?? {})).toEqual(['setActiveOrganization']);
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

describe('open signup rate limits', () => {
  const rules = auth.options.rateLimit?.customRules ?? {};

  function registeredPaths(): Set<string> {
    const paths = new Set<string>();
    for (const endpoint of Object.values(auth.api)) {
      const path = (endpoint as { path?: unknown }).path;
      if (typeof path === 'string') paths.add(path);
    }
    return paths;
  }

  it('caps sign in codes independently of password authentication', () => {
    expect(rules['/email-otp/send-verification-otp']).toEqual({ window: 600, max: 10 });
  });

  it('keeps the password rules for deployments that enable them', () => {
    expect(rules['/sign-in/email']).toEqual({ window: 60, max: 5 });
    expect(rules['/sign-up/email']).toEqual({ window: 3600, max: 5 });
  });

  it('names paths that better-auth actually serves, so no rule is dead', () => {
    const served = registeredPaths();
    expect(served.size).toBeGreaterThan(0);
    for (const path of Object.keys(rules)) expect(served).toContain(path);
  });

  it('matches rules against the path better-auth strips the base from', () => {
    return auth.$context.then((context) => {
      expect(context.options).toHaveProperty('basePath', '/api/auth');
    });
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

  it('rejects an address outside the allowlist whichever provider created it', async () => {
    process.env['ALLOWED_EMAIL_DOMAINS'] = 'magicapi.com,noveum.ai';
    const hook = createUserHook();

    let thrown: unknown;
    try {
      await hook('kpulkit15234@gmail.com');
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toMatchObject({ status: 'FORBIDDEN' });

    const allowed = await hook('shashank@magicapi.com');
    expect(allowed.data.email).toBe('shashank@magicapi.com');
  });

  it('allows every address when nothing is configured', async () => {
    process.env['ALLOWED_EMAIL_DOMAINS'] = '';
    const allowed = await createUserHook()('kpulkit15234@gmail.com');
    expect(allowed.data.handle).toBeDefined();
  });
});
