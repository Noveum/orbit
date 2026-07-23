import { beforeEach, describe, expect, it } from 'bun:test';
import { createUser, resetDatabase } from '../test-support.ts';
import { updateProfile } from './profile-service.ts';

beforeEach(async () => {
  await resetDatabase();
});

describe('updateProfile', () => {
  it('saves the display name, handle, avatar and timezone', async () => {
    const user = await createUser('Nia New');

    const updated = await updateProfile(user.id, {
      name: 'Nia Newton',
      handle: 'nia-newton',
      image: 'https://example.com/nia.png',
      timezone: 'Asia/Kolkata',
    });

    expect(updated.name).toBe('Nia Newton');
    expect(updated.handle).toBe('nia-newton');
    expect(updated.image).toBe('https://example.com/nia.png');
    expect(updated.timezone).toBe('Asia/Kolkata');
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
