import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { db, eq, schema } from '@orbit/db';
import type { StorageDriver } from '@orbit/services/storage';
import { createUser, resetDatabase } from '../test-support.ts';
import {
  avatarPublicUrl,
  avatarStorageKey,
  clearAvatar,
  ingestExternalAvatar,
  isAvatarUrl,
  isExternalImageUrl,
  saveAvatar,
} from './avatar-service.ts';

beforeEach(async () => {
  await resetDatabase();
});

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function fakeDriver(): { driver: StorageDriver; puts: Array<{ key: string; type: string }> } {
  const puts: Array<{ key: string; type: string }> = [];
  const driver = {
    name: 's3',
    put: (key: string, _body: Uint8Array, type: string) => {
      puts.push({ key, type });
      return Promise.resolve();
    },
    createUploadTarget: () => Promise.reject(new Error('unused')),
    getUrl: () => Promise.reject(new Error('unused')),
    delete: () => Promise.resolve(),
    stat: () => Promise.resolve(null),
  } as unknown as StorageDriver;
  return { driver, puts };
}

async function imageOf(userId: string): Promise<string | null> {
  const [row] = await db
    .select({ image: schema.user.image })
    .from(schema.user)
    .where(eq(schema.user.id, userId));
  return row?.image ?? null;
}

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

  it('flags external image urls but not its own or empty ones', () => {
    expect(isExternalImageUrl('https://lh3.googleusercontent.com/a/x')).toBe(true);
    expect(isExternalImageUrl('/api/avatars/user_123?v=1')).toBe(false);
    expect(isExternalImageUrl(null)).toBe(false);
    expect(isExternalImageUrl('')).toBe(false);
  });

  it('ingests an external photo into storage and points image at the avatar route', async () => {
    const user = await createUser('Otto OAuth');
    const { driver, puts } = fakeDriver();
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { 'content-type': 'image/png' },
        }),
      ),
    ) as unknown as typeof fetch;

    const ok = await ingestExternalAvatar(user.id, 'https://provider.example/a.png', driver);

    expect(ok).toBe(true);
    expect(puts).toEqual([{ key: `avatars/${user.id}`, type: 'image/png' }]);
    expect(await imageOf(user.id)).toStartWith(`/api/avatars/${user.id}?v=`);
  });

  it('drops the image to null when the external photo cannot be ingested', async () => {
    const user = await createUser('Otto OAuth');
    await saveAvatar(user.id);
    const { driver } = fakeDriver();
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response('nope', { status: 404 })),
    ) as unknown as typeof fetch;

    const ok = await ingestExternalAvatar(user.id, 'https://provider.example/gone.png', driver);

    expect(ok).toBe(false);
    expect(await imageOf(user.id)).toBeNull();
  });

  it('rejects a non-image content type without storing anything', async () => {
    const user = await createUser('Otto OAuth');
    const { driver, puts } = fakeDriver();
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response('<html>', { status: 200, headers: { 'content-type': 'text/html' } }),
      ),
    ) as unknown as typeof fetch;

    const ok = await ingestExternalAvatar(user.id, 'https://provider.example/page', driver);

    expect(ok).toBe(false);
    expect(puts).toEqual([]);
    expect(await imageOf(user.id)).toBeNull();
  });
});
