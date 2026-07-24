import { beforeEach, describe, expect, it } from 'bun:test';
import { createUser, resetDatabase } from '../test-support.ts';
import {
  avatarPublicUrl,
  avatarStorageKey,
  clearAvatar,
  isAvatarUrl,
  saveAvatar,
} from './avatar-service.ts';

beforeEach(async () => {
  await resetDatabase();
});

describe('avatar-service', () => {
  it('derives a user-scoped storage key', () => {
    expect(avatarStorageKey('user_123')).toBe('avatars/user_123');
  });

  it('builds a cache-busted public url from the version', () => {
    expect(avatarPublicUrl('user_123', 42)).toBe('/api/avatars/user_123?v=42');
  });

  it('recognises its own avatar urls and ignores external ones', () => {
    expect(isAvatarUrl('/api/avatars/user_123?v=1')).toBe(true);
    expect(isAvatarUrl('https://example.com/a.png')).toBe(false);
    expect(isAvatarUrl(null)).toBe(false);
  });

  it('points the user image at the avatar route when saved', async () => {
    const user = await createUser('Ada Avatar');
    const at = new Date('2026-07-24T00:00:00.000Z');

    const updated = await saveAvatar(user.id, at);

    expect(updated.image).toBe(`/api/avatars/${user.id}?v=${at.getTime()}`);
  });

  it('clears the image back to null when removed', async () => {
    const user = await createUser('Ada Avatar');
    await saveAvatar(user.id);

    const cleared = await clearAvatar(user.id);

    expect(cleared.image).toBeNull();
  });
});
