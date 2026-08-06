import { afterAll, beforeEach, describe, expect, it } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { db, schema } from '@orbit/db';
import { auth } from '../../../src/lib/auth/server.ts';

const previousDomains = process.env['ALLOWED_EMAIL_DOMAINS'];

beforeEach(() => {
  process.env['ALLOWED_EMAIL_DOMAINS'] = 'magicapi.com,noveum.ai';
});

afterAll(() => {
  process.env['ALLOWED_EMAIL_DOMAINS'] = previousDomains ?? '';
});

async function userWith(email: string): Promise<string> {
  const id = `user_${randomUUID()}`;
  await db
    .insert(schema.user)
    .values({ id, name: 'Session Domain', email, handle: id, emailVerified: true });
  return id;
}

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
    const userId = await userWith(`kpulkit${randomUUID().slice(0, 8)}@gmail.com`);

    let thrown: unknown;
    try {
      await sessionHook()(userId);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toMatchObject({ status: 'FORBIDDEN' });
  });

  it('lets an allowed domain start a session', async () => {
    const userId = await userWith(`shashank${randomUUID().slice(0, 8)}@magicapi.com`);
    const result = await sessionHook()(userId);
    expect(result).toMatchObject({ data: { userId } });
  });

  it('does nothing when the user cannot be found', async () => {
    const result = await sessionHook()('ghost');
    expect(result).toMatchObject({ data: { userId: 'ghost' } });
  });
});
