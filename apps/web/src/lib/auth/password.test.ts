import { describe, expect, it } from 'bun:test';
import { hashPassword, verifyPassword } from './password.ts';

describe('password hashing', () => {
  it('verifies a password it hashed', async () => {
    const digest = await hashPassword('correct horse battery staple');
    expect(await verifyPassword(digest, 'correct horse battery staple')).toBe(true);
  });

  it('rejects the wrong password', async () => {
    const digest = await hashPassword('correct horse battery staple');
    expect(await verifyPassword(digest, 'Correct horse battery staple')).toBe(false);
  });

  it('emits an argon2id digest', async () => {
    const digest = await hashPassword('correct horse battery staple');
    expect(digest.startsWith('$argon2id$')).toBe(true);
  });

  it('still verifies a digest written by the previous runtime', async () => {
    const legacy = await Bun.password.hash('correct horse battery staple', {
      algorithm: 'argon2id',
    });
    expect(await verifyPassword(legacy, 'correct horse battery staple')).toBe(true);
    expect(await verifyPassword(legacy, 'nope')).toBe(false);
  });

  it('returns false for a digest it cannot parse', async () => {
    expect(await verifyPassword('not-a-digest', 'anything')).toBe(false);
  });
});
