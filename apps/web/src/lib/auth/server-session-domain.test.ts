import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { auth } from './server.ts';

const dbModule = await import('@orbit/db');
let lookupEmail: string | undefined;

mock.module('@orbit/db', () => ({
  ...dbModule,
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(lookupEmail === undefined ? [] : [{ email: lookupEmail }]),
        }),
      }),
    }),
  },
}));

const previousDomains = process.env['ALLOWED_EMAIL_DOMAINS'];

beforeEach(() => {
  process.env['ALLOWED_EMAIL_DOMAINS'] = 'magicapi.com,noveum.ai';
  lookupEmail = undefined;
});

afterAll(() => {
  process.env['ALLOWED_EMAIL_DOMAINS'] = previousDomains ?? '';
  mock.module('@orbit/db', () => dbModule);
});

function sessionHook() {
  const before = auth.options.databaseHooks?.session?.create?.before;
  if (before === undefined) throw new Error('the session create hook is missing');
  return (userId: string) =>
    before({
      id: 'session_1',
      token: 'tok',
      userId,
      expiresAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
      ipAddress: null,
      userAgent: null,
    });
}

describe('session domain allowlist', () => {
  it('rejects an existing user whose domain is not allowed on any sign in', async () => {
    lookupEmail = 'kpulkit15234@gmail.com';

    let thrown: unknown;
    try {
      await sessionHook()('user_1');
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toMatchObject({ status: 'FORBIDDEN' });
  });

  it('lets an allowed domain start a session', async () => {
    lookupEmail = 'shashank@magicapi.com';
    const result = await sessionHook()('user_1');
    expect(result).toMatchObject({ data: { userId: 'user_1' } });
  });

  it('does nothing when the user cannot be found', async () => {
    lookupEmail = undefined;
    const result = await sessionHook()('ghost');
    expect(result).toMatchObject({ data: { userId: 'ghost' } });
  });
});
