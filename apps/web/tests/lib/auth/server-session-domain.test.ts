import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { db, inArray, schema } from '@orbit/db';
import { randomUUIDv7 } from '@orbit/shared/utils';
import { auth } from '../../../src/lib/auth/server.ts';

const previousDomains = process.env['ALLOWED_EMAIL_DOMAINS'];

const allowedId = `usr_allowed_${randomUUIDv7()}`;
const blockedId = `usr_blocked_${randomUUIDv7()}`;

beforeAll(async () => {
  await db.insert(schema.user).values([
    {
      id: allowedId,
      name: 'Shashank',
      email: 'shashank@magicapi.com',
      handle: `allowed-${allowedId.slice(-8)}`,
    },
    {
      id: blockedId,
      name: 'Somebody Else',
      email: 'kpulkit15234@gmail.com',
      handle: `blocked-${blockedId.slice(-8)}`,
    },
  ]);
});

beforeEach(() => {
  process.env['ALLOWED_EMAIL_DOMAINS'] = 'magicapi.com,noveum.ai';
});

afterAll(async () => {
  process.env['ALLOWED_EMAIL_DOMAINS'] = previousDomains ?? '';
  await db.delete(schema.user).where(inArray(schema.user.id, [allowedId, blockedId]));
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
    let thrown: unknown;
    try {
      await sessionHook()(blockedId);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toMatchObject({ status: 'FORBIDDEN' });
  });

  it('lets an allowed domain start a session', async () => {
    const result = await sessionHook()(allowedId);
    expect(result).toMatchObject({ data: { userId: allowedId } });
  });

  it('does nothing when the user cannot be found', async () => {
    const result = await sessionHook()('usr_ghost_nobody');
    expect(result).toMatchObject({ data: { userId: 'usr_ghost_nobody' } });
  });
});
