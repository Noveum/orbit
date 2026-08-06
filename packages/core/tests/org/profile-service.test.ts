import { beforeEach, describe, expect, it } from 'bun:test';
import { db, eq, schema } from '@orbit/db';
import { updateProfile } from '../../src/org/profile-service.ts';
import { createUser, resetDatabase } from '../../src/test-support.ts';

beforeEach(async () => {
  await resetDatabase();
});

describe('updateProfile', () => {
  it('saves the display name, handle and timezone', async () => {
    const user = await createUser('Nia New');

    const updated = await updateProfile(user.id, {
      name: 'Nia Newton',
      handle: 'nia-newton',
      timezone: 'Asia/Kolkata',
    });

    expect(updated.name).toBe('Nia Newton');
    expect(updated.handle).toBe('nia-newton');
    expect(updated.timezone).toBe('Asia/Kolkata');
  });

  it('never lets the profile update touch the avatar image', async () => {
    const user = await createUser('Nia New');
    await updateProfile(user.id, { name: 'Nia N.', image: 'https://evil.example.com/x.png' });
    const [row] = await db
      .select({ image: schema.user.image })
      .from(schema.user)
      .where(eq(schema.user.id, user.id));
    expect(row?.image ?? null).toBeNull();
  });

  it('leaves untouched fields alone', async () => {
    const user = await createUser('Nia New');
    const updated = await updateProfile(user.id, { name: 'Nia N.' });
    expect(updated.handle).toBe(user.handle);
    expect(updated.timezone).toBe(user.timezone);
  });

  it('refuses a handle another member already uses', async () => {
    const owner = await createUser('Otto Other');
    await updateProfile(owner.id, { handle: 'taken-handle' });
    const user = await createUser('Nia New');

    await expect(updateProfile(user.id, { handle: 'taken-handle' })).rejects.toMatchObject({
      code: 'conflict',
      message: 'That handle is already taken.',
    });
  });

  it('maps a racing unique violation to the same friendly conflict', async () => {
    const owner = await createUser('Otto Other');
    const user = await createUser('Nia New');

    await expect(updateProfile(user.id, { handle: owner.handle })).rejects.toMatchObject({
      code: 'conflict',
      message: 'That handle is already taken.',
    });
  });

  it('lets a member keep their own handle', async () => {
    const user = await createUser('Nia New');
    const updated = await updateProfile(user.id, { handle: user.handle, name: 'Nia!' });
    expect(updated.handle).toBe(user.handle);
  });
});
